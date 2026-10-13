//! 문서 탭.
//!
//! 문서 하나는 지금처럼 편집 창 하나가 맡고, 같은 그룹의 창들을 한 자리에 겹쳐 두고 활성
//! 탭 창만 보이게 해 "한 창 안의 여러 문서"처럼 다룬다. 창마다 실행 취소 기록·저장 상태·
//! 문서 세션이 독립이라 기존 저장/인쇄/닫기 흐름을 그대로 쓴다.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};
use uuid::Uuid;

pub const TABS_CHANGED_EVENT: &str = "yhwp-tabs-changed";

#[derive(Debug, Clone, Default)]
struct TabMeta {
    title: String,
    dirty: bool,
    /// 문서 없이 시작 화면만 띄운 탭
    empty: bool,
}

/// 창 자리: (바깥 위치, 안쪽 크기, 최대화 여부) — set_size 는 안쪽 크기를 받는다
pub type Bounds = (tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>, bool);

#[derive(Debug, Default)]
pub struct TabRegistry {
    bounds: HashMap<String, Bounds>,
    /// 만들었지만 아직 화면 준비(tabs_ready)를 기다리는 새 탭
    pending_show: std::collections::HashSet<String>,
    /// 다음 새 탭에 바로 쓸 미리 띄워 둔 숨은 창
    spare: Option<String>,
    /// 그룹 → 탭(창 label) 순서
    groups: HashMap<String, Vec<String>>,
    group_of: HashMap<String, String>,
    active: HashMap<String, String>,
    meta: HashMap<String, TabMeta>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TabInfo {
    pub label: String,
    pub title: String,
    pub dirty: bool,
    pub active: bool,
}

impl TabRegistry {
    /// `beside` 가 있으면 그 탭 바로 뒤에, 없으면 새 그룹으로 등록한다.
    pub fn register(&mut self, label: &str, beside: Option<&str>) -> String {
        if let Some(group) = self.group_of.get(label) {
            return group.clone();
        }
        // 기준 탭이 아직 등록 전이면(창이 막 떠서 화면 쪽 보고가 오기 전) 먼저 등록한다
        if let Some(b) = beside.filter(|b| !self.group_of.contains_key(*b)) {
            self.register(b, None);
        }
        let group = beside
            .and_then(|b| self.group_of.get(b).cloned())
            .unwrap_or_else(|| Uuid::new_v4().simple().to_string());
        let tabs = self.groups.entry(group.clone()).or_default();
        let at = beside
            .and_then(|b| tabs.iter().position(|l| l == b))
            .map(|i| i + 1)
            .unwrap_or(tabs.len());
        tabs.insert(at, label.to_string());
        self.group_of.insert(label.to_string(), group.clone());
        self.active
            .entry(group.clone())
            .or_insert_with(|| label.to_string());
        group
    }

    /// 탭을 빼고, 그 탭이 활성이었으면 이웃 탭 label 을 돌려준다.
    pub fn remove(&mut self, label: &str) -> Option<String> {
        self.meta.remove(label);
        self.bounds.remove(label);
        // 만들다 실패해 사라진 새 탭이 나중에 "보이기" 처리되며 기존 창을 숨기지 않도록
        self.pending_show.remove(label);
        let group = self.group_of.remove(label)?;
        let tabs = self.groups.get_mut(&group)?;
        let index = tabs.iter().position(|l| l == label)?;
        tabs.remove(index);
        if tabs.is_empty() {
            self.groups.remove(&group);
            self.active.remove(&group);
            return None;
        }
        if self.active.get(&group).map(String::as_str) != Some(label) {
            return None;
        }
        let next = tabs[index.min(tabs.len() - 1)].clone();
        self.active.insert(group, next.clone());
        Some(next)
    }

    /// 활성 탭을 바꾸고 이전 활성 탭을 돌려준다(같으면 None).
    pub fn set_active(&mut self, label: &str) -> Option<String> {
        let group = self.group_of.get(label)?.clone();
        let previous = self.active.insert(group, label.to_string());
        previous.filter(|p| p != label)
    }

    #[cfg(test)]
    fn active_in_group_of(&self, label: &str) -> Option<String> {
        self.group_of
            .get(label)
            .and_then(|g| self.active.get(g))
            .cloned()
    }

