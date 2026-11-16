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
use tauri::{AppHandle, Emitter, Manager, State};

const NOTES_SUFFIX: &str = ".notes.json";
const CONFIG_FILE: &str = ".document-memo-kakikomi.json";
const SUPPORTED_EXT: &[&str] = &["md", "markdown", "docx", "pptx", "xlsx", "xlsm", "xls"];
const SKIP_DIRS: &[&str] = &["node_modules", "target", "dist"];

/// いま開いている資料フォルダ。各コマンドはここに登録された root に対してのみ動く。
struct OpenFolder {
    /// フロントエンドから渡された root（そのままの文字列。照合に使う）
    root: String,
    /// 正規化した絶対パス（シンボリックリンク等でフォルダ外に出ていないかの判定に使う）
    canon: PathBuf,
    _watcher: RecommendedWatcher,
}

#[derive(Default)]
struct FolderState(Mutex<Option<OpenFolder>>);

/// 登録済みのフォルダと一致する root か確認し、(root のパス, 正規化したパス) を返す。
fn checked_root(state: &FolderState, root: &str) -> Result<(PathBuf, PathBuf), String> {
    let guard = state
        .0
        .lock()
        .map_err(|_| "内部エラー（状態をロックできません）".to_string())?;
    match guard.as_ref() {
        Some(f) if f.root == root => Ok((PathBuf::from(&f.root), f.canon.clone())),
        _ => Err(format!("開いていないフォルダへのアクセスです: {root}")),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocEntry {
    /// ルートからの相対パス（区切りは `/`）
    path: String,
    has_notes: bool,
}

/// 対応する資料が見つからない（資料のリネーム・移動・削除で取り残された）ノートファイル
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OrphanNotes {
    /// 元の資料のルートからの相対パス（ノートファイルのパスから `.notes.json` を除いたもの）
    path: String,
    /// ノートの件数（読めなければ None）
    note_count: Option<usize>,
}

#[derive(Serialize)]
struct DocList {
    docs: Vec<DocEntry>,
    orphans: Vec<OrphanNotes>,
}

#[derive(Serialize)]
struct DocContent {
    content: String,
    sha256: String,
    /// 判定した文字コード（"UTF-8" / "Shift_JIS" / "EUC-JP" など。WHATWG の名前）
    encoding: String,
}

/// テキスト資料のバイト列を文字コードを判定して文字列にする。
/// 1. BOM があればそれに従う（UTF-8 / UTF-16LE / UTF-16BE）
/// 2. UTF-8 として正しければ UTF-8
/// 3. それ以外は内容から推定（Shift_JIS・EUC-JP など）。ほぼ UTF-8 で一部だけ壊れている場合は UTF-8 のまま読む
fn decode_text(bytes: &[u8]) -> (String, &'static str) {
    use chardetng::{EncodingDetector, Iso2022JpDetection, Utf8Detection};
    use encoding_rs::Encoding;

    if let Some((enc, bom_len)) = Encoding::for_bom(bytes) {
        let (s, _) = enc.decode_without_bom_handling(&bytes[bom_len..]);
        return (s.into_owned(), enc.name());
    }
    if let Ok(s) = std::str::from_utf8(bytes) {
        return (s.to_owned(), encoding_rs::UTF_8.name());
    }
    // 一部だけ壊れた UTF-8（途中で切れた・1 バイト混入など）。
    // Shift_JIS などの文字列を UTF-8 として読むとほぼすべて不正になるので、正しく読めた非 ASCII 文字が十分多ければ UTF-8 とみなす
    let lossy = String::from_utf8_lossy(bytes);
    let (mut good, mut bad) = (0usize, 0usize);
    for c in lossy.chars() {
        match c {
            '\u{FFFD}' => bad += 1,
            c if !c.is_ascii() => good += 1,
            _ => {}
        }
    }
    if good >= bad * 4 {
        return (lossy.into_owned(), encoding_rs::UTF_8.name());
    }
    // ISO-2022-JP は 7 ビットなので UTF-8 として正しく、ここには来ない
    let mut det = EncodingDetector::new(Iso2022JpDetection::Deny);
    det.feed(bytes, true);
    let enc = det.guess(None, Utf8Detection::Allow);
    let (s, _) = enc.decode_without_bom_handling(bytes);
    (s.into_owned(), enc.name())
}

/// 相対パスをルート配下に解決する。`..` や絶対パスは拒否。
fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(format!("不正なパスです: {rel}"));
    }
    Ok(root.join(rel_path))
}

