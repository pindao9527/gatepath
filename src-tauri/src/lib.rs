mod download;

use download::fetch_document;

#[tauri::command]
fn download_document(url: String) -> Result<download::DownloadDocumentResult, String> {
    fetch_document(&url)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_keyring::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![download_document])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
