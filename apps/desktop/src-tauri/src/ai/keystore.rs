//! API 키 보관: Windows 는 자격 증명 관리자, 그 밖의 OS 는 사용자 설정 폴더의 권한 600 파일.

#[cfg(windows)]
mod imp {
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::ERROR_NOT_FOUND;
    use windows::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_FLAGS, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    fn target(slot: &str) -> Vec<u16> {
        format!("YHWP/ai/{slot}").encode_utf16().chain(Some(0)).collect()
    }

    pub fn write(slot: &str, key: &str) -> Result<(), String> {
        let mut name = target(slot);
        let mut user: Vec<u16> = "YHWP".encode_utf16().chain(Some(0)).collect();
        let mut blob = key.as_bytes().to_vec();
        let cred = CREDENTIALW {
            Flags: CRED_FLAGS(0),
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(name.as_mut_ptr()),
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: PWSTR(user.as_mut_ptr()),
            ..Default::default()
        };
        unsafe { CredWriteW(&cred, 0) }.map_err(|e| format!("API 키를 저장하지 못했습니다: {e}"))
    }

    pub fn read(slot: &str) -> Result<Option<String>, String> {
        let name = target(slot);
        let mut ptr: *mut CREDENTIALW = std::ptr::null_mut();
        match unsafe { CredReadW(PCWSTR(name.as_ptr()), CRED_TYPE_GENERIC, None, &mut ptr) } {
            Ok(()) => {
                let value = unsafe {
                    let c = &*ptr;
                    let bytes = std::slice::from_raw_parts(c.CredentialBlob, c.CredentialBlobSize as usize);
                    let s = String::from_utf8_lossy(bytes).into_owned();
                    CredFree(ptr as *const _);
                    s
                };
                Ok(Some(value).filter(|v| !v.is_empty()))
            }
            Err(e) if e.code() == ERROR_NOT_FOUND.to_hresult() => Ok(None),
            Err(e) => Err(format!("API 키를 읽지 못했습니다: {e}")),
        }
    }

    pub fn delete(slot: &str) -> Result<(), String> {
        let name = target(slot);
        match unsafe { CredDeleteW(PCWSTR(name.as_ptr()), CRED_TYPE_GENERIC, None) } {
            Ok(()) => Ok(()),
            Err(e) if e.code() == ERROR_NOT_FOUND.to_hresult() => Ok(()),
            Err(e) => Err(format!("API 키를 지우지 못했습니다: {e}")),
        }
    }
}

#[cfg(not(windows))]
mod imp {
    //! Windows 외 OS: 사용자 설정 폴더의 권한 600 파일에 둔다.
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    fn path() -> Result<PathBuf, String> {
        let base = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
            .ok_or("설정 폴더를 찾을 수 없습니다.")?;
        Ok(base.join("yhwp").join("ai-keys.json"))
    }

    fn load() -> Result<BTreeMap<String, String>, String> {
        match std::fs::read_to_string(path()?) {
            Ok(text) => Ok(serde_json::from_str(&text).unwrap_or_default()),
            Err(_) => Ok(BTreeMap::new()),
        }
    }

    fn save(map: &BTreeMap<String, String>) -> Result<(), String> {
        let p = path()?;
        if let Some(dir) = p.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::write(&p, serde_json::to_string(map).unwrap()).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }

    pub fn write(slot: &str, key: &str) -> Result<(), String> {
        let mut map = load()?;
        map.insert(slot.to_string(), key.to_string());
        save(&map)
    }

    pub fn read(slot: &str) -> Result<Option<String>, String> {
        Ok(load()?.get(slot).cloned())
    }

    pub fn delete(slot: &str) -> Result<(), String> {
        let mut map = load()?;
        map.remove(slot);
        save(&map)
    }
}

pub(crate) use imp::{delete, read, write};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keystore_round_trip() {
        let slot = "test-yhwp-roundtrip";
        write(slot, "sk-테스트").unwrap();
        assert_eq!(read(slot).unwrap().as_deref(), Some("sk-테스트"));
        delete(slot).unwrap();
        assert_eq!(read(slot).unwrap(), None);
        delete(slot).unwrap();
    }
}