    pub fn set_meta(&mut self, label: &str, title: String, dirty: bool, empty: bool) {
        self.meta.insert(
            label.to_string(),
            TabMeta {
                title,
                dirty,
                empty,
            },
        );
    }

    /// 빈 시작 화면 탭인지 (문서를 열면 그 자리를 대신 쓴다)
    pub fn is_empty_tab(&self, label: &str) -> bool {
        self.meta.get(label).is_some_and(|m| m.empty && !m.dirty)
    }

    /// 탭을 지금 그룹에서 떼어 혼자인 새 그룹으로 옮긴다.
    pub fn detach(&mut self, label: &str) -> Option<String> {
        let meta = self.meta.get(label).cloned();
        let neighbor = self.remove(label);
        self.register(label, None);
        if let Some(meta) = meta {
            self.meta.insert(label.to_string(), meta);
        }
        neighbor
    }

    pub fn tabs_for(&self, label: &str) -> Vec<TabInfo> {
        let Some(group) = self.group_of.get(label) else {
            return Vec::new();
        };
        let active = self.active.get(group);
        let mut seen: HashMap<String, usize> = HashMap::new();
        self.groups
            .get(group)
            .map(|tabs| {
                tabs.iter()
                    .map(|l| {
                        let meta = self.meta.get(l).cloned().unwrap_or_default();
                        let base = if meta.title.is_empty() {
                            "새 문서".to_string()
                        } else {
                            meta.title
                        };
                        let count = seen.entry(base.clone()).or_insert(0);
                        *count += 1;
                        TabInfo {
                            label: l.clone(),
                            title: numbered_title(&base, *count),
                            dirty: meta.dirty,
                            active: active == Some(l),
                        }
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn group_members(&self, label: &str) -> Vec<String> {
        self.group_of
            .get(label)
            .and_then(|g| self.groups.get(g))
            .cloned()
            .unwrap_or_default()
    }

    pub fn len_of_group(&self, label: &str) -> usize {
        self.group_members(label).len()
    }
}

/// 같은 이름이 여러 탭에 있으면 두 번째부터 "이름 2.hwp" 처럼 번호를 붙인다.
fn numbered_title(title: &str, nth: usize) -> String {
    if nth <= 1 {
        return title.to_string();
    }
    match title.rfind('.') {
        Some(dot) if dot > 0 => format!("{} {nth}{}", &title[..dot], &title[dot..]),
        _ => format!("{title} {nth}"),
    }
}

#[derive(Default)]
pub struct TabState(pub Mutex<TabRegistry>);

fn registry<R: Runtime>(app: &AppHandle<R>) -> std::sync::MutexGuard<'_, TabRegistry> {
    app.state::<TabState>()
        .inner()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

/// 그룹의 모든 창에 탭 목록이 바뀌었다고 알린다.
fn notify_group<R: Runtime>(app: &AppHandle<R>, members: &[String]) {
    for label in members {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.emit_to(window.label(), TABS_CHANGED_EVENT, ());
        }
    }
}

fn bounds_of<R: Runtime>(window: &WebviewWindow<R>) -> Option<Bounds> {
    Some((
        window.outer_position().ok()?,
        window.inner_size().ok()?,
        window.is_maximized().unwrap_or(false),
    ))
}

fn apply_bounds<R: Runtime>(window: &WebviewWindow<R>, bounds: Bounds) {
    let (pos, size, maximized) = bounds;
    if maximized {
        let _ = window.maximize();
    } else {
        let _ = window.unmaximize();
        let _ = window.set_position(pos);
        let _ = window.set_size(size);
    }
}

/// 숨긴 탭은 WebView2 화면 그리기도 멈춰(visibilityState=hidden) CPU·메모리를 아낀다.
#[cfg(windows)]
fn set_webview_visible<R: Runtime>(window: &WebviewWindow<R>, visible: bool) {
    let _ = window.with_webview(move |webview| unsafe {
        let _ = webview.controller().SetIsVisible(visible);
    });
}

#[cfg(not(windows))]
fn set_webview_visible<R: Runtime>(_window: &WebviewWindow<R>, _visible: bool) {}

/// `bounds` 자리로 `to` 창을 보이고 `hide` 창은 숨긴다.
fn swap_visible<R: Runtime>(
    bounds: Option<Bounds>,
    to: &WebviewWindow<R>,
    hide: Option<&WebviewWindow<R>>,
) {
    if let Some(bounds) = bounds {
        apply_bounds(to, bounds);
    }
    set_webview_visible(to, true);
    let _ = to.show();
    let _ = to.unminimize();
    let _ = to.set_focus();
    if let Some(hide) = hide.filter(|h| h.label() != to.label()) {
        let _ = hide.hide();
        set_webview_visible(hide, false);
    }
}

/// 보이는 창이 움직이거나 크기가 바뀌면 자리를 기억해 둔다(닫힌 뒤 이웃 탭에 그대로 쓴다).
pub fn remember_bounds<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>) {
    if !window.is_visible().unwrap_or(false) {
        return;
    }
    if let Some(bounds) = bounds_of(window) {
        registry(app)
            .bounds
            .insert(window.label().to_string(), bounds);
    }
}

/// 새 편집 창을 `beside` 탭 옆에 등록한다(창을 만들기 전에 부른다).
pub fn register_new_window<R: Runtime>(app: &AppHandle<R>, label: &str, beside: Option<&str>) {
    registry(app).register(label, beside);
}

pub fn take_spare<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    registry(app).spare.take()
}

pub fn has_spare<R: Runtime>(app: &AppHandle<R>) -> bool {
    registry(app).spare.is_some()
}

pub fn set_spare<R: Runtime>(app: &AppHandle<R>, label: &str) {
    registry(app).spare = Some(label.to_string());
}

/// 새 탭은 숨긴 채 만들어 두고, 화면이 다 그려지면(tabs_ready) 한 번에 바꿔 보인다.
/// 준비 신호가 오지 않아도 잠시 뒤에는 보이게 해 창이 사라지지 않게 한다.
pub fn queue_new_tab<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>) {
    registry(app)
        .pending_show
        .insert(window.label().to_string());
    let app = app.clone();
    let label = window.label().to_string();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(5));
        reveal_pending(&app, &label);
    });
}

