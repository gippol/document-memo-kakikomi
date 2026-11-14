//! 資料メモ — バックエンド
//!
//! 非破壊の原則: 資料ファイルは読み取りのみ。書き込みは `<資料名>.notes.json` に限定する。

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, State};

const NOTES_SUFFIX: &str = ".notes.json";
const CONFIG_FILE: &str = ".shiryo-memo.json";
const SUPPORTED_EXT: &[&str] = &["md", "markdown", "docx", "xlsx", "xlsm", "xls"];
const SKIP_DIRS: &[&str] = &["node_modules", "target", "dist"];

#[derive(Default)]
struct WatchState(Mutex<Option<RecommendedWatcher>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocEntry {
    /// ルートからの相対パス（区切りは `/`）
    path: String,
    has_notes: bool,
}

#[derive(Serialize)]
struct DocContent {
    content: String,
    sha256: String,
}

/// 相対パスをルート配下に解決する。`..` や絶対パスは拒否。
fn resolve(root: &str, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(format!("不正なパスです: {rel}"));
    }
    Ok(Path::new(root).join(rel_path))
}

fn notes_path(root: &str, rel: &str) -> Result<PathBuf, String> {
    resolve(root, &format!("{rel}{NOTES_SUFFIX}"))
}

fn to_rel(root: &Path, p: &Path) -> Option<String> {
    let rel = p.strip_prefix(root).ok()?;
    let parts: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    Some(parts.join("/"))
}

fn is_supported(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| SUPPORTED_EXT.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<DocEntry>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        // 隠しファイルと、Word が開いている間に作るロックファイル (~$xxx.docx) は除外
        if name.starts_with('.') || name.starts_with("~$") {
            continue;
        }
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            if !SKIP_DIRS.contains(&name.as_str()) {
                walk(root, &path, out);
            }
        } else if ft.is_file() && is_supported(&path) {
            if let Some(rel) = to_rel(root, &path) {
                let mut np = path.clone().into_os_string();
                np.push(NOTES_SUFFIX);
                out.push(DocEntry {
                    path: rel,
                    has_notes: Path::new(&np).exists(),
                });
            }
        }
    }
}

#[tauri::command]
fn list_documents(root: String) -> Result<Vec<DocEntry>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("フォルダが見つかりません: {root}"));
    }
    let mut out = Vec::new();
    walk(&root_path, &root_path, &mut out);
    out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    Ok(out)
}

#[tauri::command]
fn read_document(root: String, rel: String) -> Result<DocContent, String> {
    let path = resolve(&root, &rel)?;
    let bytes = fs::read(&path).map_err(|e| format!("資料を読めません: {e}"))?;
    let sha256 = hex::encode(Sha256::digest(&bytes));
    let mut content = String::from_utf8_lossy(&bytes).into_owned();
    if content.starts_with('\u{feff}') {
        content.remove(0);
    }
    Ok(DocContent { content, sha256 })
}

/// バイナリ資料（.docx など）をそのまま返す。解析はフロントエンド側で行う。
#[tauri::command]
fn read_document_bytes(root: String, rel: String) -> Result<Response, String> {
    let path = resolve(&root, &rel)?;
    let bytes = fs::read(&path).map_err(|e| format!("資料を読めません: {e}"))?;
    Ok(Response::new(bytes))
}

#[tauri::command]
fn read_notes(root: String, rel: String) -> Result<Option<String>, String> {
    let path = notes_path(&root, &rel)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("ノートファイルを読めません: {e}"))
}

/// フォルダ直下の設定ファイルを読む（無ければ None）。
#[tauri::command]
fn read_config(root: String) -> Result<Option<String>, String> {
    let path = resolve(&root, CONFIG_FILE)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("設定ファイルを読めません: {e}"))
}

/// ノートファイルをアトミックに書き込む（一時ファイル → rename）。
#[tauri::command]
fn write_notes(root: String, rel: String, content: String) -> Result<(), String> {
    let path = notes_path(&root, &rel)?;
    let mut tmp = path.clone().into_os_string();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, content.as_bytes()).map_err(|e| format!("保存に失敗しました: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("保存に失敗しました: {e}")
    })
}

/// フォルダを監視し、変更されたファイルの相対パスを `fs-changed` イベントで通知する。
#[tauri::command]
fn watch_folder(app: AppHandle, state: State<WatchState>, root: String) -> Result<(), String> {
    let root_path = PathBuf::from(&root);
    let watch_root = root_path.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        if matches!(event.kind, EventKind::Access(_)) {
            return;
        }
        let paths: Vec<String> = event
            .paths
            .iter()
            .filter_map(|p| to_rel(&watch_root, p))
            .filter(|p| !p.ends_with(".tmp") && !p.rsplit('/').next().unwrap_or("").starts_with("~$"))
            .collect();
        if !paths.is_empty() {
            let _ = app.emit("fs-changed", paths);
        }
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(&root_path, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    *state.0.lock().unwrap() = Some(watcher);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(WatchState::default())
        .invoke_handler(tauri::generate_handler![
            list_documents,
            read_document,
            read_document_bytes,
            read_notes,
            read_config,
            write_notes,
            watch_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