/// 実在するパスについて、シンボリックリンク等をたどった先がフォルダ（正規化済み canon）の中か確認する。
fn ensure_inside(canon: &Path, path: &Path) -> Result<(), String> {
    let real = fs::canonicalize(path).map_err(|e| format!("パスを確認できません: {e}"))?;
    if real.starts_with(canon) {
        Ok(())
    } else {
        Err(format!("資料フォルダの外を指すパスです: {}", path.display()))
    }
}

/// 読み取り用: ルート配下に解決し、実在すればフォルダ内か確認する。無ければ None。
fn resolve_existing(root: &Path, canon: &Path, rel: &str) -> Result<Option<PathBuf>, String> {
    let path = resolve(root, rel)?;
    if !path.exists() {
        return Ok(None);
    }
    ensure_inside(canon, &path)?;
    Ok(Some(path))
}

/// 書き込み用: 親フォルダがフォルダ内か確認する（ファイル自体はまだ無くてよい）。
fn resolve_for_write(root: &Path, canon: &Path, rel: &str) -> Result<PathBuf, String> {
    let path = resolve(root, rel)?;
    let parent = path.parent().ok_or_else(|| format!("不正なパスです: {rel}"))?;
    ensure_inside(canon, parent)?;
    Ok(path)
}

fn notes_rel(rel: &str) -> String {
    format!("{rel}{NOTES_SUFFIX}")
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

/// ノートファイルに含まれるノートの件数
fn count_notes(path: &Path) -> Option<usize> {
    let json: serde_json::Value = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    json.get("notes")?.as_array().map(Vec::len)
}

fn walk(root: &Path, dir: &Path, out: &mut DocList) {
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
                out.docs.push(DocEntry {
                    path: rel,
                    has_notes: Path::new(&np).exists(),
                });
            }
        } else if ft.is_file() {
            // 対応する資料が無いノートファイル
            let Some(doc_name) = name.strip_suffix(NOTES_SUFFIX) else { continue };
            let doc = path.with_file_name(doc_name);
            if is_supported(&doc) && fs::symlink_metadata(&doc).is_err() {
                if let Some(rel) = to_rel(root, &doc) {
                    out.orphans.push(OrphanNotes {
                        path: rel,
                        note_count: count_notes(&path),
                    });
                }
            }
        }
    }
}

#[tauri::command]
fn list_documents(state: State<FolderState>, root: String) -> Result<DocList, String> {
    let (root_path, _) = checked_root(&state, &root)?;
    if !root_path.is_dir() {
        return Err(format!("フォルダが見つかりません: {root}"));
    }
    let mut out = DocList {
        docs: Vec::new(),
        orphans: Vec::new(),
    };
    walk(&root_path, &root_path, &mut out);
    out.docs.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    out.orphans.sort_by_key(|o| o.path.to_lowercase());
    Ok(out)
}

#[tauri::command]
fn read_document(state: State<FolderState>, root: String, rel: String) -> Result<DocContent, String> {
    let (root_path, canon) = checked_root(&state, &root)?;
    let path = resolve_existing(&root_path, &canon, &rel)?.ok_or_else(|| format!("資料が見つかりません: {rel}"))?;
    let bytes = fs::read(&path).map_err(|e| format!("資料を読めません: {e}"))?;
    // ハッシュは生のバイト列から（文字コードの判定結果が変わっても旧版扱いにならない）
    let sha256 = hex::encode(Sha256::digest(&bytes));
    let (content, encoding) = decode_text(&bytes);
    Ok(DocContent {
        content,
        sha256,
        encoding: encoding.to_string(),
    })
}