fn reveal_pending<R: Runtime>(app: &AppHandle<R>, label: &str) {
    {
        let mut reg = registry(app);
        if !reg.pending_show.remove(label) || !reg.group_of.contains_key(label) {
            return;
        }
    }
    if let Some(window) = app.get_webview_window(label) {
        show_new_tab(app, &window);
    }
}

/// 막 만든 창을 활성 탭으로 보여 주고 같은 그룹의 이전 활성 창을 숨긴다.
pub fn show_new_tab<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>) {
    let (previous, members) = {
        let mut reg = registry(app);
        (
            reg.set_active(window.label()),
            reg.group_members(window.label()),
        )
    };
    let replace_empty = previous
        .as_deref()
        .is_some_and(|p| registry(app).is_empty_tab(p));
    let previous = previous.and_then(|p| app.get_webview_window(&p));
    swap_visible(
        previous.as_ref().and_then(bounds_of),
        window,
        previous.as_ref(),
    );
    if replace_empty {
        // 빈 시작 화면 탭은 새로 연 문서가 대신한다
        if let Some(previous) = previous {
            let _ = previous.destroy();
        }
    }
    notify_group(app, &members);
}

pub fn activate<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<(), String> {
    let target = app
        .get_webview_window(label)
        .ok_or_else(|| format!("탭을 찾을 수 없습니다: {label}"))?;
    let (previous, members) = {
        let mut reg = registry(app);
        (reg.set_active(label), reg.group_members(label))
    };
    let previous = previous.and_then(|p| app.get_webview_window(&p));
    swap_visible(
        previous.as_ref().and_then(bounds_of),
        &target,
        previous.as_ref(),
    );
    notify_group(app, &members);
    Ok(())
}

