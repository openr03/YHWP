//! 도움말 메뉴의 외부 링크를 기본 브라우저로 연다. 허용 목록 밖 주소는 거부한다.

const ALLOWED_URLS: &[&str] = &[
    "https://youngsam.net",
    "https://youngsam.net/programs/yhwp",
    "https://github.com/openr03/YHWP",
    // AI 설정의 "키 발급·설치 안내" 링크
    "https://platform.openai.com/api-keys",
    "https://console.anthropic.com/settings/keys",
    "https://aistudio.google.com/apikey",
    "https://ollama.com/download",
    "https://lmstudio.ai",
];

pub fn is_allowed(url: &str) -> bool {
    ALLOWED_URLS.contains(&url)
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    if !is_allowed(&url) {
        return Err(format!("허용되지 않은 주소입니다: {url}"));
    }
    #[cfg(windows)]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut command = std::process::Command::new("rundll32");
        command.args(["url.dll,FileProtocolHandler", &url]);
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg(&url);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(&url);
        command
    };
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::is_allowed;

    #[test]
    fn only_known_urls_are_allowed() {
        assert!(is_allowed("https://youngsam.net"));
        assert!(is_allowed("https://github.com/openr03/YHWP"));
        assert!(!is_allowed("https://youngsam.net.evil.example"));
        assert!(!is_allowed("file:///C:/Windows/System32/cmd.exe"));
    }
}
