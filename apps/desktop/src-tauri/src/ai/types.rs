//! 공급자 중립 대화 형식.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Openai,
    Anthropic,
    Gemini,
    Ollama,
    Lmstudio,
    Custom,
}

impl Provider {
    pub(crate) fn key_slot(self) -> &'static str {
        match self {
            Provider::Openai => "openai",
            Provider::Anthropic => "anthropic",
            Provider::Gemini => "gemini",
            Provider::Ollama => "ollama",
            Provider::Lmstudio => "lmstudio",
            Provider::Custom => "custom",
        }
    }

    pub(crate) fn label(self) -> &'static str {
        match self {
            Provider::Openai => "OpenAI",
            Provider::Anthropic => "Claude",
            Provider::Gemini => "Gemini",
            Provider::Ollama => "Ollama",
            Provider::Lmstudio => "LM Studio",
            Provider::Custom => "AI 서버",
        }
    }

    pub(crate) fn needs_key(self) -> bool {
        matches!(self, Provider::Openai | Provider::Anthropic | Provider::Gemini)
    }

    /// 클라우드 공급자는 주소를 고정한다. 로컬·호환 서버만 사용자가 정한 주소를 쓴다.
    pub(crate) fn base_url(self, custom: Option<&str>) -> Result<String, String> {
        let fixed = match self {
            Provider::Openai => return Ok("https://api.openai.com/v1".into()),
            Provider::Anthropic => return Ok("https://api.anthropic.com".into()),
            Provider::Gemini => return Ok("https://generativelanguage.googleapis.com".into()),
            Provider::Ollama => "http://localhost:11434/v1",
            Provider::Lmstudio => "http://localhost:1234/v1",
            Provider::Custom => "",
        };
        let url = custom.map(str::trim).filter(|u| !u.is_empty()).unwrap_or(fixed);
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return Err("서버 주소는 http:// 또는 https:// 로 시작해야 합니다.".into());
        }
        Ok(url.trim_end_matches('/').to_string())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub arguments: Value,
    /// Gemini 의 thoughtSignature 처럼 다음 요청에 그대로 돌려줘야 하는 값
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Msg {
    pub role: Role,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub tool_calls: Vec<ToolCall>,
    #[serde(default)]
    pub tool_call_id: Option<String>,
    #[serde(default)]
    pub tool_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub provider: Provider,
    #[serde(default)]
    pub base_url: Option<String>,
    pub model: String,
    #[serde(default)]
    pub system: String,
    pub messages: Vec<Msg>,
    #[serde(default)]
    pub tools: Vec<ToolDef>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponse {
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
    pub stop_reason: Option<String>,
    pub usage: Option<Usage>,
}

pub(crate) const DEFAULT_MAX_TOKENS: u32 = 8192;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cloud_providers_ignore_custom_base_url() {
        assert_eq!(Provider::Openai.base_url(Some("http://evil")).unwrap(), "https://api.openai.com/v1");
        assert_eq!(Provider::Ollama.base_url(None).unwrap(), "http://localhost:11434/v1");
        assert_eq!(Provider::Custom.base_url(Some("http://pc:8080/v1/")).unwrap(), "http://pc:8080/v1");
        assert!(Provider::Custom.base_url(None).is_err());
    }
}
