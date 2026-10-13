//! 실시간 응답(SSE) 읽기. 공급자마다 조각 형식이 달라 누적기를 따로 둔다.
//! 조각을 받을 때마다 화면에 보낼 사건(`StreamEvent`)을 내고, 끝나면 중립 응답으로 합친다.

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::Value;

use super::types::{ChatResponse, ToolCall, Usage};
use super::wire::parse_arguments;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StreamEvent {
    /// 답변 글 조각
    Text { delta: String },
    /// 모델이 생각(추론) 중
    Thinking,
    /// 도구 호출을 만들기 시작함
    ToolCall { name: String },
}

/// 바이트 조각을 SSE 사건의 data 로 나눈다. UTF-8 글자가 조각 경계에서 잘려도 안전하다.
#[derive(Default)]
pub struct SseBuffer {
    buf: Vec<u8>,
}

impl SseBuffer {
    pub fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buf.extend(chunk.iter().filter(|b| **b != b'\r'));
        let mut out = vec![];
        while let Some(end) = self.buf.windows(2).position(|w| w == b"\n\n") {
            let block: Vec<u8> = self.buf.drain(..end + 2).collect();
            if let Some(data) = data_of(&String::from_utf8_lossy(&block)) {
                out.push(data);
            }
        }
        out
    }

    /// 끝에 빈 줄 없이 끝난 마지막 사건
    pub fn finish(&mut self) -> Option<String> {
        let rest = std::mem::take(&mut self.buf);
        data_of(&String::from_utf8_lossy(&rest))
    }
}

fn data_of(block: &str) -> Option<String> {
    let lines: Vec<&str> = block
        .lines()
        .filter_map(|l| l.strip_prefix("data:"))
        .map(|l| l.strip_prefix(' ').unwrap_or(l))
        .collect();
    (!lines.is_empty()).then(|| lines.join("\n"))
}

pub trait Accumulator: Send {
    /// data 하나를 먹는다. 스트림이 끝났으면 true.
    fn feed(&mut self, data: &str, emit: &mut dyn FnMut(StreamEvent)) -> Result<bool, String>;
    fn finish(self: Box<Self>) -> ChatResponse;
}

fn error_of(v: &Value) -> Option<String> {
    let e = v.get("error")?;
    Some(e["message"].as_str().or_else(|| e.as_str()).unwrap_or("알 수 없는 오류").to_string())
}

fn parse(data: &str) -> Result<Value, String> {
    serde_json::from_str(data).map_err(|e| format!("실시간 응답을 읽지 못했습니다: {e}"))
}

// ── OpenAI 호환 (OpenAI, Ollama, LM Studio, 호환 서버) ──

#[derive(Default)]
pub struct OpenAiAcc {
    text: String,
    calls: BTreeMap<u64, (String, String, String)>,
    stop: Option<String>,
    usage: Option<Usage>,
}

impl Accumulator for OpenAiAcc {
    fn feed(&mut self, data: &str, emit: &mut dyn FnMut(StreamEvent)) -> Result<bool, String> {
        if data.trim() == "[DONE]" {
            return Ok(true);
        }
        let v = parse(data)?;
        if let Some(e) = error_of(&v) {
            return Err(e);
        }
        if let Some(u) = v.get("usage").filter(|u| u.is_object()) {
            self.usage = Some(Usage {
                input_tokens: u["prompt_tokens"].as_u64().unwrap_or(0),
                output_tokens: u["completion_tokens"].as_u64().unwrap_or(0),
            });
        }
        let Some(choice) = v["choices"].get(0) else { return Ok(false) };
        let delta = &choice["delta"];
        if let Some(t) = delta["content"].as_str().filter(|t| !t.is_empty()) {
            self.text.push_str(t);
            emit(StreamEvent::Text { delta: t.to_string() });
        }
        let reasoning = delta["reasoning"].as_str().or_else(|| delta["reasoning_content"].as_str());
        if reasoning.is_some_and(|r| !r.is_empty()) {
            emit(StreamEvent::Thinking);
        }
        for (pos, tc) in delta["tool_calls"].as_array().into_iter().flatten().enumerate() {
            let index = tc["index"].as_u64().unwrap_or(pos as u64);
            let entry = self.calls.entry(index).or_default();
            if let Some(id) = tc["id"].as_str() {
                entry.0 = id.to_string();
            }
            if let Some(name) = tc["function"]["name"].as_str().filter(|n| !n.is_empty()) {
                entry.1 = name.to_string();
                emit(StreamEvent::ToolCall { name: name.to_string() });
            }
            match &tc["function"]["arguments"] {
                Value::String(s) => entry.2.push_str(s),
                Value::Null => {}
                other => entry.2 = other.to_string(),
            }
        }
        if let Some(r) = choice["finish_reason"].as_str() {
            self.stop = Some(r.to_string());
        }
        Ok(false)
    }

