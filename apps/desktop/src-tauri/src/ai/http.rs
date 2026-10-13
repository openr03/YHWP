//! AI 서버와 HTTP 로 주고받기. 한 번에 받기(`chat`)와 실시간으로 받기(`chat_stream`).

use std::sync::OnceLock;
use std::time::Duration;

use serde_json::{json, Value};

use super::keystore;
use super::stream::{Accumulator, AnthropicAcc, GeminiAcc, OpenAiAcc, SseBuffer, StreamEvent};
use super::types::{ChatRequest, ChatResponse, Provider};
use super::wire::{anthropic_body, gemini_body, openai_body, parse_anthropic, parse_gemini, parse_openai};

pub(super) fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        // 업데이터와 같은 ring 암호 모듈을 쓴다(이미 설치돼 있으면 그대로 둔다)
        let _ = rustls::crypto::ring::default_provider().install_default();
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            // 로컬 모델은 첫 응답(모델 적재)까지 오래 걸릴 수 있다
            .timeout(Duration::from_secs(900))
            .user_agent(concat!("YHWP/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("HTTP 클라이언트")
    })
}

fn send_error(p: Provider, e: reqwest::Error) -> String {
    if e.is_connect() && !p.needs_key() {
        return format!("{} 에 연결할 수 없습니다. 프로그램이 실행 중인지, 서버 주소가 맞는지 확인하세요.", p.label());
    }
    if e.is_timeout() {
        return format!("{} 응답 시간이 초과되었습니다.", p.label());
    }
    format!("{} 연결 오류: {e}", p.label())
}

fn status_error(p: Provider, status: reqwest::StatusCode, body: &str) -> String {
    let detail = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| {
            v["error"]["message"]
                .as_str()
                .or_else(|| v["error"].as_str())
                .or_else(|| v["message"].as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| body.chars().take(300).collect());
    let hint = match status.as_u16() {
        401 | 403 => "API 키가 올바르지 않거나 권한이 없습니다. ",
        404 => "모델 이름 또는 서버 주소를 확인하세요. ",
        429 => "요청 한도를 넘었거나 크레딧이 부족합니다. ",
        500..=599 => "AI 서버에 일시적인 문제가 있습니다. ",
        _ => "",
    };
    format!("{} 오류 ({}): {hint}{detail}", p.label(), status.as_u16())
}

async fn send(p: Provider, builder: reqwest::RequestBuilder) -> Result<reqwest::Response, String> {
    let res = builder.send().await.map_err(|e| send_error(p, e))?;
    let status = res.status();
    if status.is_success() {
        return Ok(res);
    }
    let text = res.text().await.unwrap_or_default();
    Err(status_error(p, status, &text))
}

async fn read_json(p: Provider, res: reqwest::Response) -> Result<Value, String> {
    let text = res.text().await.map_err(|e| send_error(p, e))?;
    serde_json::from_str(&text).map_err(|e| format!("{} 응답을 읽지 못했습니다: {e}", p.label()))
}

pub(super) async fn get_json(p: Provider, builder: reqwest::RequestBuilder) -> Result<Value, String> {
    read_json(p, send(p, builder).await?).await
}

pub(super) fn required_key(p: Provider) -> Result<Option<String>, String> {
    let key = keystore::read(p.key_slot())?;
    if p.needs_key() && key.is_none() {
        return Err(format!("{} API 키가 없습니다. AI 설정에서 키를 입력하세요.", p.label()));
    }
    Ok(key)
}

pub(super) fn with_bearer(builder: reqwest::RequestBuilder, key: Option<&str>) -> reqwest::RequestBuilder {
    match key {
        Some(k) => builder.bearer_auth(k),
        None => builder,
    }
}

/// 공급자에 맞는 요청(주소·머리글·본문)을 만든다.
fn prepare(req: &ChatRequest, stream: bool) -> Result<(reqwest::RequestBuilder, Value), String> {
    let p = req.provider;
    if req.model.trim().is_empty() {
        return Err("모델을 선택하세요.".into());
    }
    let base = p.base_url(req.base_url.as_deref())?;
    let key = required_key(p)?;
    let http = client();
    Ok(match p {
        Provider::Anthropic => {
            let mut body = anthropic_body(req);
            if stream {
                body["stream"] = json!(true);
            }
            let builder = http
                .post(format!("{base}/v1/messages"))
                .header("x-api-key", key.unwrap_or_default())
                .header("anthropic-version", "2023-06-01");
            (builder, body)
        }
        Provider::Gemini => {
            let model = req.model.trim_start_matches("models/");
            let method = if stream { "streamGenerateContent?alt=sse" } else { "generateContent" };
            let builder = http
                .post(format!("{base}/v1beta/models/{model}:{method}"))
                .header("x-goog-api-key", key.unwrap_or_default());
            (builder, gemini_body(req))
        }
        _ => {
            let mut body = openai_body(req, p == Provider::Openai);
            if stream {
                body["stream"] = json!(true);
                body["stream_options"] = json!({ "include_usage": true });
            }
            (with_bearer(http.post(format!("{base}/chat/completions")), key.as_deref()), body)
        }
    })
}

pub(super) async fn chat(req: ChatRequest) -> Result<ChatResponse, String> {
    let p = req.provider;
    let (builder, body) = prepare(&req, false)?;
    let v = read_json(p, send(p, builder.json(&body)).await?).await?;
    match p {
        Provider::Anthropic => parse_anthropic(&v),
        Provider::Gemini => parse_gemini(&v),
        _ => parse_openai(&v),
    }
}

/// 실시간으로 받는다. 조각마다 `emit` 을 부르고 끝나면 합친 응답을 돌려준다.
pub(super) async fn chat_stream(req: ChatRequest, emit: &mut (dyn FnMut(StreamEvent) + Send)) -> Result<ChatResponse, String> {
    let p = req.provider;
    let (builder, body) = prepare(&req, true)?;
    let mut res = send(p, builder.json(&body)).await?;
    let mut acc: Box<dyn Accumulator> = match p {
        Provider::Anthropic => Box::<AnthropicAcc>::default(),
        Provider::Gemini => Box::<GeminiAcc>::default(),
        _ => Box::<OpenAiAcc>::default(),
    };
    let mut sse = SseBuffer::default();
    let mut done = false;
    while !done {
        let Some(chunk) = res.chunk().await.map_err(|e| send_error(p, e))? else { break };
        for data in sse.push(&chunk) {
            if acc.feed(&data, emit)? {
                done = true;
                break;
            }
        }
    }
    if !done {
        if let Some(data) = sse.finish() {
            acc.feed(&data, emit)?;
        }
    }
    Ok(acc.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 네트워크가 필요하다: cargo test --lib ai::http::tests::https_reaches_cloud -- --ignored
    #[test]
    #[ignore]
    fn https_reaches_cloud() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let err = rt
            .block_on(get_json(Provider::Openai, client().get("https://api.openai.com/v1/models").bearer_auth("sk-invalid")))
            .unwrap_err();
        assert!(err.contains("401"), "{err}");
    }
}