/// バイナリ資料（.docx など）をそのまま返す。解析はフロントエンド側で行う。
#[tauri::command]
fn read_document_bytes(
    state: State<FolderState>,
    root: String,
    rel: String,
) -> Result<Response, String> {
    let (root_path, canon) = checked_root(&state, &root)?;
    let path = resolve_existing(&root_path, &canon, &rel)?.ok_or_else(|| format!("資料が見つかりません: {rel}"))?;
    let bytes = fs::read(&path).map_err(|e| format!("資料を読めません: {e}"))?;
    Ok(Response::new(bytes))
}

#[tauri::command]
fn read_notes(state: State<FolderState>, root: String, rel: String) -> Result<Option<String>, String> {
    let (root_path, canon) = checked_root(&state, &root)?;
    let Some(path) = resolve_existing(&root_path, &canon, &notes_rel(&rel))? else {
        return Ok(None);
    };
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("ノートファイルを読めません: {e}"))
}

/// フォルダ直下の設定ファイルを読む（無ければ None）。
#[tauri::command]
fn read_config(state: State<FolderState>, root: String) -> Result<Option<String>, String> {
    let (root_path, canon) = checked_root(&state, &root)?;
    let Some(path) = resolve_existing(&root_path, &canon, CONFIG_FILE)? else {
        return Ok(None);
    };
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("設定ファイルを読めません: {e}"))
}

/// 保存しようとしたノートファイルが、最後に読んだ／書いた内容から外部で変更されていたときのエラー。
const NOTES_CONFLICT: &str = "NOTES_CONFLICT";

/// ディスク上の内容が expected（None は「ファイルが無い」）と同じか
fn matches_on_disk(path: &Path, expected: Option<&str>) -> Result<bool, String> {
    match fs::read(path) {
        Ok(bytes) => Ok(expected.is_some_and(|e| e.as_bytes() == bytes.as_slice())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(expected.is_none()),
        Err(e) => Err(format!("ノートファイルを確認できません: {e}")),
    }
}

/// ノートファイルをアトミックに書き込む（一時ファイル → rename）。
/// ディスク上の内容が expected と異なる（外部で変更された）ときは書き込まず `NOTES_CONFLICT` を返す。
#[tauri::command]
fn write_notes(
    state: State<FolderState>,
    root: String,
    rel: String,
    content: String,
    expected: Option<String>,
) -> Result<(), String> {
    let (root_path, canon) = checked_root(&state, &root)?;
    let path = resolve_for_write(&root_path, &canon, &notes_rel(&rel))?;
    if !matches_on_disk(&path, expected.as_deref())? {
        return Err(NOTES_CONFLICT.to_string());
    }
    let mut tmp = path.clone().into_os_string();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    // 一時ファイルの名前でリンクが置かれていても、たどった先には書かない
    if fs::symlink_metadata(&tmp).is_ok() {
        fs::remove_file(&tmp).map_err(|e| format!("保存に失敗しました: {e}"))?;
    }
    fs::write(&tmp, content.as_bytes()).map_err(|e| format!("保存に失敗しました: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("保存に失敗しました: {e}")
    })
}

/// 競合した編集を `<資料名>.notes.conflict-<tag>.json` に退避する（既存ファイルは上書きしない）。
/// 作成したファイルのルートからの相対パスを返す。
#[tauri::command]
fn write_notes_backup(
    state: State<FolderState>,
    root: String,
    rel: String,
    tag: String,
    content: String,
) -> Result<String, String> {
    if tag.is_empty() || tag.len() > 32 || !tag.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("不正な退避名です: {tag}"));
    }
    let (root_path, canon) = checked_root(&state, &root)?;
    for i in 1..=99 {
        let suffix = if i == 1 { String::new() } else { format!("-{i}") };
        let backup_rel = format!("{rel}.notes.conflict-{tag}{suffix}.json");
        let path = resolve_for_write(&root_path, &canon, &backup_rel)?;
        match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut f) => {
                use std::io::Write;
                f.write_all(content.as_bytes())
                    .map_err(|e| format!("退避に失敗しました: {e}"))?;
                return Ok(backup_rel);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("退避に失敗しました: {e}")),
        }
    }
    Err("退避ファイルを作成できません（同名のファイルが多すぎます）".to_string())
}