    fn finish(self: Box<Self>) -> ChatResponse {
        let tool_calls = self
            .calls
            .into_iter()
            .map(|(i, (id, name, args))| ToolCall {
                id: if id.is_empty() { format!("call_{i}") } else { id },
                name,
                arguments: parse_arguments(&Value::String(args)),
                signature: None,
            })
            .collect();
        ChatResponse { text: self.text, tool_calls, stop_reason: self.stop, usage: self.usage }
    }
}

// ── Anthropic ──

#[derive(Default)]
pub struct AnthropicAcc {
    blocks: BTreeMap<u64, (String, String, String, String)>, // 종류, id, 이름, 글/JSON
    stop: Option<String>,
    usage: Usage,
}

impl Accumulator for AnthropicAcc {
    fn feed(&mut self, data: &str, emit: &mut dyn FnMut(StreamEvent)) -> Result<bool, String> {
        let v = parse(data)?;
        let index = v["index"].as_u64().unwrap_or(0);
        match v["type"].as_str().unwrap_or_default() {
            "error" => return Err(error_of(&v).unwrap_or_else(|| "Claude 오류".into())),
            "message_start" => self.usage.input_tokens = v["message"]["usage"]["input_tokens"].as_u64().unwrap_or(0),
            "content_block_start" => {
                let b = &v["content_block"];
                let kind = b["type"].as_str().unwrap_or_default().to_string();
                let name = b["name"].as_str().unwrap_or_default().to_string();
                if kind == "tool_use" {
                    emit(StreamEvent::ToolCall { name: name.clone() });
                }
                let id = b["id"].as_str().unwrap_or_default().to_string();
                self.blocks.insert(index, (kind, id, name, String::new()));
            }
            "content_block_delta" => {
                let d = &v["delta"];
                let block = self.blocks.entry(index).or_default();
                match d["type"].as_str().unwrap_or_default() {
                    "text_delta" => {
                        let t = d["text"].as_str().unwrap_or_default();
                        block.3.push_str(t);
                        emit(StreamEvent::Text { delta: t.to_string() });
                    }
                    "input_json_delta" => block.3.push_str(d["partial_json"].as_str().unwrap_or_default()),
                    "thinking_delta" => emit(StreamEvent::Thinking),
                    _ => {}
                }
            }
            "message_delta" => {
                self.stop = v["delta"]["stop_reason"].as_str().map(str::to_string);
                if let Some(n) = v["usage"]["output_tokens"].as_u64() {
                    self.usage.output_tokens = n;
                }
            }
            "message_stop" => return Ok(true),
            _ => {}
        }
        Ok(false)
    }

    fn finish(self: Box<Self>) -> ChatResponse {
        let mut out = ChatResponse { stop_reason: self.stop, usage: Some(self.usage), ..Default::default() };
        for (_, (kind, id, name, body)) in self.blocks {
            match kind.as_str() {
                "text" => out.text.push_str(&body),
                "tool_use" => out.tool_calls.push(ToolCall { id, name, arguments: parse_arguments(&Value::String(body)), signature: None }),
                _ => {}
            }
        }
        out
    }
}

// ── Gemini ──

#[derive(Default)]
pub struct GeminiAcc {
    out: ChatResponse,
}

impl Accumulator for GeminiAcc {
    fn feed(&mut self, data: &str, emit: &mut dyn FnMut(StreamEvent)) -> Result<bool, String> {
        let v = parse(data)?;
        if let Some(e) = error_of(&v) {
            return Err(e);
        }
        if let Some(reason) = v["promptFeedback"]["blockReason"].as_str() {
            return Err(format!("Gemini 가 요청을 차단했습니다 ({reason})."));
        }
        let candidate = &v["candidates"][0];
        for part in candidate["content"]["parts"].as_array().into_iter().flatten() {
            if part["thought"].as_bool() == Some(true) {
                emit(StreamEvent::Thinking);
                continue;
            }
            if let Some(t) = part["text"].as_str().filter(|t| !t.is_empty()) {
                self.out.text.push_str(t);
                emit(StreamEvent::Text { delta: t.to_string() });
            }
            if let Some(call) = part.get("functionCall") {
                let name = call["name"].as_str().unwrap_or_default().to_string();
                emit(StreamEvent::ToolCall { name: name.clone() });
                let n = self.out.tool_calls.len();
                self.out.tool_calls.push(ToolCall {
                    id: call["id"].as_str().map(str::to_string).unwrap_or_else(|| format!("gemini_{n}")),
                    name,
                    arguments: parse_arguments(&call["args"]),
                    signature: part["thoughtSignature"].as_str().map(str::to_string),
                });
            }
        }
        if let Some(r) = candidate["finishReason"].as_str() {
            self.out.stop_reason = Some(r.to_string());
        }
        if let Some(u) = v.get("usageMetadata") {
            self.out.usage = Some(Usage {
                input_tokens: u["promptTokenCount"].as_u64().unwrap_or(0),
                output_tokens: u["candidatesTokenCount"].as_u64().unwrap_or(0),
            });
        }
        Ok(false)
    }