/// 창이 사라질 때: 탭에서 빼고, 활성 탭이었으면 이웃 탭을 같은 자리에 보인다.
pub fn on_window_destroyed<R: Runtime>(app: &AppHandle<R>, window_label: &str) {
    let (next, members, bounds) = {
        let mut reg = registry(app);
        if reg.spare.as_deref() == Some(window_label) {
            reg.spare = None;
        }
        let members: Vec<String> = reg
            .group_members(window_label)
            .into_iter()
            .filter(|l| l != window_label)
            .collect();
        let bounds = reg.bounds.get(window_label).copied();
        (reg.remove(window_label), members, bounds)
    };
    if let Some(next) = next.and_then(|n| app.get_webview_window(&n)) {
        swap_visible(bounds, &next, None);
    }
    notify_group(app, &members);
    close_spare_if_alone(app, window_label);
}

/// 문서 창이 하나도 남지 않으면 미리 띄운 숨은 창도 닫아 앱이 끝나게 한다.
fn close_spare_if_alone<R: Runtime>(app: &AppHandle<R>, destroyed: &str) {
    let spare = registry(app).spare.clone();
    let Some(spare) = spare else { return };
    let others = app
        .webview_windows()
        .keys()
        .filter(|l| l.as_str() != destroyed && l.as_str() != spare)
        .count();
    if others == 0 {
        registry(app).spare = None;
        if let Some(window) = app.get_webview_window(&spare) {
            let _ = window.destroy();
        }
    }
}

/// 예비 창이 대기를 시작할 때 묻는다: 이미 "+" 로 불렸으면(신호를 놓쳤으면) true.
#[tauri::command]
pub fn tabs_spare_claimed(window: WebviewWindow, app: AppHandle) -> bool {
    let reg = registry(&app);
    reg.spare.as_deref() != Some(window.label()) && reg.group_of.contains_key(window.label())
}

/// 화면 쪽이 첫 화면(문서 또는 시작 화면)을 다 그렸다고 알린다.
#[tauri::command]
pub fn tabs_ready(window: WebviewWindow, app: AppHandle) {
    reveal_pending(&app, window.label());
}

/// 창 열기·숨기기 애니메이션을 꺼 탭 전환이 즉시 보이게 한다.
#[cfg(windows)]
pub fn disable_window_transitions<R: Runtime>(window: &WebviewWindow<R>) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED};
    use windows_core::BOOL;
    if let Ok(hwnd) = window.hwnd() {
        let disabled = BOOL::from(true);
        unsafe {
            let _ = DwmSetWindowAttribute(
                HWND(hwnd.0),
                DWMWA_TRANSITIONS_FORCEDISABLED,
                std::ptr::from_ref(&disabled).cast(),
                std::mem::size_of::<BOOL>() as u32,
            );
        }
    }
}

#[cfg(not(windows))]
pub fn disable_window_transitions<R: Runtime>(_window: &WebviewWindow<R>) {}

#[tauri::command]
pub fn tabs_list(window: WebviewWindow, app: AppHandle) -> Vec<TabInfo> {
    let mut reg = registry(&app);
    reg.register(window.label(), None);
    reg.tabs_for(window.label())
}

#[tauri::command]
pub fn tabs_set_info(
    window: WebviewWindow,
    app: AppHandle,
    title: String,
    dirty: bool,
    empty: Option<bool>,
) {
    let members = {
        let mut reg = registry(&app);
        reg.register(window.label(), None);
        reg.set_meta(window.label(), title, dirty, empty.unwrap_or(false));
        reg.group_members(window.label())
    };
    notify_group(&app, &members);
}

#[tauri::command]
pub fn tabs_activate(app: AppHandle, label: String) -> Result<(), String> {
    activate(&app, &label)
}

/// 탭 닫기: 그 탭을 앞으로 가져와 평소 닫기 흐름(저장 확인 포함)을 그대로 탄다.
#[tauri::command]
pub fn tabs_close(app: AppHandle, label: String) -> Result<(), String> {
    activate(&app, &label)?;
    let window = app
        .get_webview_window(&label)
        .ok_or("탭을 찾을 수 없습니다")?;
    window.close().map_err(|e| e.to_string())
}

