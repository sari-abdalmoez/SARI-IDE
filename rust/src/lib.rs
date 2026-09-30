use jni::JNIEnv;
use jni::objects::{JClass, JString};
use jni::sys::jstring;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::Path;
use walkdir::WalkDir;

/// SHA-256 hex digest of the file at `path`.
/// Returns an empty string on error rather than panicking across the FFI boundary.
#[no_mangle]
pub extern "C" fn Java_com_sari_ide_core_NativeFileOps_nativeHashFile(
    mut env: JNIEnv,
    _class: JClass,
    path: JString,
) -> jstring {
    let result = (|| -> Result<String, Box<dyn std::error::Error>> {
        let path_str: String = env.get_string(&path)?.into();
        let mut file = File::open(&path_str)?;
        let mut hasher = Sha256::new();
        let mut buf = [0u8; 65536];
        loop {
            let n = file.read(&mut buf)?;
            if n == 0 { break; }
            hasher.update(&buf[..n]);
        }
        Ok(hex::encode(hasher.finalize()))
    })();
    let s = result.unwrap_or_default();
    env.new_string(&s).map(|js| js.into_raw()).unwrap_or(std::ptr::null_mut())
}

/// Recursive directory scan returning a JSON array of {path, dir, size} objects.
/// `max_depth` limits recursion depth to avoid stack overflow on deeply nested trees.
#[no_mangle]
pub extern "C" fn Java_com_sari_ide_core_NativeFileOps_nativeScanDirectory(
    mut env: JNIEnv,
    _class: JClass,
    path: JString,
    max_depth: jni::sys::jint,
) -> jstring {
    let result = (|| -> Result<String, Box<dyn std::error::Error>> {
        let path_str: String = env.get_string(&path)?.into();
        let root = Path::new(&path_str);
        if !root.exists() {
            return Ok("[]".to_string());
        }
        let depth = if max_depth <= 0 { 8 } else { max_depth as usize };
        let mut entries = Vec::new();
        for entry in WalkDir::new(root).max_depth(depth).follow_links(false) {
            let e = match entry { Ok(e) => e, Err(_) => continue };
            let p = e.path();
            if p == root { continue; }
            let rel = p.strip_prefix(root).unwrap_or(p).to_string_lossy();
            let is_dir = p.is_dir();
            let size = if is_dir { 0 } else { p.metadata().map(|m| m.len()).unwrap_or(0) };
            let rel_escaped = rel.replace('\\', "/").replace('"', "\\\"");
            entries.push(format!(
                r#"{{"path":"{rel_escaped}","dir":{is_dir},"size":{size}}}"#
            ));
        }
        Ok(format!("[{}]", entries.join(",")))
    })();
    let s = result.unwrap_or_else(|_| "[]".to_string());
    env.new_string(&s).map(|js| js.into_raw()).unwrap_or(std::ptr::null_mut())
}