    fn finish(self: Box<Self>) -> ChatResponse {
        self.out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(acc: Box<dyn Accumulator>, chunks: &[&str]) -> (ChatResponse, Vec<StreamEvent>) {
        let mut acc = acc;
        let mut sse = SseBuffer::default();
        let mut events = vec![];
        for c in chunks {
            for data in sse.push(c.as_bytes()) {
                acc.feed(&data, &mut |e| events.push(e)).unwrap();
            }
        }
        if let Some(data) = sse.finish() {
            acc.feed(&data, &mut |e| events.push(e)).unwrap();
        }
        (acc.finish(), events)
    }

    #[test]
    fn sse_buffer_handles_split_utf8_and_crlf() {
        let mut sse = SseBuffer::default();
        let bytes = "data: {\"t\":\"한글\"}\r\n\r\ndata: [DONE]\r\n\r\n".as_bytes();
        let (a, b) = bytes.split_at(12); // '한' 중간에서 자른다
        assert!(sse.push(a).is_empty());
        assert_eq!(sse.push(b), vec!["{\"t\":\"한글\"}".to_string(), "[DONE]".to_string()]);
    }

    #[test]
    fn openai_stream_joins_text_and_tool_arguments() {
        let (res, events) = run(Box::<OpenAiAcc>::default(), &[
            "data: {\"choices\":[{\"delta\":{\"content\":\"안\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"녕\",\"reasoning\":\"...\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"c1\",\"function\":{\"name\":\"read\",\"arguments\":\"{\\\"a\\\"\"}}]}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\":1}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n",
            "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":7,\"completion_tokens\":3}}\n\ndata: [DONE]\n\n",
        ]);
        assert_eq!(res.text, "안녕");
        assert_eq!(res.tool_calls[0].arguments["a"], 1);
        assert_eq!(res.usage.unwrap().input_tokens, 7);
        assert!(events.contains(&StreamEvent::Thinking));
        assert!(events.contains(&StreamEvent::ToolCall { name: "read".into() }));
    }

    #[test]
    fn anthropic_stream_builds_blocks() {
        let (res, _) = run(Box::<AnthropicAcc>::default(), &[
            "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":9}}}\n\n",
            "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\"}}\n\n",
            "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"표를\"}}\n\n",
            "data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"t1\",\"name\":\"insert_table\"}}\n\n",
            "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"rows\\\":\"}}\n\n",
            "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"[[\\\"a\\\"]]}\"}}\n\n",
            "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"},\"usage\":{\"output_tokens\":4}}\n\n",
            "data: {\"type\":\"message_stop\"}\n\n",
        ]);
        assert_eq!(res.text, "표를");
        assert_eq!(res.tool_calls[0].name, "insert_table");
        assert_eq!(res.tool_calls[0].arguments["rows"][0][0], "a");
        assert_eq!(res.usage.unwrap().output_tokens, 4);
    }

    #[test]
    fn gemini_stream_collects_parts() {
        let (res, _) = run(Box::<GeminiAcc>::default(), &[
            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"가\"}]}}]}\n\n",
            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"functionCall\":{\"name\":\"w\",\"args\":{\"x\":1}},\"thoughtSignature\":\"s\"}]},\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"promptTokenCount\":2,\"candidatesTokenCount\":1}}",
        ]);
        assert_eq!(res.text, "가");
        assert_eq!(res.tool_calls[0].signature.as_deref(), Some("s"));
        assert_eq!(res.usage.unwrap().input_tokens, 2);
    }

    #[test]
    fn stream_errors_surface() {
        let mut acc = OpenAiAcc::default();
        let err = acc.feed("{\"error\":{\"message\":\"model not found\"}}", &mut |_| {}).unwrap_err();
        assert!(err.contains("model not found"));
    }
}
