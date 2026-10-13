//! YHWP 전용: 폴더 안의 HWP/HWPX 문서를 CPU 코어 수만큼 병렬로 PDF 변환한다.
//! 결과 PDF는 원본 옆에 같은 이름으로 저장한다.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

use crate::pdf_export::export_core_to_pdf;
use crate::state::{atomic_write, editable_core_from_bytes};

const MAX_DEPTH: usize = 16;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BatchFailure {
    pub path: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchReport {
    pub total: usize,
    pub converted: usize,
    pub pages: u32,
    pub failed: Vec<BatchFailure>,
    pub elapsed_ms: u128,
    pub workers: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchProgress {
    done: usize,
    total: usize,
    path: String,
}

pub fn collect_documents(root: &Path, recursive: bool) -> Vec<PathBuf> {
    let mut out = Vec::new();
    walk(root, recursive, 0, &mut out);
    out.sort();
    out
}

fn walk(dir: &Path, recursive: bool, depth: usize, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            if recursive && depth < MAX_DEPTH {
                walk(&path, recursive, depth + 1, out);
            }
        } else if kind.is_file() && is_document(&path) {
            out.push(path);
        }
    }
}

fn is_document(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .as_deref(),
        Some("hwp") | Some("hwpx")
    )
}

pub fn pdf_target_for(path: &Path) -> PathBuf {
    path.with_extension("pdf")
}

/// 일괄 변환 대상 형식
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BatchTarget {
    Pdf,
    Hwp,
    Hwpx,
}

impl BatchTarget {
    fn extension(self) -> &'static str {
        match self {
            BatchTarget::Pdf => "pdf",
            BatchTarget::Hwp => "hwp",
            BatchTarget::Hwpx => "hwpx",
        }
    }

    /// 이미 같은 형식인 문서는 변환하지 않는다 (원본 덮어쓰기 방지)
    pub fn accepts(self, path: &Path) -> bool {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        ext != self.extension()
    }
}

fn convert_one(path: &Path, target: BatchTarget, font_dirs: &[PathBuf]) -> Result<u32, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("읽기 실패: {e}"))?;
    let core = editable_core_from_bytes(&bytes, "문서 파싱 실패", "문서 변환 실패")?;
    let output = match target {
        BatchTarget::Pdf => {
            return export_core_to_pdf(
                &core,
                &pdf_target_for(path),
                None,
                font_dirs.to_vec(),
                |_, _, _, _| {},
            );
        }
        BatchTarget::Hwp => core.export_hwp_native(),
        BatchTarget::Hwpx => core.export_hwpx_native(),
    }
    .map_err(|e| format!("저장 실패: {e}"))?;
    atomic_write(&path.with_extension(target.extension()), &output)?;
    Ok(core.page_count())
}

/// 순수 변환 루프 — Tauri 없이 테스트할 수 있게 분리했다.
pub fn convert_all(
    files: &[PathBuf],
    target: BatchTarget,
    font_dirs: &[PathBuf],
    on_done: impl Fn(usize, &Path) + Sync,
) -> BatchReport {
    let started = Instant::now();
    let workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(files.len().max(1));
    let next = AtomicUsize::new(0);
    let done = AtomicUsize::new(0);
    let pages = AtomicUsize::new(0);
    let failed = Mutex::new(Vec::new());

    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                let Some(path) = files.get(i) else { break };
                // 엔진 패닉이 일괄 작업 전체를 멈추지 않도록 문서 단위로 격리한다
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    convert_one(path, target, font_dirs)
                }))
                .unwrap_or_else(|_| Err("엔진 내부 오류(panic)".to_string()));
                match result {
                    Ok(n) => {
                        pages.fetch_add(n as usize, Ordering::Relaxed);
                    }
                    Err(error) => failed.lock().unwrap().push(BatchFailure {
                        path: path.display().to_string(),
                        error,
                    }),
                }
                on_done(done.fetch_add(1, Ordering::Relaxed) + 1, path);
            });
        }
    });

    let mut failed = failed.into_inner().unwrap();
    failed.sort_by(|a, b| a.path.cmp(&b.path));
    BatchReport {
        total: files.len(),
        converted: files.len() - failed.len(),
        pages: pages.into_inner() as u32,
        failed,
        elapsed_ms: started.elapsed().as_millis(),
        workers,
    }
}

