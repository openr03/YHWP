//! 자동 저장과 비정상 종료 후 복구.
//!
//! 편집 중인 문서는 일정 간격으로 앱 데이터 폴더의 `autosave/` 에 `<pid>-<창>.hwp` 로 저장된다.
//! 창이 정상적으로 닫히면 해당 파일을 지운다. 다음 실행 때 다른 프로세스(pid)가 남긴 파일이
//! 있으면 비정상 종료로 보고 복구 목록에 올린다.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

const AUTOSAVE_DIR: &str = "autosave";
const NAME_HEADER: &str = "x-yhwp-name";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryEntry {
    pub path: String,
    pub name: String,
    pub saved_at: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Meta {
    name: String,
    saved_at: u64,
}

fn autosave_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("자동 저장 위치를 찾을 수 없습니다: {e}"))?
        .join(AUTOSAVE_DIR);
    fs::create_dir_all(&dir).map_err(|e| format!("자동 저장 폴더를 만들 수 없습니다: {e}"))?;
    Ok(dir)
}

fn sanitize_label(label: &str) -> String {
    label
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn slot_stem(pid: u32, label: &str) -> String {
    format!("{pid}-{}", sanitize_label(label))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// encodeURIComponent 로 보낸 헤더 값을 되돌린다 (잘못된 시퀀스는 그대로 둔다).
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&value[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

pub fn write_slot(
    dir: &Path,
    pid: u32,
    label: &str,
    name: &str,
    bytes: &[u8],
) -> Result<(), String> {
    let stem = slot_stem(pid, label);
    write_atomic(&dir.join(format!("{stem}.hwp")), bytes)?;
    let meta = Meta {
        name: name.to_string(),
        saved_at: now_ms(),
    };
    let json = serde_json::to_vec(&meta).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(format!("{stem}.json")), &json)
}

pub fn clear_slot(dir: &Path, pid: u32, label: &str) {
    let stem = slot_stem(pid, label);
    let _ = fs::remove_file(dir.join(format!("{stem}.hwp")));
    let _ = fs::remove_file(dir.join(format!("{stem}.json")));
}

/// 현재 프로세스가 아닌 다른 실행이 남긴 자동 저장 파일 목록 (최근 것 먼저)
pub fn list_orphans(dir: &Path, current_pid: u32) -> Vec<RecoveryEntry> {
    let own_prefix = format!("{current_pid}-");
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut found: Vec<RecoveryEntry> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "hwp"))
        .filter(|path| {
            path.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| !n.starts_with(&own_prefix))
        })
        .filter_map(|path| {
            let meta: Meta =
                serde_json::from_slice(&fs::read(path.with_extension("json")).ok()?).ok()?;
            Some(RecoveryEntry {
                path: path.to_string_lossy().into_owned(),
                name: meta.name,
                saved_at: meta.saved_at,
            })
        })
        .collect();
    found.sort_by_key(|entry| std::cmp::Reverse(entry.saved_at));
    found
}

fn discard_in(dir: &Path, path: &Path) -> Result<(), String> {
    let canonical_dir = dir.canonicalize().map_err(|e| e.to_string())?;
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    if canonical.parent() != Some(canonical_dir.as_path()) {
        return Err("자동 저장 폴더 밖의 파일은 지울 수 없습니다".into());
    }
    let _ = fs::remove_file(canonical.with_extension("json"));
    fs::remove_file(&canonical).map_err(|e| e.to_string())
}

/// 창이 정상적으로 닫힐 때 그 창의 자동 저장 파일을 지운다.
pub fn clear_for_window<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Ok(dir) = autosave_dir(app) {
        clear_slot(&dir, std::process::id(), label);
    }
}

#[tauri::command]
pub fn autosave_write(window: WebviewWindow, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("자동 저장 데이터 형식이 올바르지 않습니다".into());
    };
    let name = request
        .headers()
        .get(NAME_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .unwrap_or_default();
    let dir = autosave_dir(window.app_handle())?;
    write_slot(&dir, std::process::id(), window.label(), &name, bytes)
}

#[tauri::command]
pub fn autosave_clear(window: WebviewWindow) {
    clear_for_window(window.app_handle(), window.label());
}

#[tauri::command]
pub fn autosave_list_recoverable(app: AppHandle) -> Result<Vec<RecoveryEntry>, String> {
    Ok(list_orphans(&autosave_dir(&app)?, std::process::id()))
}

#[tauri::command]
pub fn autosave_discard(app: AppHandle, path: String) -> Result<(), String> {
    discard_in(&autosave_dir(&app)?, Path::new(&path))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("yhwp-autosave-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn percent_decoding_restores_korean_names() {
        assert_eq!(percent_decode("%EB%AC%B8%EC%84%9C.hwp"), "문서.hwp");
        assert_eq!(percent_decode("100%"), "100%");
    }

    #[test]
    fn orphans_exclude_current_process_and_sort_newest_first() {
        let dir = temp_dir("list");
        write_slot(&dir, 10, "main", "옛 문서.hwp", b"old").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        write_slot(&dir, 11, "main-2", "새 문서.hwp", b"new").unwrap();
        write_slot(&dir, 99, "main", "현재.hwp", b"cur").unwrap();
        let names: Vec<_> = list_orphans(&dir, 99).into_iter().map(|e| e.name).collect();
        assert_eq!(names, vec!["새 문서.hwp", "옛 문서.hwp"]);
        clear_slot(&dir, 11, "main-2");
        assert_eq!(list_orphans(&dir, 99).len(), 1);
    }

    #[test]
    fn labels_are_sanitized_and_discard_stays_inside_dir() {
        let dir = temp_dir("discard");
        write_slot(&dir, 7, "../evil", "x", b"x").unwrap();
        let entry = list_orphans(&dir, 1).pop().unwrap();
        assert!(Path::new(&entry.path).starts_with(&dir));
        let outside = std::env::temp_dir().join(format!("yhwp-outside-{}.hwp", std::process::id()));
        fs::write(&outside, b"keep").unwrap();
        assert!(discard_in(&dir, &outside).is_err());
        assert!(outside.exists());
        discard_in(&dir, Path::new(&entry.path)).unwrap();
        assert!(list_orphans(&dir, 1).is_empty());
        let _ = fs::remove_file(outside);
    }
}
