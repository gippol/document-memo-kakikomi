import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errMsg } from "../lib/api";
import { collectBoard, type NotesFileEntry } from "../lib/board";
import { collectDecisions } from "../lib/ledger";
import { NOTES_SUFFIX, type NotesFile } from "../lib/notesFile";

/**
 * フォルダ全体のノート（宿題・質問ボードと決定事項の台帳）のデータ。
 * 開いている間だけノートファイルを読み、外部でノートファイルが変わったら読み直す。
 * 開いている資料のノートは、未保存の編集を含むメモリ上のものを使う。
 */
export function useFolderNotes(root: string | null, open: boolean, currentPath: string | null, notesFile: NotesFile | null) {
  const [entries, setEntries] = useState<NotesFileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef(root);
  rootRef.current = root;

  const reload = useCallback(async () => {
    const r = rootRef.current;
    if (!r) return;
    try {
      const list = await api.listAllNotes(r);
      if (rootRef.current !== r) return;
      setEntries(list);
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setEntries(null);
      return;
    }
    void reload();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const un = api.onFsChanged((paths) => {
      if (!paths.some((p) => p.endsWith(NOTES_SUFFIX))) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void reload(), 300);
    });
    return () => {
      if (timer) clearTimeout(timer);
      void un.then((f) => f());
    };
  }, [open, root, reload]);

  const current = useMemo(() => (currentPath && notesFile ? { path: currentPath, file: notesFile } : null), [currentPath, notesFile]);
  const board = useMemo(() => (entries ? collectBoard(entries, current) : null), [entries, current]);
  const decisions = useMemo(() => (entries ? collectDecisions(entries, current) : null), [entries, current]);
  return { board, decisions, error, reload };
}
