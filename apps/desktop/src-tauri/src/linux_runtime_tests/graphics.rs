use super::super::*;
use super::env_guard;
use std::{env, ffi::OsString};

#[test]
fn arch_like_os_release_requires_webkit_graphics_fallback() {
    let _env = env_guard();

    assert!(needs_webkit_graphics_fallback(Some(
        "ID=cachyos\nID_LIKE=\"arch linux\"\n",
    )));
    assert!(needs_webkit_graphics_fallback(Some("ID_LIKE=archlinux\n")));
}

#[test]
fn fedora_like_os_release_requires_webkit_graphics_fallback() {
    let _env = env_guard();

    unsafe {
        env::set_var("XDG_SESSION_TYPE", "wayland");
        env::remove_var("WAYLAND_DISPLAY");
    }

    assert!(needs_webkit_graphics_fallback(Some("ID=fedora\n")));
    assert!(needs_webkit_graphics_fallback(Some(
        "ID_LIKE=\"rhel fedora\"\n"
    )));
}

#[test]
fn fedora_like_os_release_without_wayland_skips_webkit_graphics_fallback() {
    let _env = env_guard();

    unsafe {
        env::set_var("XDG_SESSION_TYPE", "x11");
        env::remove_var("WAYLAND_DISPLAY");
    }

    assert!(!needs_webkit_graphics_fallback(Some("ID=fedora\n")));
}

#[test]
fn empty_wayland_display_does_not_mark_session_as_wayland() {
    let _env = env_guard();

    unsafe {
        env::set_var("WAYLAND_DISPLAY", "");
        env::remove_var("XDG_SESSION_TYPE");
    }

    assert!(!needs_webkit_graphics_fallback(Some("ID=fedora\n")));
}

#[test]
fn unrelated_os_release_skips_webkit_graphics_fallback() {
    let _env = env_guard();

    assert!(!needs_webkit_graphics_fallback(Some(
        "ID=ubuntu\nID_LIKE=debian\n"
    )));
}

#[test]
fn webkit_graphics_fallback_sets_missing_environment_values() {
    let _env = env_guard();

    unsafe {
        env::remove_var("WEBKIT_DISABLE_DMABUF_RENDERER");
        env::remove_var("WEBKIT_DISABLE_COMPOSITING_MODE");
    }

    apply_webkit_graphics_fallbacks(Some("ID=cachyos\nID_LIKE=arch\n"));

    assert_eq!(
        env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER"),
        Some(OsString::from("1"))
    );
    assert_eq!(
        env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE"),
        Some(OsString::from("1"))
    );
}

#[test]
fn linux_runtime_fixes_apply_graphics_fallback_without_appimage() {
    let _env = env_guard();

    unsafe {
        env::remove_var("APPDIR");
        env::remove_var("APPIMAGE");
        env::remove_var("WEBKIT_DISABLE_DMABUF_RENDERER");
        env::remove_var("WEBKIT_DISABLE_COMPOSITING_MODE");
        env::set_var("WAYLAND_DISPLAY", "wayland-0");
    }

    apply_linux_runtime_fixes_for_os_release(Some("ID=fedora\n"));

    assert_eq!(
        env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER"),
        Some(OsString::from("1"))
    );
    assert_eq!(
        env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE"),
        Some(OsString::from("1"))
    );
}

#[test]
fn webkit_graphics_fallback_preserves_user_overrides() {
    let _env = env_guard();

    unsafe {
        env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "0");
        env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "0");
    }

    apply_webkit_graphics_fallbacks(Some("ID=cachyos\n"));

    assert_eq!(
        env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER"),
        Some(OsString::from("0"))
    );
    assert_eq!(
        env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE"),
        Some(OsString::from("0"))
    );
}
