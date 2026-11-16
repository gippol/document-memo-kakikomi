import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

export interface DocEntry {
  path: string;
  hasNotes: boolean;
}

export interface DocContent {
  content: string;
  sha256: string;
  /** 判定した文字コード（"UTF-8" / "Shift_JIS" / "EUC-JP" など） */
  encoding: string;
}

/** write_notes が「外部で変更されていた」ときに返すエラー */
export const NOTES_CONFLICT = "NOTES_CONFLICT";

export const api = {
  pickFolder: async (): Promise<string | null> => {
    const r = await open({ directory: true, multiple: false, title: "資料フォルダを開く" });
    return typeof r === "string" ? r : null;
  },
  listDocuments: (root: string) => invoke<DocEntry[]>("list_documents", { root }),
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
  /** 資料フォルダを登録して監視を始める。ほかのコマンドはこのフォルダに対してのみ動く */
  openFolder: (root: string) => invoke<void>("open_folder", { root }),
  onFsChanged: (cb: (paths: string[]) => void): Promise<UnlistenFn> =>
    listen<string[]>("fs-changed", (e) => cb(e.payload)),
};
