//! AI 도우미 연결부. 화면(웹뷰)은 공급자·모델·대화만 넘기고, API 키와 HTTP 요청은 여기서만 다룬다.
//!
//! - 클라우드: OpenAI, Anthropic(Claude), Google Gemini — 공식 주소로만 보낸다(키 유출 방지).
//! - 로컬: Ollama, LM Studio, 그리고 사용자가 주소를 정하는 OpenAI 호환 서버.
//! - 키는 Windows 자격 증명 관리자(그 밖의 OS 는 설정 폴더의 파일)에 보관한다.
//!
//! 대화 형식은 공급자 중립(`Msg`/`ToolCall`)으로 받아 공급자별 요청으로 바꾸고(`wire`),
//! 응답도 다시 중립 형식(`ChatResponse`)으로 돌려준다. 실시간 응답은 `stream` 이 읽는다.

pub mod batch;
mod http;
mod keystore;
mod models;
mod stream;
mod types;
mod wire;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::Notify;

pub use stream::StreamEvent;
pub use types::{ChatRequest, ChatResponse, Provider};

#[derive(Default)]
pub struct AiState {
    running: Mutex<HashMap<String, Arc<Notify>>>,
}

#[tauri::command]
pub async fn ai_chat(state: tauri::State<'_, AiState>, request_id: String, request: ChatRequest) -> Result<ChatResponse, String> {
    let cancel = Arc::new(Notify::new());
    state.running.lock().unwrap().insert(request_id.clone(), cancel.clone());
    let result = tokio::select! {
        r = http::chat(request) => r,
        _ = cancel.notified() => Err("취소했습니다.".into()),
    };
    state.running.lock().unwrap().remove(&request_id);
    result
}

/// 실시간으로 받으며 조각마다 화면에 사건을 보낸다.
#[tauri::command]
pub async fn ai_chat_stream(
    state: tauri::State<'_, AiState>,
    request_id: String,
    request: ChatRequest,
    on_event: tauri::ipc::Channel<StreamEvent>,
) -> Result<ChatResponse, String> {
    let cancel = Arc::new(Notify::new());
    state.running.lock().unwrap().insert(request_id.clone(), cancel.clone());
    let mut emit = move |event: StreamEvent| {
        let _ = on_event.send(event);
    };
    let result = tokio::select! {
        r = http::chat_stream(request, &mut emit) => r,
        _ = cancel.notified() => Err("취소했습니다.".into()),
    };
    state.running.lock().unwrap().remove(&request_id);
    result
}

#[tauri::command]
pub fn ai_cancel(state: tauri::State<'_, AiState>, request_id: String) {
    if let Some(n) = state.running.lock().unwrap().remove(&request_id) {
        n.notify_one();
    }
}

#[tauri::command]
pub async fn ai_list_models(provider: Provider, base_url: Option<String>) -> Result<Vec<String>, String> {
    models::list_models(provider, base_url).await
}

#[tauri::command]
pub fn ai_set_key(provider: Provider, key: String) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return keystore::delete(provider.key_slot());
    }
    keystore::write(provider.key_slot(), key)
}

#[tauri::command]
pub fn ai_has_key(provider: Provider) -> Result<bool, String> {
    Ok(keystore::read(provider.key_slot())?.is_some())
}
