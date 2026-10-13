//! 공급자별 요청 본문 만들기와 응답 읽기 (순수 함수).

use serde_json::{json, Map, Value};

use super::types::*;

pub(super) fn parse_arguments(value: &Value) -> Value {
    match value {
        Value::String(text) => serde_json::from_str(text).unwrap_or_else(|_| json!({})),
        Value::Null => json!({}),
        other => other.clone(),
    }
}

pub(super) fn openai_body(req: &ChatRequest, official: bool) -> Value {
    let mut messages = vec![];
    if !req.system.is_empty() {
        messages.push(json!({ "role": "system", "content": req.system }));
    }
    for m in &req.messages {
        match m.role {
            Role::User => messages.push(json!({ "role": "user", "content": m.content })),
            Role::Assistant => {
                let mut msg = json!({ "role": "assistant", "content": if m.content.is_empty() { Value::Null } else { json!(m.content) } });
                if !m.tool_calls.is_empty() {
                    msg["tool_calls"] = m
                        .tool_calls
                        .iter()
                        .map(|c| json!({ "id": c.id, "type": "function", "function": { "name": c.name, "arguments": c.arguments.to_string() } }))
                        .collect();
                }
                messages.push(msg);
            }
            Role::Tool => messages.push(json!({ "role": "tool", "tool_call_id": m.tool_call_id, "content": m.content })),
        }
    }
    let mut body = json!({ "model": req.model, "messages": messages });
    let max = req.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS);
    // OpenAI 의 최신(추론) 모델은 max_tokens 를 거부한다. 로컬 서버는 max_tokens 만 안다.
    body[if official { "max_completion_tokens" } else { "max_tokens" }] = json!(max);
    if !req.tools.is_empty() {
        body["tools"] = req
            .tools
            .iter()
            .map(|t| json!({ "type": "function", "function": { "name": t.name, "description": t.description, "parameters": t.parameters } }))
            .collect();
    }
    body
}

