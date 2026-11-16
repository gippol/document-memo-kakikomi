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
}

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
  writeNotes: (root: string, rel: string, content: string) =>
    invoke<void>("write_notes", { root, rel, content }),
  /** 資料フォルダを登録して監視を始める。ほかのコマンドはこのフォルダに対してのみ動く */
  openFolder: (root: string) => invoke<void>("open_folder", { root }),
  onFsChanged: (cb: (paths: string[]) => void): Promise<UnlistenFn> =>
    listen<string[]>("fs-changed", (e) => cb(e.payload)),
};