/// 孤立したノートファイル（対応する資料が無いもの）を削除する。付け替え先へ書き込んだ後に使う。
/// - 資料が存在するノートファイルは削除しない
/// - ディスク上の内容が expected（付け替えのために読んだ内容）と異なれば削除せず `NOTES_CONFLICT` を返す
#[tauri::command]
fn delete_orphan_notes(
    state: State<FolderState>,
    root: String,
    rel: String,
    expected: String,
) -> Result<(), String> {
    let (root_path, canon) = checked_root(&state, &root)?;
    remove_orphan_notes(&root_path, &canon, &rel, &expected)
}

fn remove_orphan_notes(root: &Path, canon: &Path, rel: &str, expected: &str) -> Result<(), String> {
    let doc = resolve(root, rel)?;
    if fs::symlink_metadata(&doc).is_ok() {
        return Err(format!("資料が存在するため削除しません: {rel}"));
    }
    let Some(path) = resolve_existing(root, canon, &notes_rel(rel))? else {
        return Ok(());
    };
    if !matches_on_disk(&path, Some(expected))? {
        return Err(NOTES_CONFLICT.to_string());
    }
    fs::remove_file(&path).map_err(|e| format!("ノートファイルを削除できません: {e}"))
}

/// 資料フォルダを開く。以降のコマンドはこのフォルダに対してのみ動く。
/// - フォルダを監視し、変更されたファイルの相対パスを `fs-changed` イベントで通知する
/// - 資料内の相対画像を表示できるよう asset プロトコルでこのフォルダを公開する
///   （tauri.conf.json の scope は空。開いていないフォルダのファイルは表示できない）
#[tauri::command]
fn open_folder(app: AppHandle, state: State<FolderState>, root: String) -> Result<(), String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_absolute() || !root_path.is_dir() {
        return Err(format!("フォルダが見つかりません: {root}"));
    }
    let canon = fs::canonicalize(&root_path).map_err(|e| format!("フォルダを開けません: {e}"))?;
    app.asset_protocol_scope()
        .allow_directory(&root_path, true)
        .map_err(|e| format!("フォルダを公開できません: {e}"))?;
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
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "内部エラー（状態をロックできません）".to_string())?;
    *guard = Some(OpenFolder {
        root,
        canon,
        _watcher: watcher,
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(FolderState::default())
        .invoke_handler(tauri::generate_handler![
            list_documents,
            read_document,
            read_document_bytes,
            read_notes,
            read_config,
            write_notes,
            write_notes_backup,
            delete_orphan_notes,
            open_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("document-memo-kakikomi-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("sub")).unwrap();
        d
    }

    #[test]
    fn resolve_rejects_parent_and_absolute() {
        let root = Path::new("root");
        assert!(resolve(root, "a/b.md").is_ok());
        assert!(resolve(root, "../x.md").is_err());
        assert!(resolve(root, "a/../../x.md").is_err());
        assert!(resolve(root, "./a.md").is_err());
        #[cfg(windows)]
        assert!(resolve(root, "C:\\x.md").is_err());
        #[cfg(unix)]
        assert!(resolve(root, "/etc/passwd").is_err());
    }

    #[test]
    fn resolve_existing_and_for_write_stay_inside() {
        let root = temp_dir("inside");
        let canon = fs::canonicalize(&root).unwrap();
        fs::write(root.join("sub/a.md"), "x").unwrap();

        assert!(resolve_existing(&root, &canon, "sub/a.md").unwrap().is_some());
        assert!(resolve_existing(&root, &canon, "sub/none.md").unwrap().is_none());
        assert!(resolve_for_write(&root, &canon, "sub/a.md.notes.json").is_ok());
        // 親フォルダが存在しない書き込みは拒否
        assert!(resolve_for_write(&root, &canon, "nodir/a.md.notes.json").is_err());

        // 正規化したパスが root の外なら拒否
        let other = temp_dir("other");
        fs::write(other.join("b.md"), "y").unwrap();
        assert!(ensure_inside(&canon, &other.join("b.md")).is_err());

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&other);
    }

    const JA: &str = "# 仕様書\n\nこれは日本語で書かれた資料です。文字コードを自動で判定して、正しく表示できることを確認します。\n";

    #[test]
    fn decode_text_utf8_and_bom() {
        assert_eq!(decode_text(JA.as_bytes()), (JA.to_string(), "UTF-8"));
        let mut bom = vec![0xEF, 0xBB, 0xBF];
        bom.extend_from_slice(JA.as_bytes());
        assert_eq!(decode_text(&bom), (JA.to_string(), "UTF-8"));
        let mut u16 = vec![0xFF, 0xFE];
        u16.extend(JA.encode_utf16().flat_map(|c| c.to_le_bytes()));
        assert_eq!(decode_text(&u16), (JA.to_string(), "UTF-16LE"));
    }

    #[test]
    fn decode_text_detects_japanese_legacy_encodings() {
        for enc in [encoding_rs::SHIFT_JIS, encoding_rs::EUC_JP] {
            let (bytes, _, _) = enc.encode(JA);
            assert_eq!(decode_text(&bytes), (JA.to_string(), enc.name()));
        }
    }

    #[test]
    fn decode_text_mostly_utf8_stays_utf8() {
        let mut bytes = JA.as_bytes().to_vec();
        bytes.push(0xFF);
        let (s, enc) = decode_text(&bytes);
        assert_eq!(enc, "UTF-8");
        assert!(s.starts_with(JA));
    }

    #[test]
    fn walk_finds_orphan_notes() {
        let root = temp_dir("orphans");
        fs::write(root.join("a.md"), "x").unwrap();
        fs::write(root.join("a.md.notes.json"), r#"{"notes":[{},{}]}"#).unwrap();
        fs::write(root.join("sub/gone.docx.notes.json"), r#"{"notes":[{}]}"#).unwrap();
        fs::write(root.join("broken.md.notes.json"), "{").unwrap();
        // 対応形式でない資料のノート・競合の退避ファイルは対象外
        fs::write(root.join("x.txt.notes.json"), "{}").unwrap();
        fs::write(root.join("a.md.notes.conflict-20261117-000000.json"), "{}").unwrap();
        let mut out = DocList {
            docs: Vec::new(),
            orphans: Vec::new(),
        };
        walk(&root, &root, &mut out);
        out.orphans.sort_by(|a, b| a.path.cmp(&b.path));
        let orphans: Vec<_> = out.orphans.iter().map(|o| (o.path.as_str(), o.note_count)).collect();
        assert_eq!(orphans, vec![("broken.md", None), ("sub/gone.docx", Some(1))]);
        assert_eq!(out.docs.len(), 1);
        assert!(out.docs[0].has_notes);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn remove_orphan_notes_is_guarded() {
        let root = temp_dir("remove-orphan");
        let canon = fs::canonicalize(&root).unwrap();
        fs::write(root.join("a.md"), "x").unwrap();
        fs::write(root.join("a.md.notes.json"), "A").unwrap();
        fs::write(root.join("gone.md.notes.json"), "G").unwrap();
        // 資料があるノートは消さない
        assert!(remove_orphan_notes(&root, &canon, "a.md", "A").is_err());
        assert!(root.join("a.md.notes.json").exists());
        // 内容が変わっていたら消さない
        assert_eq!(remove_orphan_notes(&root, &canon, "gone.md", "X"), Err(NOTES_CONFLICT.to_string()));
        assert!(root.join("gone.md.notes.json").exists());
        assert!(remove_orphan_notes(&root, &canon, "gone.md", "G").is_ok());
        assert!(!root.join("gone.md.notes.json").exists());
        // 既に無ければ何もしない
        assert!(remove_orphan_notes(&root, &canon, "gone.md", "G").is_ok());
        assert!(remove_orphan_notes(&root, &canon, "../gone.md", "G").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn matches_on_disk_detects_external_change() {
        let root = temp_dir("conflict");
        let p = root.join("a.md.notes.json");
        // ファイルが無い
        assert!(matches_on_disk(&p, None).unwrap());
        assert!(!matches_on_disk(&p, Some("x")).unwrap());
        // ファイルがある
        fs::write(&p, "x").unwrap();
        assert!(matches_on_disk(&p, Some("x")).unwrap());
        assert!(!matches_on_disk(&p, Some("y")).unwrap());
        assert!(!matches_on_disk(&p, None).unwrap());
        let _ = fs::remove_dir_all(&root);
    }
}