pub(super) fn parse_openai(v: &Value) -> Result<ChatResponse, String> {
    let choice = v["choices"].get(0).ok_or_else(|| "응답에 결과가 없습니다.".to_string())?;
    let msg = &choice["message"];
    let tool_calls = msg["tool_calls"]
        .as_array()
        .map(|calls| {
            calls
                .iter()
                .enumerate()
                .map(|(i, c)| ToolCall {
                    id: c["id"].as_str().map(str::to_string).unwrap_or_else(|| format!("call_{i}")),
                    name: c["function"]["name"].as_str().unwrap_or_default().to_string(),
                    arguments: parse_arguments(&c["function"]["arguments"]),
                    signature: None,
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(ChatResponse {
        text: msg["content"].as_str().unwrap_or_default().to_string(),
        tool_calls,
        stop_reason: choice["finish_reason"].as_str().map(str::to_string),
        usage: v.get("usage").map(|u| Usage {
            input_tokens: u["prompt_tokens"].as_u64().unwrap_or(0),
            output_tokens: u["completion_tokens"].as_u64().unwrap_or(0),
        }),
    })
}

pub(super) fn anthropic_body(req: &ChatRequest) -> Value {
    let mut messages: Vec<Value> = vec![];
    for m in &req.messages {
        match m.role {
            Role::User => messages.push(json!({ "role": "user", "content": m.content })),
            Role::Assistant => {
                let mut blocks = vec![];
                if !m.content.is_empty() {
                    blocks.push(json!({ "type": "text", "text": m.content }));
                }
                for c in &m.tool_calls {
                    blocks.push(json!({ "type": "tool_use", "id": c.id, "name": c.name, "input": c.arguments }));
                }
                messages.push(json!({ "role": "assistant", "content": blocks }));
            }
            Role::Tool => {
                let block = json!({ "type": "tool_result", "tool_use_id": m.tool_call_id, "content": m.content });
                // 연속된 도구 결과는 사용자 메시지 하나로 묶어야 한다
                match messages.last_mut() {
                    Some(last) if last["role"] == "user" && last["content"].is_array() => {
                        last["content"].as_array_mut().unwrap().push(block)
                    }
                    _ => messages.push(json!({ "role": "user", "content": [block] })),
                }
            }
        }
    }
    let mut body = json!({
        "model": req.model,
        "max_tokens": req.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS),
        "messages": messages,
    });
    if !req.system.is_empty() {
        body["system"] = json!(req.system);
    }
    if !req.tools.is_empty() {
        body["tools"] = req
            .tools
            .iter()
            .map(|t| json!({ "name": t.name, "description": t.description, "input_schema": t.parameters }))
            .collect();
    }
    body
}

pub(super) fn parse_anthropic(v: &Value) -> Result<ChatResponse, String> {
    let blocks = v["content"].as_array().ok_or_else(|| "응답에 결과가 없습니다.".to_string())?;
    let mut out = ChatResponse::default();
    for b in blocks {
        match b["type"].as_str() {
            Some("text") => out.text.push_str(b["text"].as_str().unwrap_or_default()),
            Some("tool_use") => out.tool_calls.push(ToolCall {
                id: b["id"].as_str().unwrap_or_default().to_string(),
                name: b["name"].as_str().unwrap_or_default().to_string(),
                arguments: parse_arguments(&b["input"]),
                signature: None,
            }),
            _ => {}
        }
    }
    out.stop_reason = v["stop_reason"].as_str().map(str::to_string);
    out.usage = v.get("usage").map(|u| Usage {
        input_tokens: u["input_tokens"].as_u64().unwrap_or(0),
        output_tokens: u["output_tokens"].as_u64().unwrap_or(0),
    });
    Ok(out)
}

/// Gemini 함수 선언은 JSON Schema 의 일부만 받는다. 모르는 키를 걷어낸다.
pub(super) fn gemini_schema(schema: &Value) -> Value {
    const KEEP: &[&str] = &["type", "description", "enum", "items", "properties", "required", "nullable", "minimum", "maximum", "format"];
    match schema {
        Value::Object(map) => {
            let mut out = Map::new();
            for (k, v) in map {
                if !KEEP.contains(&k.as_str()) {
                    continue;
                }
                let v = match k.as_str() {
                    "properties" => Value::Object(
                        v.as_object()
                            .map(|p| p.iter().map(|(name, s)| (name.clone(), gemini_schema(s))).collect())
                            .unwrap_or_default(),
                    ),
                    "items" => gemini_schema(v),
                    _ => v.clone(),
                };
                out.insert(k.clone(), v);
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

pub(super) fn gemini_body(req: &ChatRequest) -> Value {
    let mut contents: Vec<Value> = vec![];
    for m in &req.messages {
        match m.role {
            Role::User => contents.push(json!({ "role": "user", "parts": [{ "text": m.content }] })),
            Role::Assistant => {
                let mut parts = vec![];
                if !m.content.is_empty() {
                    parts.push(json!({ "text": m.content }));
                }
                for c in &m.tool_calls {
                    let mut part = json!({ "functionCall": { "name": c.name, "args": c.arguments } });
                    if let Some(sig) = &c.signature {
                        part["thoughtSignature"] = json!(sig);
                    }
                    parts.push(part);
                }
                if parts.is_empty() {
                    parts.push(json!({ "text": "" }));
                }
                contents.push(json!({ "role": "model", "parts": parts }));
            }
            Role::Tool => {
                let response = serde_json::from_str::<Value>(&m.content)
                    .ok()
                    .filter(Value::is_object)
                    .unwrap_or_else(|| json!({ "result": m.content }));
                let part = json!({ "functionResponse": { "name": m.tool_name.clone().unwrap_or_default(), "response": response } });
                match contents.last_mut() {
                    Some(last) if last["role"] == "user" && last["parts"][0].get("functionResponse").is_some() => {
                        last["parts"].as_array_mut().unwrap().push(part)
                    }
                    _ => contents.push(json!({ "role": "user", "parts": [part] })),
                }
            }
        }
    }
    let mut body = json!({
        "contents": contents,
        "generationConfig": { "maxOutputTokens": req.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS) },
    });
    if !req.system.is_empty() {
        body["systemInstruction"] = json!({ "parts": [{ "text": req.system }] });
    }
    if !req.tools.is_empty() {
        let decls: Vec<Value> = req
            .tools
            .iter()
            .map(|t| json!({ "name": t.name, "description": t.description, "parameters": gemini_schema(&t.parameters) }))
            .collect();
        body["tools"] = json!([{ "functionDeclarations": decls }]);
    }
    body
}

pub(super) fn parse_gemini(v: &Value) -> Result<ChatResponse, String> {
    let Some(candidate) = v["candidates"].get(0) else {
        let reason = v["promptFeedback"]["blockReason"].as_str().unwrap_or("알 수 없음");
        return Err(format!("Gemini 가 요청을 차단했습니다 ({reason})."));
    };
    let mut out = ChatResponse::default();
    for (i, part) in candidate["content"]["parts"].as_array().into_iter().flatten().enumerate() {
        if part["thought"].as_bool() == Some(true) {
            continue;
        }
        if let Some(text) = part["text"].as_str() {
            out.text.push_str(text);
        }
        if let Some(call) = part.get("functionCall") {
            out.tool_calls.push(ToolCall {
                id: call["id"].as_str().map(str::to_string).unwrap_or_else(|| format!("gemini_{i}")),
                name: call["name"].as_str().unwrap_or_default().to_string(),
                arguments: parse_arguments(&call["args"]),
                signature: part["thoughtSignature"].as_str().map(str::to_string),
            });
        }
    }
    out.stop_reason = candidate["finishReason"].as_str().map(str::to_string);
    out.usage = v.get("usageMetadata").map(|u| Usage {
        input_tokens: u["promptTokenCount"].as_u64().unwrap_or(0),
        output_tokens: u["candidatesTokenCount"].as_u64().unwrap_or(0),
    });
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample() -> ChatRequest {
        serde_json::from_value(json!({
            "provider": "openai",
            "model": "m",
            "system": "sys",
            "messages": [
                { "role": "user", "content": "표 만들어" },
                { "role": "assistant", "content": "", "toolCalls": [
                    { "id": "c1", "name": "read", "arguments": { "a": 1 }, "signature": "sig" },
                    { "id": "c2", "name": "write", "arguments": {} }
                ] },
                { "role": "tool", "content": "{\"ok\":true}", "toolCallId": "c1", "toolName": "read" },
                { "role": "tool", "content": "done", "toolCallId": "c2", "toolName": "write" }
            ],
            "tools": [{ "name": "read", "description": "d", "parameters": { "type": "object", "additionalProperties": false, "properties": { "a": { "type": "integer" } } } }]
        }))
        .unwrap()
    }

    #[test]
    fn openai_round_trip() {
        let body = openai_body(&sample(), true);
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][2]["tool_calls"][0]["function"]["arguments"], "{\"a\":1}");
        assert_eq!(body["messages"][3]["tool_call_id"], "c1");
        assert!(body.get("max_completion_tokens").is_some());
        assert!(openai_body(&sample(), false).get("max_tokens").is_some());

        let res = parse_openai(&json!({
            "choices": [{ "message": { "content": null, "tool_calls": [
                { "id": "x", "function": { "name": "write", "arguments": "{\"t\":\"가\"}" } }
            ] }, "finish_reason": "tool_calls" }],
            "usage": { "prompt_tokens": 5, "completion_tokens": 2 }
        }))
        .unwrap();
        assert_eq!(res.tool_calls[0].arguments, json!({ "t": "가" }));
        assert_eq!(res.usage.unwrap().input_tokens, 5);
    }

    #[test]
    fn anthropic_merges_tool_results() {
        let body = anthropic_body(&sample());
        assert_eq!(body["system"], "sys");
        let msgs = body["messages"].as_array().unwrap();
        assert_eq!(msgs.len(), 3);
        assert_eq!(msgs[1]["content"][0]["type"], "tool_use");
        assert_eq!(msgs[2]["content"].as_array().unwrap().len(), 2);
        assert_eq!(body["tools"][0]["input_schema"]["type"], "object");

        let res = parse_anthropic(&json!({
            "content": [{ "type": "text", "text": "네" }, { "type": "tool_use", "id": "t", "name": "n", "input": { "k": 1 } }],
            "stop_reason": "tool_use", "usage": { "input_tokens": 1, "output_tokens": 2 }
        }))
        .unwrap();
        assert_eq!(res.text, "네");
        assert_eq!(res.tool_calls[0].arguments["k"], 1);
    }

    #[test]
    fn gemini_keeps_signatures_and_cleans_schema() {
        let body = gemini_body(&sample());
        let contents = body["contents"].as_array().unwrap();
        assert_eq!(contents.len(), 3);
        assert_eq!(contents[1]["parts"][0]["thoughtSignature"], "sig");
        assert_eq!(contents[2]["parts"].as_array().unwrap().len(), 2);
        assert_eq!(contents[2]["parts"][0]["functionResponse"]["response"]["ok"], true);
        assert_eq!(contents[2]["parts"][1]["functionResponse"]["response"]["result"], "done");
        let params = &body["tools"][0]["functionDeclarations"][0]["parameters"];
        assert!(params.get("additionalProperties").is_none());

        let res = parse_gemini(&json!({
            "candidates": [{ "content": { "parts": [
                { "text": "생각", "thought": true },
                { "functionCall": { "name": "w", "args": { "x": 2 } }, "thoughtSignature": "s2" }
            ] }, "finishReason": "STOP" }]
        }))
        .unwrap();
        assert_eq!(res.text, "");
        assert_eq!(res.tool_calls[0].signature.as_deref(), Some("s2"));
        assert!(parse_gemini(&json!({ "promptFeedback": { "blockReason": "SAFETY" } })).is_err());
    }
}
