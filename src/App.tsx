import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileTree } from "./components/FileTree";
import { NotesPanel, type NoteView, type SortMode } from "./components/NotesPanel";
import { Viewer, type HighlightSpec, type TextSelection, type ViewerHandle } from "./components/Viewer";
import { createAnchor, resolveAnchor } from "./lib/anchor";
import { api, type DocEntry } from "./lib/api";
import { loadDocument, type LoadedDoc } from "./lib/document";
import {
  emptyNotesFile,
  nextNoteId,
  NOTES_SUFFIX,
  parseNotesFile,
  serializeNotesFile,
  type NotesFile,
} from "./lib/notesFile";

type SaveState = "none" | "pending" | "saving" | "saved" | "error";

interface PendingSave {
  root: string;
  path: string;
  json: string;
}

const LS_ROOT = "shiryo-memo:lastRoot";
const lsDocKey = (root: string) => `shiryo-memo:lastDoc:${root}`;
const SAVE_DELAY = 500;

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* noop */
  }
}

function errMsg(e: unknown) {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}

export default function App() {
  const [root, setRoot] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [doc, setDoc] = useState<LoadedDoc | null>(null);
  const [docText, setDocText] = useState<string | null>(null);
  const [notesFile, setNotesFile] = useState<NotesFile | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("none");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [draft, setDraft] = useState<TextSelection | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [sortMode, setSortMode] = useState<SortMode>("position");
  const [treeOpen, setTreeOpen] = useState(true);

  const viewerRef = useRef<ViewerHandle>(null);
  const rootRef = useRef<string | null>(null);
  const pathRef = useRef<string | null>(null);
  const notesRef = useRef<NotesFile | null>(null);
  const lastWritten = useRef(new Map<string, string>());
  const pendingSave = useRef<PendingSave | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------- 保存 ----------

  const writeNow = useCallback(async (p: PendingSave) => {
    if (pendingSave.current === p) pendingSave.current = null;
    if (pathRef.current === p.path) setSaveState("saving");
    lastWritten.current.set(p.path, p.json);
    try {
      await api.writeNotes(p.root, p.path, p.json);
      if (pathRef.current === p.path) {
        setSaveState(pendingSave.current ? "pending" : "saved");
        setSaveError(null);
      }
      setDocs((ds) => ds.map((d) => (d.path === p.path && !d.hasNotes ? { ...d, hasNotes: true } : d)));
    } catch (e) {
      lastWritten.current.delete(p.path);
      if (pathRef.current === p.path) {
        setSaveState("error");
        setSaveError(errMsg(e));
      }
    }
  }, []);

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
    [writeNow],
  );

  const updateNotes = useCallback(
    (fn: (f: NotesFile) => NotesFile) => {
      const path = pathRef.current;
      if (!path || notesError) return;
      commitNotes(fn(notesRef.current ?? emptyNotesFile(path)));
    },
    [commitNotes, notesError],
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

  // ---------- 読み込み ----------

  const loadNotes = useCallback(async (r: string, path: string) => {
    const json = await api.readNotes(r, path);
    if (json === null) {
      notesRef.current = null;
      setNotesFile(null);
      setNotesError(null);
      setSaveState("none");
      return;
    }
    lastWritten.current.set(path, json);
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

  const openDoc = useCallback(
    async (path: string) => {
      const r = rootRef.current;
      if (!r) return;
      await flushSave();
      setDraft(null);
      setActiveId(null);
      setSelection(null);
      try {
        const content = await loadDocument(r, path);
        pathRef.current = path;
        setCurrentPath(path);
        setDoc(content);
        await loadNotes(r, path);
        setError(null);
        lsSet(lsDocKey(r), path);
      } catch (e) {
        setError(errMsg(e));
      }
    },
    [flushSave, loadNotes],
  );

  const refreshDocs = useCallback(async () => {
    const r = rootRef.current;
    if (!r) return;
    try {
      setDocs(await api.listDocuments(r));
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  const openFolder = useCallback(
    async (r: string) => {
      await flushSave();
      try {
        const list = await api.listDocuments(r);
        rootRef.current = r;
        pathRef.current = null;
        setRoot(r);
        setDocs(list);
        setCurrentPath(null);
        setDoc(null);
        setDocText(null);
        notesRef.current = null;
        setNotesFile(null);
        setNotesError(null);
        setSaveState("none");
        setError(null);
        lsSet(LS_ROOT, r);
        await api.watchFolder(r);
        const last = lsGet(lsDocKey(r));
        const initial = list.find((d) => d.path === last) ?? list[0];
        if (initial) await openDoc(initial.path);
      } catch (e) {
        setError(errMsg(e));
      }
    },
    [flushSave, openDoc],
  );

  useEffect(() => {
    const last = lsGet(LS_ROOT);
    if (last) void openFolder(last);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 外部での変更検知 ----------

  const handleFsChange = useRef<(paths: string[]) => void>(() => {});
  const treeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  handleFsChange.current = (paths: string[]) => {
    const r = rootRef.current;
    const cur = pathRef.current;
    if (!r) return;

    if (paths.some((p) => /\.(md|markdown|docx|notes\.json)$/i.test(p) || !/\.[^/]+$/.test(p))) {
      if (treeTimer.current) clearTimeout(treeTimer.current);
      treeTimer.current = setTimeout(() => void refreshDocs(), 300);
    }
    if (!cur) return;

    if (paths.includes(cur)) {
      loadDocument(r, cur)
        .then((c) => {
          if (pathRef.current !== cur) return;
          setDoc((prev) => (prev?.sha256 === c.sha256 ? prev : c));
          setError(null);
        })
        .catch(() => setError(`資料「${cur}」が見つかりません（移動または削除された可能性があります）`));
    }
    if (paths.includes(cur + NOTES_SUFFIX) && !pendingSave.current) {
      api.readNotes(r, cur).then((json) => {
        if (pathRef.current !== cur || pendingSave.current) return;
        if (json !== null && json === lastWritten.current.get(cur)) return; // 自分の書き込み
        void loadNotes(r, cur);
      });
    }
  };

  useEffect(() => {
    const un = api.onFsChanged((paths) => handleFsChange.current(paths));
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // ---------- アンカー解決 ----------

  const views: NoteView[] = useMemo(() => {
    if (!notesFile || docText === null || !doc) return [];
    return notesFile.notes.map((note) => {
      const r = resolveAnchor(docText, note.anchor);
      const stale = note.anchor.sourceSha256 !== doc.sha256;
      const lines =
        r.status === "ok" && !stale
          ? {
              lineStart: note.anchor.lineStart,
              lineEnd: note.anchor.lineEnd,
              paragraph: note.anchor.paragraph,
              heading: note.anchor.heading,
            }
          : r.status === "orphaned"
            ? {}
            : (viewerRef.current?.locate(r.start, r.end) ?? {});
      return { note, status: r.status, stale, start: r.start, end: r.end, ...lines };
    });
  }, [notesFile, docText, doc]);

  const sortedViews = useMemo(() => {
    const arr = [...views];
    if (sortMode === "position") {
      arr.sort((a, b) => {
        const ao = a.status === "orphaned" ? 1 : 0;
        const bo = b.status === "orphaned" ? 1 : 0;
        return ao - bo || a.start - b.start;
      });
    } else {
      arr.sort((a, b) => b.note.createdAt.localeCompare(a.note.createdAt));
    }
    return arr;
  }, [views, sortMode]);

  const highlights: HighlightSpec[] = useMemo(
    () =>
      views
        .filter((v) => v.status !== "orphaned")
        .map((v) => ({ id: v.note.id, start: v.start, end: v.end, stale: v.status === "fuzzy" })),
    [views],
  );

  const staleSummary = useMemo(() => {
    const s = { total: 0, moved: 0, fuzzy: 0, orphaned: 0 };
    for (const v of views) {
      if (!v.stale && v.status === "ok") continue;
      s.total++;
      if (v.status === "moved") s.moved++;
      if (v.status === "fuzzy") s.fuzzy++;
      if (v.status === "orphaned") s.orphaned++;
    }
    return s;
  }, [views]);

  // ---------- 操作 ----------

  const canEdit = !!doc && docText !== null && !notesError;

  const startDraft = useCallback(() => {
    if (!selection || !canEdit) return;
    setDraft(selection);
    setActiveId(null);
    window.getSelection()?.removeAllRanges();
  }, [selection, canEdit]);

  const saveDraft = (comment: string) => {
    if (!draft || !doc || docText === null) return;
    const now = new Date().toISOString();
    const lines = viewerRef.current?.locate(draft.start, draft.end);
    let newId = "";
    updateNotes((f) => {
      newId = nextNoteId(f.notes);
      return {
        ...f,
        notes: [
          ...f.notes,
          { id: newId, comment, createdAt: now, updatedAt: now, anchor: createAnchor(docText, draft.start, draft.end, doc.sha256, lines) },
        ],
      };
    });
    setDraft(null);
    setActiveId(newId);
  };

  const updateComment = (id: string, comment: string) =>
    updateNotes((f) => ({
      ...f,
      notes: f.notes.map((n) => (n.id === id && n.comment !== comment ? { ...n, comment, updatedAt: new Date().toISOString() } : n)),
    }));

  const deleteNote = (id: string) => {
    updateNotes((f) => ({ ...f, notes: f.notes.filter((n) => n.id !== id) }));
    if (activeId === id) setActiveId(null);
  };

  const jumpTo = (id: string) => {
    const v = views.find((x) => x.note.id === id);
    if (!v || v.status === "orphaned") return;
    setActiveId(id);
    setFocusTick((t) => t + 1);
    viewerRef.current?.scrollToRange(v.start, v.end);
  };

  const reattach = (id: string) => {
    if (!selection || !doc || docText === null) return;
    const anchor = createAnchor(docText, selection.start, selection.end, doc.sha256, viewerRef.current?.locate(selection.start, selection.end));
    updateNotes((f) => ({
      ...f,
      notes: f.notes.map((n) => (n.id === id ? { ...n, anchor, updatedAt: new Date().toISOString() } : n)),
    }));
    window.getSelection()?.removeAllRanges();
    setActiveId(id);
  };

  /** 自動追従・推定した位置を現在の版のアンカーとして確定する */
  const confirmReanchor = () => {
    if (!doc || docText === null) return;
    const byId = new Map(views.map((v) => [v.note.id, v]));
    updateNotes((f) => ({
      ...f,
      notes: f.notes.map((n) => {
        const v = byId.get(n.id);
        if (!v || v.status === "orphaned" || (!v.stale && v.status === "ok")) return n;
        return { ...n, anchor: createAnchor(docText, v.start, v.end, doc.sha256, viewerRef.current?.locate(v.start, v.end)) };
      }),
    }));
  };

  const onClickOffset = (off: number) => {
    let best: NoteView | null = null;
    for (const v of views as NoteView[]) {
      if (v.status === "orphaned" || off < v.start || off >= v.end) continue;
      if (!best || v.end - v.start < best.end - best.start) best = v;
    }
    setActiveId(best?.note.id ?? null);
    if (best) setFocusTick((t) => t + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "m") {
        e.preventDefault();
        startDraft();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startDraft]);

  const pickFolder = async () => {
    const r = await api.pickFolder();
    if (r) await openFolder(r);
  };

  // ---------- 描画 ----------

  const SAVE_LABEL: Record<SaveState, string> = {
    none: "NOTES: ---",
    pending: "NOTES: *未保存",
    saving: "NOTES: 保存中...",
    saved: "NOTES: 保存済",
    error: "NOTES: ERR",
  };

  if (!root) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-[56ch]">
          <pre className="text-bright">{"shiryo-memo v0.1.0\n------------------"}</pre>
          <p className="mt-2 text-dim">資料を変更せず、別ファイル (.notes.json) にメモを残します。</p>
          <p className="mt-4">
            <span className="text-dim">&gt; </span>
            <button onClick={pickFolder} className="btn">
              資料フォルダを開く
            </button>
            <span className="ml-1 animate-pulse">_</span>
          </p>
          {error && <p className="mt-2 text-bright">[!] {error}</p>}
        </div>
      </div>
    );
  }

  const rootName = root.split(/[\\/]/).filter(Boolean).pop();
  const docAbsPath = currentPath ? `${root.replace(/[\\/]+$/, "")}/${currentPath}` : "";

  return (
    <div className="flex h-full flex-col">
      {/* ヘッダー */}
      <header className="flex items-center gap-2 border-b border-line bg-panel px-2 py-1">
        <button onClick={() => setTreeOpen((o) => !o)} className={`btn ${treeOpen ? "on" : ""}`} title="ファイル一覧の表示切替">
          TREE
        </button>
        <button onClick={pickFolder} className="btn" title={root}>
          {rootName}/
        </button>
        <span className="truncate text-bright">{currentPath ?? "--"}</span>
        {currentPath && (
          <span
            className={`ml-auto shrink-0 ${saveState === "error" || saveState === "pending" ? "text-bright" : "text-dim"}`}
            title={saveError ?? (notesFile ? `${currentPath}${NOTES_SUFFIX}` : "最初のノートを追加すると作成されます")}
          >
            {SAVE_LABEL[saveState]}
          </span>
        )}
      </header>

      {(error || notesError || saveError) && (
        <div className="border-b border-line px-3 py-1 text-bright">[!] {error ?? notesError ?? saveError}</div>
      )}
      {staleSummary.total > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-1">
          <span>
            <span className="text-bright">[W]</span> 資料がノート作成後に更新されています: {staleSummary.total}件
            {staleSummary.moved > 0 && ` / 自動追従 ${staleSummary.moved}`}
            {staleSummary.fuzzy > 0 && ` / 引用文変更 ${staleSummary.fuzzy}`}
            {staleSummary.orphaned > 0 && ` / 該当なし ${staleSummary.orphaned}`}
          </span>
          {staleSummary.total > staleSummary.orphaned && (
            <button onClick={confirmReanchor} disabled={!canEdit} className="btn">
              現在の版で確定
            </button>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {treeOpen && (
          <aside className="w-60 shrink-0 overflow-auto border-r border-line">
            <FileTree docs={docs} current={currentPath} onOpen={(p) => void openDoc(p)} />
          </aside>
        )}

        <main className="min-w-0 flex-1">
          {doc && currentPath ? (
            <Viewer
              ref={viewerRef}
              doc={doc}
              docAbsPath={docAbsPath}
              highlights={highlights}
              activeId={activeId}
              pending={draft}
              onTextReady={setDocText}
              onSelectionChange={setSelection}
              onAddNote={startDraft}
              onClickOffset={onClickOffset}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-dim">-- 左の一覧から資料を選択 --</div>
          )}
        </main>

        <aside className="w-[46ch] shrink-0 border-l border-line">
          {currentPath && (
            <NotesPanel
              items={sortedViews}
              activeId={activeId}
              focusTick={focusTick}
              draft={draft}
              hasSelection={!!selection && canEdit}
              sortMode={sortMode}
              onSortMode={setSortMode}
              onAddFromSelection={startDraft}
              onDraftSave={saveDraft}
              onDraftCancel={() => setDraft(null)}
              onUpdate={updateComment}
              onDelete={deleteNote}
              onJump={jumpTo}
              onReattach={reattach}
            />
          )}
        </aside>
      </div>

      {/* フッター */}
      <footer className="truncate border-t border-line bg-panel px-2 py-0.5 text-dim">
        {selection
          ? `SEL ${selection.start}-${selection.end} "${selection.quote.length > 40 ? selection.quote.slice(0, 40) + "..." : selection.quote}"  |  Ctrl+M: ノート追加`
          : "テキスト選択 -> Ctrl+M: ノート追加  |  ハイライトをクリック: ノートへ移動"}
      </footer>
    </div>
  );
}
