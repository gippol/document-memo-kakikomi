import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { api, errMsg, NOTES_CONFLICT } from "../lib/api";
import { emptyNotesFile, NOTES_SUFFIX, parseNotesFile, serializeNotesFile, type NotesFile } from "../lib/notesFile";

export type SaveState = "none" | "pending" | "saving" | "saved" | "error";

interface PendingSave {
  root: string;
  path: string;
  json: string;
}

const SAVE_DELAY = 500;

/** 退避ファイル名に付ける日時（例: 20261117-041300） */
function backupTag(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

interface Options {
  /** いま開いているフォルダ・資料（非同期処理の完了時に「まだ同じ資料か」を確かめるのに使う） */
  rootRef: RefObject<string | null>;
  pathRef: RefObject<string | null>;
  /** ノートファイルを書き込めたとき */
  onWritten(path: string): void;
}

/**
 * 開いている資料のノートファイルの読み込みと保存。
 * - 編集は少し待ってからまとめて保存する（資料を切り替える・ウィンドウを閉じるときは即座に書き出す）
 * - 保存時に外部（git pull・同期フォルダなど）での変更を検出したら上書きせず、編集を退避して読み込み直す
 * - 壊れたファイルは上書きしないよう編集をロックする
 */
export function useNotesStore({ rootRef, pathRef, onWritten }: Options) {
  const [notesFile, setNotesFile] = useState<NotesFile | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("none");
  const [saveError, setSaveError] = useState<string | null>(null);
  /** ノートファイルの保存が外部の変更と競合したときの通知（閉じるまで表示） */
  const [conflictNotice, setConflictNotice] = useState<string | null>(null);

  const notesRef = useRef<NotesFile | null>(null);
  /** 資料ごとに、ディスク上にあるはずのノートファイルの内容（最後に読んだ／書いたもの。null はファイルが無い） */
  const lastWritten = useRef(new Map<string, string | null>());
  const pendingSave = useRef<PendingSave | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onWrittenRef = useRef(onWritten);
  onWrittenRef.current = onWritten;

  // ---------- 読み込み ----------

  const loadNotes = useCallback(async (r: string, path: string) => {
    const json = await api.readNotes(r, path);
    lastWritten.current.set(path, json);
    if (json === null) {
      notesRef.current = null;
      setNotesFile(null);
      setNotesError(null);
      setSaveState("none");
      return;
    }
    try {
      const parsed = parseNotesFile(json, path);
      notesRef.current = parsed;
      setNotesFile(parsed);
      setNotesError(null);
      setSaveState("saved");
    } catch (e) {
      // 壊れたファイルを上書きしないよう、編集をロックする
      notesRef.current = null;
      setNotesFile(null);
      setNotesError(`${path}${NOTES_SUFFIX} を読み込めません: ${errMsg(e)}（上書き防止のため編集をロックしています）`);
      setSaveState("error");
    }
  }, []);

  /** フォルダを開き直したときなど、資料を開いていない状態に戻す */
  const reset = useCallback(() => {
    notesRef.current = null;
    setNotesFile(null);
    setNotesError(null);
    setSaveState("none");
  }, []);

  /** ノートファイルが外部で変更された通知を受けたとき。自分の書き込み・未保存の編集があるときは読み込み直さない */
  const onExternalChange = useCallback(
    (r: string, path: string) => {
      if (pendingSave.current) return;
      void api
        .readNotes(r, path)
        .then((json) => {
          if (pathRef.current !== path || pendingSave.current) return;
          if (json !== null && json === lastWritten.current.get(path)) return; // 自分の書き込み
          void loadNotes(r, path);
        })
        .catch(() => {
          /* 読めなければ次の変更通知を待つ */
        });
    },
    [loadNotes, pathRef],
  );

  // ---------- 保存 ----------

  /**
   * 保存しようとしたら外部でノートファイルが変更されていた。
   * 外部の変更を上書きしないよう、こちらの編集は別ファイルに退避し、外部の内容を読み込み直す。
   */
  const resolveConflict = useCallback(
    async (p: PendingSave) => {
      // まだ書いていない、より新しい編集があればそれを退避する（読み込み直した内容を上書きさせない）
      let json = p.json;
      const later = pendingSave.current;
      if (later && later.root === p.root && later.path === p.path) {
        json = later.json;
        pendingSave.current = null;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      const isCurrent = () => rootRef.current === p.root && pathRef.current === p.path;
      let backup: string;
      try {
        backup = await api.writeNotesBackup(p.root, p.path, backupTag(new Date()), json);
      } catch (e) {
        // 退避できなかった編集は画面上に残す（読み込み直さない）
        if (isCurrent()) {
          setSaveState("error");
          setSaveError(`ノートファイルが外部で変更されていたため保存を中止しましたが、編集の退避にも失敗しました: ${errMsg(e)}`);
        }
        return;
      }
      setConflictNotice(
        `${p.path}${NOTES_SUFFIX} が外部で変更されていたため上書きしませんでした。こちらの編集は ${backup} に退避し、外部の内容を読み込み直しました`,
      );
      if (isCurrent()) {
        setSaveError(null);
        await loadNotes(p.root, p.path).catch((e) => {
          setSaveState("error");
          setSaveError(`ノートファイルを読み込み直せません: ${errMsg(e)}`);
        });
      }
    },
    [loadNotes, rootRef, pathRef],
  );

  const writeNow = useCallback(
    async (p: PendingSave) => {
      if (pendingSave.current === p) pendingSave.current = null;
      if (pathRef.current === p.path) setSaveState("saving");
      const expected = lastWritten.current.get(p.path) ?? null;
      // 自分の書き込みによる変更通知を無視できるよう、先に記録しておく
      lastWritten.current.set(p.path, p.json);
      try {
        await api.writeNotes(p.root, p.path, p.json, expected);
        if (pathRef.current === p.path) {
          setSaveState(pendingSave.current ? "pending" : "saved");
          setSaveError(null);
        }
        onWrittenRef.current(p.path);
      } catch (e) {
        lastWritten.current.set(p.path, expected);
        if (e === NOTES_CONFLICT) {
          await resolveConflict(p);
          return;
        }
        if (pathRef.current === p.path) {
          setSaveState("error");
          setSaveError(errMsg(e));
        }
      }
    },
    [resolveConflict, pathRef],
  );

  /** 未保存の編集があれば即座に書き出す */
  const flushSave = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const p = pendingSave.current;
    if (p) await writeNow(p);
  }, [writeNow]);

  const commitNotes = useCallback(
    (next: NotesFile) => {
      const r = rootRef.current;
      const path = pathRef.current;
      if (!r || !path) return;
      notesRef.current = next;
      setNotesFile(next);
      const p: PendingSave = { root: r, path, json: serializeNotesFile(next) };
      pendingSave.current = p;
      setSaveState("pending");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        void writeNow(p);
      }, SAVE_DELAY);
    },
    [writeNow, rootRef, pathRef],
  );

  /** ノートを編集する（ノートファイルがまだ無ければ作る）。読めないファイルのときは何もしない */
  const updateNotes = useCallback(
    (fn: (f: NotesFile) => NotesFile) => {
      const path = pathRef.current;
      if (!path || notesError) return;
      commitNotes(fn(notesRef.current ?? emptyNotesFile(path)));
    },
    [commitNotes, notesError, pathRef],
  );

  // ウィンドウを閉じる前に未保存分を書き出す
  useEffect(() => {
    const un = getCurrentWindow().onCloseRequested(async () => {
      await flushSave();
    });
    return () => {
      void un.then((f) => f());
    };
  }, [flushSave]);

  return {
    notesFile,
    notesError,
    saveState,
    saveError,
    conflictNotice,
    dismissConflict: () => setConflictNotice(null),
    loadNotes,
    reset,
    onExternalChange,
    flushSave,
    updateNotes,
  };
}

export type NotesStore = ReturnType<typeof useNotesStore>;
