//! HTTP(S) 与本地 file / 绝对路径读取，供前端统一下载管线使用（避免浏览器 CORS）。

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use url::Url;

/// 单文件体积上限（与后续解析、模型上下文预留一致，可再调）。
const MAX_BYTES: usize = 32 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadDocumentResult {
    pub byte_length: usize,
    pub content_type: Option<String>,
    /// 当正文为合法 UTF-8 时返回全文（便于直接预览与后续 md 解析）。
    pub text: Option<String>,
    /// 非 UTF-8 时返回标准 Base64（如 xmind/docx 二进制）。
    pub base64: Option<String>,
}

fn read_file_limited(path: &PathBuf) -> Result<Vec<u8>, String> {
    let meta = fs::metadata(path).map_err(|e| format!("无法访问文件: {e}"))?;
    let len = meta.len() as usize;
    if len > MAX_BYTES {
        return Err(format!(
            "文件过大（{len} 字节），上限 {MAX_BYTES} 字节"
        ));
    }
    fs::read(path).map_err(|e| format!("读取文件失败: {e}"))
}

fn bytes_to_result(bytes: Vec<u8>, content_type: Option<String>) -> DownloadDocumentResult {
    let byte_length = bytes.len();
    match String::from_utf8(bytes) {
        Ok(text) => DownloadDocumentResult {
            byte_length,
            content_type,
            text: Some(text),
            base64: None,
        },
        Err(e) => {
            let raw = e.into_bytes();
            DownloadDocumentResult {
                byte_length,
                content_type,
                text: None,
                base64: Some(B64.encode(&raw)),
            }
        }
    }
}

fn fetch_http(url_str: &str) -> Result<(Vec<u8>, Option<String>), String> {
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败: {e}"))?;

    let resp = client
        .get(url_str)
        .send()
        .map_err(|e| format!("请求失败: {e}"))?;

    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or(s).trim().to_string());

    let bytes = resp
        .bytes()
        .map_err(|e| format!("读取响应失败: {e}"))?
        .to_vec();

    if bytes.len() > MAX_BYTES {
        return Err(format!(
            "下载内容过大（{} 字节），上限 {MAX_BYTES} 字节",
            bytes.len()
        ));
    }

    Ok((bytes, content_type))
}

/// 由前端传入的「地址」：支持 `http(s)://`、`file://`、以及可直接访问的本地绝对/相对路径。
pub fn fetch_document(url_str: &str) -> Result<DownloadDocumentResult, String> {
    let trimmed = url_str.trim();
    if trimmed.is_empty() {
        return Err("地址为空".into());
    }

    if let Ok(url) = Url::parse(trimmed) {
        return match url.scheme() {
            "http" | "https" => {
                let (bytes, ct) = fetch_http(trimmed)?;
                Ok(bytes_to_result(bytes, ct))
            }
            "file" => {
                let path = url
                    .to_file_path()
                    .map_err(|_| "无法将 file URL 转为本地路径".to_string())?;
                let bytes = read_file_limited(&path)?;
                Ok(bytes_to_result(bytes, None))
            }
            _ => Err(format!("不支持的 URL 协议: {}", url.scheme())),
        };
    }

    let path = PathBuf::from(trimmed);
    if path.is_file() {
        let bytes = read_file_limited(&path)?;
        return Ok(bytes_to_result(bytes, None));
    }

    Err("无法解析为有效 URL，且不是可读的本地文件路径".into())
}
