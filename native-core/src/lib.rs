use jni::objects::{JClass, JString};
use jni::sys::jstring;
use jni::JNIEnv;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::Path;

#[no_mangle]
pub extern "system" fn Java_com_sari_ide_bridge_NativeCore_nativeSha256(
    mut env: JNIEnv,
    _class: JClass,
    path: JString,
) -> jstring {
    let result = (|| -> Result<String, String> {
        let path: String = env.get_string(&path).map_err(|e| e.to_string())?.into();
        let mut file = File::open(Path::new(&path)).map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 1024 * 1024];
        loop {
            let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
            if n == 0 { break; }
            hasher.update(&buffer[..n]);
        }
        Ok(format!("{:x}", hasher.finalize()))
    })();

    match result {
        Ok(value) => env.new_string(value).unwrap().into_raw(),
        Err(error) => {
            let _ = env.throw_new("java/io/IOException", error);
            std::ptr::null_mut()
        }
    }
}