/// 탭을 별도 창으로 떼어 낸다. 남은 탭 중 하나를 원래 자리에 보인다.
#[tauri::command]
pub fn tabs_detach(app: AppHandle, label: String) -> Result<(), String> {
    let window = app
        .get_webview_window(&label)
        .ok_or("탭을 찾을 수 없습니다")?;
    let (neighbor, old_members) = {
        let mut reg = registry(&app);
        if reg.len_of_group(&label) <= 1 {
            return Ok(());
        }
        let old_members: Vec<String> = reg
            .group_members(&label)
            .into_iter()
            .filter(|l| l != &label)
            .collect();
        (reg.detach(&label), old_members)
    };
    if let Some(neighbor) = neighbor.and_then(|n| app.get_webview_window(&n)) {
        swap_visible(bounds_of(&window), &neighbor, None);
    }
    if let Ok(pos) = window.outer_position() {
        let _ = window.set_position(tauri::PhysicalPosition::new(pos.x + 48, pos.y + 48));
    }
    let _ = window.show();
    let _ = window.set_focus();
    notify_group(&app, &old_members);
    notify_group(&app, &[label]);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tabs_join_the_group_of_the_window_they_were_opened_from() {
        let mut reg = TabRegistry::default();
        reg.register("main", None);
        reg.register("b", Some("main"));
        reg.register("c", Some("main"));
        let labels: Vec<_> = reg.tabs_for("b").into_iter().map(|t| t.label).collect();
        assert_eq!(labels, vec!["main", "c", "b"]);
        assert_eq!(reg.active_in_group_of("c").as_deref(), Some("main"));
    }

    #[test]
    fn removed_tab_is_no_longer_pending_to_show() {
        let mut reg = TabRegistry::default();
        reg.register("main", None);
        reg.register("broken", Some("main"));
        reg.pending_show.insert("broken".into());
        reg.remove("broken");
        assert!(!reg.pending_show.contains("broken"));
        assert!(!reg.group_of.contains_key("broken"));
    }

    #[test]
    fn unregistered_anchor_is_registered_before_joining() {
        let mut reg = TabRegistry::default();
        reg.register("new", Some("main"));
        let labels: Vec<_> = reg.tabs_for("main").into_iter().map(|t| t.label).collect();
        assert_eq!(labels, vec!["main", "new"]);
    }

    #[test]
    fn duplicate_titles_get_numbers() {
        let mut reg = TabRegistry::default();
        reg.register("a", None);
        reg.register("b", Some("a"));
        reg.register("c", Some("b"));
        for l in ["a", "b", "c"] {
            reg.set_meta(l, "새 문서.hwp".into(), false, false);
        }
        let titles: Vec<_> = reg.tabs_for("a").into_iter().map(|t| t.title).collect();
        assert_eq!(
            titles,
            vec!["새 문서.hwp", "새 문서 2.hwp", "새 문서 3.hwp"]
        );
        assert_eq!(numbered_title("메모", 2), "메모 2");
    }

    #[test]
    fn only_clean_start_screen_tabs_count_as_empty() {
        let mut reg = TabRegistry::default();
        reg.register("a", None);
        reg.set_meta("a", String::new(), false, true);
        assert!(reg.is_empty_tab("a"));
        reg.set_meta("a", "새 문서".into(), true, true);
        assert!(!reg.is_empty_tab("a"));
        assert!(!reg.is_empty_tab("missing"));
    }

    #[test]
    fn removing_the_active_tab_activates_a_neighbor() {
        let mut reg = TabRegistry::default();
        reg.register("a", None);
        reg.register("b", Some("a"));
        reg.register("c", Some("b"));
        reg.set_active("b");
        assert_eq!(reg.remove("b").as_deref(), Some("c"));
        assert_eq!(
            reg.remove("a"),
            None,
            "inactive tab removal keeps the active one"
        );
        assert_eq!(reg.remove("c"), None, "last tab leaves nothing to show");
        assert!(reg.tabs_for("c").is_empty());
    }

    #[test]
    fn detached_tab_starts_its_own_group_and_keeps_its_title() {
        let mut reg = TabRegistry::default();
        reg.register("a", None);
        reg.register("b", Some("a"));
        reg.set_meta("b", "보고서.hwp".into(), true, false);
        reg.set_active("b");
        assert_eq!(reg.detach("b").as_deref(), Some("a"));
        assert_eq!(reg.len_of_group("a"), 1);
        let tabs = reg.tabs_for("b");
        assert_eq!(tabs.len(), 1);
        assert_eq!(tabs[0].title, "보고서.hwp");
        assert!(tabs[0].dirty && tabs[0].active);
    }
}
