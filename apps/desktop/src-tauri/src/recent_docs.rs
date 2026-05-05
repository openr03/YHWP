//! HOP 최근 문서 목록.
//!
//! `<app_data_dir>/recent_docs.json` 에 JSON 으로 저장한다.
//! - 최대 20 개 보관, path 기준 dedup, openedAt DESC 정렬
//! - 파일이 사라진 항목은 표시만 흐리게 (목록 자체에는 남겨 두어 사용자가 직접 정리 가능)
//!
//! Why: `tauri-plugin-store` 도 사용 가능하지만, 최근 문서 같은 단일 목적
//! 영속 데이터는 일반 JSON 파일로 직접 관리하는 편이 형식 변경/마이그레이션
//! 측면에서 더 다루기 쉽다.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

const MAX_ENTRIES: usize = 20;
const FILE_NAME: &str = "recent_docs.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentDoc {
    pub path: String,
    pub file_name: String,
    pub opened_at: u64,
    /// 파일이 현재 시점에 실제로 존재하는지. UI 표시용.
    /// 로드 시점에 매번 갱신되며 디스크에는 저장하지 않는다.
    #[serde(default = "default_exists", skip_serializing)]
    pub exists: bool,
}

fn default_exists() -> bool {
    true
}

#[derive(Default)]
pub struct RecentDocsState {
    cache: Mutex<Option<Vec<RecentDoc>>>,
}

impl RecentDocsState {
    fn load_or_init(&self, app: &AppHandle) -> Result<Vec<RecentDoc>, String> {
        let mut guard = self
            .cache
            .lock()
            .map_err(|_| "최근 문서 캐시 잠금 실패".to_string())?;
        if let Some(cached) = guard.as_ref() {
            return Ok(annotate_existence(cached.clone()));
        }
        let path = recent_docs_path(app)?;
        let entries = read_from_disk(&path)?;
        *guard = Some(entries.clone());
        Ok(annotate_existence(entries))
    }

    fn write(&self, app: &AppHandle, entries: Vec<RecentDoc>) -> Result<Vec<RecentDoc>, String> {
        let path = recent_docs_path(app)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "최근 문서 디렉터리를 만들 수 없습니다: {} ({})",
                    parent.display(),
                    e
                )
            })?;
        }
        let serialized = serde_json::to_string_pretty(&entries)
            .map_err(|e| format!("최근 문서 직렬화 실패: {}", e))?;
        fs::write(&path, serialized).map_err(|e| {
            format!(
                "최근 문서 저장 실패: {} ({})",
                path.display(),
                e
            )
        })?;
        let mut guard = self
            .cache
            .lock()
            .map_err(|_| "최근 문서 캐시 잠금 실패".to_string())?;
        *guard = Some(entries.clone());
        Ok(annotate_existence(entries))
    }
}

fn recent_docs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("앱 데이터 디렉터리를 찾을 수 없습니다: {}", e))?;
    Ok(dir.join(FILE_NAME))
}

fn read_from_disk(path: &Path) -> Result<Vec<RecentDoc>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(path).map_err(|e| {
        format!(
            "최근 문서 읽기 실패: {} ({})",
            path.display(),
            e
        )
    })?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str::<Vec<RecentDoc>>(&raw).map_err(|e| {
        format!(
            "최근 문서 JSON 파싱 실패: {} ({})",
            path.display(),
            e
        )
    })
}

fn annotate_existence(mut entries: Vec<RecentDoc>) -> Vec<RecentDoc> {
    for entry in &mut entries {
        entry.exists = Path::new(&entry.path).is_file();
    }
    entries
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn upsert(mut entries: Vec<RecentDoc>, new_entry: RecentDoc) -> Vec<RecentDoc> {
    entries.retain(|e| e.path != new_entry.path);
    entries.insert(0, new_entry);
    entries.truncate(MAX_ENTRIES);
    entries
}

#[tauri::command]
pub fn get_recent_docs(
    app: AppHandle,
    state: State<'_, RecentDocsState>,
) -> Result<Vec<RecentDoc>, String> {
    state.load_or_init(&app)
}

#[tauri::command]
pub fn add_recent_doc(
    path: String,
    file_name: String,
    app: AppHandle,
    state: State<'_, RecentDocsState>,
) -> Result<Vec<RecentDoc>, String> {
    let entries = state.load_or_init(&app)?;
    let updated = upsert(
        entries,
        RecentDoc {
            path,
            file_name,
            opened_at: now_millis(),
            exists: true,
        },
    );
    state.write(&app, updated)
}

#[tauri::command]
pub fn remove_recent_doc(
    path: String,
    app: AppHandle,
    state: State<'_, RecentDocsState>,
) -> Result<Vec<RecentDoc>, String> {
    let mut entries = state.load_or_init(&app)?;
    entries.retain(|e| e.path != path);
    state.write(&app, entries)
}

#[tauri::command]
pub fn clear_recent_docs(
    app: AppHandle,
    state: State<'_, RecentDocsState>,
) -> Result<(), String> {
    state.write(&app, Vec::new())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(path: &str, opened_at: u64) -> RecentDoc {
        RecentDoc {
            path: path.to_string(),
            file_name: path.rsplit('/').next().unwrap_or(path).to_string(),
            opened_at,
            exists: true,
        }
    }

    #[test]
    fn upsert_inserts_at_front_and_dedups_by_path() {
        let entries = vec![sample("/a.hwp", 1), sample("/b.hwp", 2)];
        let updated = upsert(entries, sample("/b.hwp", 3));
        assert_eq!(updated.len(), 2);
        assert_eq!(updated[0].path, "/b.hwp");
        assert_eq!(updated[0].opened_at, 3);
        assert_eq!(updated[1].path, "/a.hwp");
    }

    #[test]
    fn upsert_truncates_to_max_entries() {
        let mut entries = Vec::new();
        for i in 0..MAX_ENTRIES {
            entries.push(sample(&format!("/doc-{}.hwp", i), i as u64));
        }
        let updated = upsert(entries, sample("/new.hwp", 999));
        assert_eq!(updated.len(), MAX_ENTRIES);
        assert_eq!(updated[0].path, "/new.hwp");
    }

    #[test]
    fn read_from_disk_returns_empty_when_file_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing.json");
        assert!(read_from_disk(&path).unwrap().is_empty());
    }

    #[test]
    fn read_from_disk_returns_empty_for_blank_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("blank.json");
        fs::write(&path, "").unwrap();
        assert!(read_from_disk(&path).unwrap().is_empty());
    }

    #[test]
    fn annotate_existence_marks_missing_paths_false() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real.hwp");
        fs::write(&real, b"x").unwrap();
        let entries = vec![
            sample(real.to_str().unwrap(), 1),
            sample("/definitely/missing.hwp", 2),
        ];
        let annotated = annotate_existence(entries);
        assert!(annotated[0].exists);
        assert!(!annotated[1].exists);
    }
}
