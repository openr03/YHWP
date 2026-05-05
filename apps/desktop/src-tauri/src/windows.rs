use std::path::PathBuf;
use tauri::{
    AppHandle, DragDropEvent, Emitter, LogicalSize, Manager, Size, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use uuid::Uuid;

const MIN_EDITOR_WINDOW_WIDTH: f64 = 960.0;
const MIN_EDITOR_WINDOW_HEIGHT: f64 = 720.0;
const NEW_WINDOW_PREFERRED_WIDTH: f64 = 1100.0;
const NEW_WINDOW_PREFERRED_HEIGHT: f64 = 760.0;
const NEW_WINDOW_MAX_WORK_AREA_RATIO: f64 = 0.85;

pub fn create_editor_window(app: &AppHandle) -> Result<String, String> {
    let label = new_editor_window_label();
    create_editor_window_with_label(app, &label)?;
    Ok(label)
}

pub fn new_editor_window_label() -> String {
    format!("main{}", Uuid::new_v4().simple())
}

pub fn create_editor_window_with_label(app: &AppHandle, label: &str) -> Result<(), String> {
    let (width, height) = new_window_size(app);

    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("YHWP")
        .inner_size(width, height)
        .min_inner_size(MIN_EDITOR_WINDOW_WIDTH, MIN_EDITOR_WINDOW_HEIGHT)
        .center();
    #[cfg(windows)]
    let builder = builder.zoom_hotkeys_enabled(true);

    let window = builder
        .build()
        .map_err(|e| format!("새 창 생성 실패: {}", e))?;
    install_editor_window_minimum(&window);
    attach_document_drop_handler(app, &window);
    attach_pending_open_cleanup(app, &window);
    let _ = window.set_focus();

    Ok(())
}

fn new_window_size(app: &AppHandle) -> (f64, f64) {
    let (max_width, max_height) = active_monitor_logical_work_area(app)
        .map(|(width, height)| {
            (
                (width * NEW_WINDOW_MAX_WORK_AREA_RATIO).floor(),
                (height * NEW_WINDOW_MAX_WORK_AREA_RATIO).floor(),
            )
        })
        .unwrap_or((NEW_WINDOW_PREFERRED_WIDTH, NEW_WINDOW_PREFERRED_HEIGHT));

    (
        clamped_new_window_dimension(
            NEW_WINDOW_PREFERRED_WIDTH,
            MIN_EDITOR_WINDOW_WIDTH,
            max_width,
        ),
        clamped_new_window_dimension(
            NEW_WINDOW_PREFERRED_HEIGHT,
            MIN_EDITOR_WINDOW_HEIGHT,
            max_height,
        ),
    )
}

fn active_monitor_logical_work_area(app: &AppHandle) -> Option<(f64, f64)> {
    let monitor = target_window_label(app)
        .and_then(|label| app.get_webview_window(&label))
        .and_then(|window| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())?;
    let scale_factor = monitor.scale_factor();
    if scale_factor <= 0.0 {
        return None;
    }
    let work_area = monitor.work_area();
    Some((
        f64::from(work_area.size.width) / scale_factor,
        f64::from(work_area.size.height) / scale_factor,
    ))
}

fn clamped_new_window_dimension(preferred: f64, min: f64, max: f64) -> f64 {
    if max <= 0.0 {
        return preferred.max(min);
    }
    preferred.min(max).max(min)
}

pub fn install_editor_window_minimum(window: &WebviewWindow) {
    let minimum = LogicalSize::new(MIN_EDITOR_WINDOW_WIDTH, MIN_EDITOR_WINDOW_HEIGHT);
    let _ = window.set_min_size(Some(Size::Logical(minimum)));
}

pub fn attach_document_drop_handler(app: &AppHandle, window: &WebviewWindow) {
    let app = app.clone();
    let label = window.label().to_string();
    window.on_window_event(move |event| {
        let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event else {
            return;
        };
        let paths = document_paths(paths);
        if paths.is_empty() {
            return;
        }
        let _ = app.emit_to(
            label.as_str(),
            "hop-open-paths",
            serde_json::json!({ "paths": paths }),
        );
    });
}

fn attach_pending_open_cleanup(app: &AppHandle, window: &WebviewWindow) {
    let app = app.clone();
    let label = window.label().to_string();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            app.state::<crate::state::AppState>()
                .pending_open_paths
                .discard_for_window(&label);
        }
    });
}

fn document_paths(paths: &[PathBuf]) -> Vec<String> {
    paths
        .iter()
        .filter_map(super::document_path_from_path)
        .collect()
}

pub fn target_window_label(app: &AppHandle) -> Option<String> {
    let windows = app.webview_windows();
    windows
        .iter()
        .find(|(_, window)| window.is_focused().unwrap_or(false))
        .map(|(label, _)| label.clone())
        .or_else(|| windows.keys().next().cloned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_paths_keeps_only_supported_documents() {
        let a = PathBuf::from("/tmp/a.hwp");
        let b = PathBuf::from("/tmp/b.HWPX");
        let paths = document_paths(&[
            a.clone(),
            b.clone(),
            PathBuf::from("/tmp/c.pdf"),
            PathBuf::from("/tmp/no-extension"),
        ]);

        assert_eq!(
            paths,
            vec![
                a.to_string_lossy().to_string(),
                b.to_string_lossy().to_string()
            ]
        );
    }

    #[test]
    fn document_paths_preserves_input_order() {
        let first = PathBuf::from("/tmp/first.hwp");
        let second = PathBuf::from("/tmp/second.hwpx");
        let paths = document_paths(&[first.clone(), second.clone()]);

        assert_eq!(
            paths,
            vec![
                first.to_string_lossy().to_string(),
                second.to_string_lossy().to_string()
            ]
        );
    }

    #[test]
    fn clamped_new_window_dimension_prefers_default_within_work_area() {
        assert_eq!(clamped_new_window_dimension(1100.0, 960.0, 1400.0), 1100.0);
    }

    #[test]
    fn clamped_new_window_dimension_caps_to_work_area() {
        assert_eq!(clamped_new_window_dimension(1100.0, 960.0, 1000.0), 1000.0);
    }

    #[test]
    fn clamped_new_window_dimension_keeps_minimum_on_small_screens() {
        assert_eq!(clamped_new_window_dimension(1100.0, 720.0, 578.0), 720.0);
    }
}