#[tauri::command]
pub async fn batch_export_pdf(
    app: AppHandle,
    folder: String,
    recursive: bool,
    target: Option<BatchTarget>,
) -> Result<BatchReport, String> {
    let target = target.unwrap_or(BatchTarget::Pdf);
    let root = PathBuf::from(&folder);
    if !root.is_dir() {
        return Err(format!("폴더를 찾을 수 없습니다: {folder}"));
    }
    let font_dirs = crate::font_catalog::pdf_font_dirs(&app);
    tauri::async_runtime::spawn_blocking(move || {
        let files: Vec<PathBuf> = collect_documents(&root, recursive)
            .into_iter()
            .filter(|path| target.accepts(path))
            .collect();
        let total = files.len();
        convert_all(&files, target, &font_dirs, |done, path| {
            let _ = app.emit(
                "yhwp-batch-progress",
                BatchProgress {
                    done,
                    total,
                    path: path.display().to_string(),
                },
            );
        })
    })
    .await
    .map_err(|e| format!("일괄 변환 작업 실패: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collects_only_hwp_documents_case_insensitively() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("sub");
        std::fs::create_dir(&sub).unwrap();
        for name in ["a.hwp", "b.HWPX", "c.pdf", "d.txt"] {
            std::fs::write(dir.path().join(name), b"x").unwrap();
        }
        std::fs::write(sub.join("e.hwp"), b"x").unwrap();

        let flat = collect_documents(dir.path(), false);
        assert_eq!(flat.len(), 2);
        let deep = collect_documents(dir.path(), true);
        assert_eq!(deep.len(), 3);
    }

    #[test]
    fn pdf_target_replaces_extension() {
        assert_eq!(
            pdf_target_for(Path::new("x/보고서.hwpx")),
            PathBuf::from("x/보고서.pdf")
        );
    }

    #[test]
    fn broken_documents_are_reported_not_fatal() {
        let dir = tempfile::tempdir().unwrap();
        let bad = dir.path().join("broken.hwp");
        std::fs::write(&bad, b"not a real hwp").unwrap();
        let report = convert_all(std::slice::from_ref(&bad), BatchTarget::Pdf, &[], |_, _| {});
        assert_eq!(report.total, 1);
        assert_eq!(report.converted, 0);
        assert_eq!(report.failed.len(), 1);
        assert!(!pdf_target_for(&bad).exists());
    }

    #[test]
    fn converts_real_sample_documents_in_parallel() {
        let samples =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../third_party/rhwp/samples");
        let picks: Vec<PathBuf> = ["k-water-rfp.hwp", "exam_kor.hwp"]
            .iter()
            .map(|n| samples.join(n))
            .filter(|p| p.exists())
            .collect();
        if picks.is_empty() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let copies: Vec<PathBuf> = picks
            .iter()
            .map(|p| {
                let dst = dir.path().join(p.file_name().unwrap());
                std::fs::copy(p, &dst).unwrap();
                dst
            })
            .collect();
        let report = convert_all(&copies, BatchTarget::Pdf, &[], |_, _| {});
        assert_eq!(report.failed, Vec::<BatchFailure>::new());
        assert!(report.pages > 0);
        for c in &copies {
            assert!(pdf_target_for(c).metadata().unwrap().len() > 1000);
        }

        // HWP → HWPX 변환 결과는 다시 열려야 한다
        let report = convert_all(&copies, BatchTarget::Hwpx, &[], |_, _| {});
        assert_eq!(report.failed, Vec::<BatchFailure>::new());
        for c in &copies {
            let bytes = std::fs::read(c.with_extension("hwpx")).unwrap();
            assert!(editable_core_from_bytes(&bytes, "재열기 실패", "재열기 실패").is_ok());
        }
    }

    #[test]
    fn same_format_documents_are_skipped() {
        assert!(!BatchTarget::Hwp.accepts(Path::new("a.HWP")));
        assert!(BatchTarget::Hwp.accepts(Path::new("a.hwpx")));
        assert!(BatchTarget::Pdf.accepts(Path::new("a.hwp")));
    }
}
