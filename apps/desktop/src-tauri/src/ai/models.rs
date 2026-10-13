//! 공급자별 모델 목록.

use super::http::{client, get_json, required_key, with_bearer};
use super::types::Provider;

/// 대화용이 아닌 모델(임베딩·음성·이미지 등)은 목록에서 뺀다.
pub(super) fn is_chat_model(id: &str) -> bool {
    const SKIP: &[&str] = &["embed", "tts", "whisper", "dall-e", "image", "audio", "realtime", "moderation", "transcribe", "davinci", "babbage", "search", "sora", "aqa", "imagen", "veo"];
    let lower = id.to_ascii_lowercase();
    !SKIP.iter().any(|s| lower.contains(s))
}

pub(super) async fn list_models(p: Provider, base_url: Option<String>) -> Result<Vec<String>, String> {
    let base = p.base_url(base_url.as_deref())?;
    let key = required_key(p)?;
    let http = client();
    let mut ids: Vec<String> = match p {
        Provider::Anthropic => {
            let v = get_json(
                p,
                http.get(format!("{base}/v1/models?limit=100"))
                    .header("x-api-key", key.unwrap_or_default())
                    .header("anthropic-version", "2023-06-01"),
            )
            .await?;
            v["data"].as_array().into_iter().flatten().filter_map(|m| m["id"].as_str().map(str::to_string)).collect()
        }
        Provider::Gemini => {
            let v = get_json(p, http.get(format!("{base}/v1beta/models?pageSize=200")).header("x-goog-api-key", key.unwrap_or_default())).await?;
            v["models"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|m| {
                    m["supportedGenerationMethods"].as_array().is_some_and(|a| a.iter().any(|x| x == "generateContent"))
                })
                .filter_map(|m| m["name"].as_str().map(|n| n.trim_start_matches("models/").to_string()))
                .collect()
        }
        _ => {
            let v = get_json(p, with_bearer(http.get(format!("{base}/models")), key.as_deref())).await?;
            v["data"].as_array().into_iter().flatten().filter_map(|m| m["id"].as_str().map(str::to_string)).collect()
        }
    };
    ids.retain(|id| is_chat_model(id));
    if p != Provider::Anthropic {
        ids.sort();
    }
    ids.dedup();
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_non_chat_models() {
        assert!(is_chat_model("gpt-5-mini"));
        assert!(!is_chat_model("text-embedding-3-small"));
        assert!(!is_chat_model("gpt-4o-realtime-preview"));
    }
}
