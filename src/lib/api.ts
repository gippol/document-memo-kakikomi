import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { NotesFileEntry } from "./board";

export interface DocEntry {
  path: string;
  hasNotes: boolean;
}

/** 対応する資料が見つからない（リネーム・移動・削除で取り残された）ノートファイル */
export interface OrphanNotes {
  /** 元の資料の相対パス（ノートファイルのパスから .notes.json を除いたもの） */
  path: string;
  /** ノートの件数（読めなければ null） */
  noteCount: number | null;
}

export interface DocList {
  docs: DocEntry[];
  orphans: OrphanNotes[];
}

export interface DocContent {
  content: string;
  sha256: string;
  /** 判定した文字コード（"UTF-8" / "Shift_JIS" / "EUC-JP" など） */
  encoding: string;
}

/** invoke などのエラーを表示用の文字列にする（Tauri のコマンドは文字列でエラーを返す） */
export function errMsg(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}

/** write_notes が「外部で変更されていた」ときに返すエラー */
export const NOTES_CONFLICT = "NOTES_CONFLICT";

export const api = {
  /**
   * フォルダ選択ダイアログ（Rust 側で出す）で資料フォルダを選ぶ。選んだフォルダは
   * open_folder で開けるようになる（選んだことのないフォルダは開けない）。キャンセルしたら null
   */
  pickFolder: () => invoke<string | null>("pick_folder"),
  listDocuments: (root: string) => invoke<DocList>("list_documents", { root }),
  /** フォルダ内のすべてのノートファイル（宿題・質問ボード用。中身の検証は parseNotesFile で行う） */
  listAllNotes: (root: string) => invoke<NotesFileEntry[]>("list_all_notes", { root }),
  readDocument: (root: string, rel: string) => invoke<DocContent>("read_document", { root, rel }),
  readDocumentBytes: (root: string, rel: string) => invoke<ArrayBuffer>("read_document_bytes", { root, rel }),
  readConfig: (root: string) => invoke<string | null>("read_config", { root }),
  readNotes: (root: string, rel: string) => invoke<string | null>("read_notes", { root, rel }),
  /**
   * ノートファイルを書き込む。expected は最後に読んだ／書いた内容（null はファイルが無い想定）。
   * ディスク上の内容が異なれば書き込まず NOTES_CONFLICT で失敗する
   */
  writeNotes: (root: string, rel: string, content: string, expected: string | null) =>
    invoke<void>("write_notes", { root, rel, content, expected }),
  /** 競合した編集を退避し、作成したファイルの相対パスを返す */
  writeNotesBackup: (root: string, rel: string, tag: string, content: string) =>
    invoke<string>("write_notes_backup", { root, rel, tag, content }),
  /**
   * 孤立したノートファイルを削除する（付け替え先へ書き込んだ後に使う）。
   * 資料が存在する場合や、内容が expected から変わっていた場合（NOTES_CONFLICT）は削除しない
   */
  deleteOrphanNotes: (root: string, rel: string, expected: string) =>
    invoke<void>("delete_orphan_notes", { root, rel, expected }),
  /**
   * 議事録の Markdown を保存する。保存先は Rust 側で出す保存ダイアログで選ぶ（既定は資料と同じフォルダ）。
   * 保存したファイルのパスを返す（キャンセルしたら null）
   */
  saveMinutes: (root: string, rel: string, fileName: string, content: string) =>
    invoke<string | null>("save_minutes", { root, rel, fileName, content }),
  /** 資料フォルダを登録して監視を始める。ほかのコマンドはこのフォルダに対してのみ動く */
  openFolder: (root: string) => invoke<void>("open_folder", { root }),
  onFsChanged: (cb: (paths: string[]) => void): Promise<UnlistenFn> =>
    listen<string[]>("fs-changed", (e) => cb(e.payload)),
};

/** クリップボードに文字列をコピーする（Clipboard API が使えなければ選択してコピー） */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    /* 下の方法で試す */
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  if (!ok) throw new Error("クリップボードにコピーできません");
}
