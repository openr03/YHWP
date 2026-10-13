//! 폴더 일괄 AI 작업용 파일 다루기: 문서 목록, 쪽 번호가 붙은 본문 글 뽑기, 결과 보고서 쓰기.
//! AI 호출과 진행 표시는 화면 쪽이 맡고, 파일과 문서 엔진은 여기서만 다룬다.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::batch_convert::collect_documents;
use crate::state::{atomic_write, editable_core_from_bytes};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocText {
    pub pages: u32,
    /// "[n쪽]" 머리가 붙은 쪽별 본문
    pub text: String,
    pub truncated: bool,
}

fn is_document(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref(),
        Some("hwp") | Some("hwpx")
    )
}

/// 쪽마다 "[n쪽]" 을 붙여 본문을 뽑는다. max_chars 를 넘으면 그 쪽에서 멈춘다.
pub fn extract_text(path: &Path, max_chars: usize) -> Result<DocText, String> {
    if !is_document(path) {
        return Err("HWP·HWPX 문서만 읽을 수 있습니다.".into());
    }
    let bytes = std::fs::read(path).map_err(|e| format!("읽기 실패: {e}"))?;
    let core = editable_core_from_bytes(&bytes, "문서 파싱 실패", "문서 변환 실패")?;
    let pages = core.page_count();
    let mut text = String::new();
    let mut count = 0usize;
    let mut truncated = false;
    for page in 0..pages {
        let body = core.extract_page_text_native(page).unwrap_or_default();
        let body = body.trim();
        if body.is_empty() {
            continue;
        }
        let n = body.chars().count();
        if count + n > max_chars && count > 0 {
            truncated = true;
            break;
        }
        text.push_str(&format!("[{}쪽]\n{body}\n\n", page + 1));
        count += n;
    }
    Ok(DocText { pages, text, truncated })
}

/// 같은 이름이 있으면 " (2)" 처럼 번호를 붙여 덮어쓰지 않는다.
fn unique_path(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("결과");
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("md");
    (2..1000)
        .map(|i| path.with_file_name(format!("{stem} ({i}).{ext}")))
        .find(|p| !p.exists())
        .unwrap_or_else(|| path.to_path_buf())
}

pub fn write_report(path: &Path, content: &str) -> Result<PathBuf, String> {
    let ext = path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase);
    if !matches!(ext.as_deref(), Some("md") | Some("txt")) {
        return Err("결과는 .md 또는 .txt 로만 저장합니다.".into());
    }
    let target = unique_path(path);
    // 메모장에서도 한글이 깨지지 않게 UTF-8 BOM 을 붙인다
    let mut bytes = "\u{feff}".as_bytes().to_vec();
    bytes.extend_from_slice(content.as_bytes());
    atomic_write(&target, &bytes)?;
    Ok(target)
}

#[tauri::command]
pub fn ai_batch_list(folder: String, recursive: bool) -> Result<Vec<String>, String> {
    let root = PathBuf::from(&folder);
    if !root.is_dir() {
        return Err("폴더를 찾을 수 없습니다.".into());
    }
    Ok(collect_documents(&root, recursive).into_iter().map(|p| p.to_string_lossy().into_owned()).collect())
}

#[tauri::command]
pub async fn ai_doc_text(path: String, max_chars: Option<usize>) -> Result<DocText, String> {
    let limit = max_chars.unwrap_or(200_000).clamp(1_000, 2_000_000);
    tauri::async_runtime::spawn_blocking(move || extract_text(Path::new(&path), limit))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn ai_write_report(path: String, content: String) -> Result<String, String> {
    write_report(Path::new(&path), &content).map(|p| p.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_never_overwrites_and_rejects_other_extensions() {
        let dir = tempfile::tempdir().unwrap();
        let first = write_report(&dir.path().join("요약.md"), "가").unwrap();
        let second = write_report(&dir.path().join("요약.md"), "나").unwrap();
        assert_ne!(first, second);
        assert!(second.to_string_lossy().ends_with("요약 (2).md"));
        assert_eq!(std::fs::read_to_string(&first).unwrap(), "\u{feff}가");
        assert!(write_report(&dir.path().join("x.exe"), "x").is_err());
        assert!(extract_text(&dir.path().join("a.txt"), 10).is_err());
    }
}
