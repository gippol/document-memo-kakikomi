import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { FileTree } from "./components/FileTree";
import { NotesPanel, type NoteTarget, type NoteView, type SortMode } from "./components/NotesPanel";
import { SheetViewer, type CellHighlight, type CellSelection, type SheetViewerHandle } from "./components/SheetViewer";
import { Viewer, type HighlightSpec, type TextSelection, type ViewerHandle } from "./components/Viewer";
import { createAnchor, resolveAnchor } from "./lib/anchor";
import type { SlideSpan } from "./lib/dom";
import { api, type DocEntry } from "./lib/api";
import { CONFIG_FILE, DEFAULT_CONFIG, parseConfig, type FolderConfig } from "./lib/config";
import { loadDocument, type LoadedDoc } from "./lib/document";
import { createCellAnchor, formatRef, headerLabel, headersAt, resolveCellAnchor } from "./lib/sheet";
import {
  type Anchor,
  emptyNotesFile,
  nextNoteId,
  NOTES_SUFFIX,
  parseNotesFile,
  serializeNotesFile,
  type NotesFile,
} from "./lib/notesFile";

type SaveState = "none" | "pending" | "saving" | "saved" | "error";

/** 資料上の選択（Markdown・Word: テキスト範囲 / Excel: セル範囲） */
type DocSelection = ({ kind: "text" } & TextSelection) | ({ kind: "cell" } & CellSelection);

interface PendingSave {
  root: string;
  path: string;
  json: string;
}

const LS_ROOT = "shiryo-memo:lastRoot";
const lsDocKey = (root: string) => `shiryo-memo:lastDoc:${root}`;
const SAVE_DELAY = 500;

/** 資料とノートの配置: side = 左右, stack = 上下 */
type Layout = "side" | "stack";
const LS_LAYOUT = "shiryo-memo:layout";
const lsPaneKey = (l: Layout) => `shiryo-memo:notesSize:${l}`;
/** ノート欄の既定サイズ（side: 幅, stack: 高さ, px） */
const PANE_DEFAULT: Record<Layout, number> = { side: 380, stack: 280 };
const PANE_MIN = 160;

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
  /** PowerPoint: 各スライドが表示テキスト上で占める範囲 */
  const [slides, setSlides] = useState<SlideSpan[]>([]);
  const [notesFile, setNotesFile] = useState<NotesFile | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("none");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [selection, setSelection] = useState<DocSelection | null>(null);
  const [draft, setDraft] = useState<DocSelection | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [sortMode, setSortMode] = useState<SortMode>("position");
  const [treeOpen, setTreeOpen] = useState(true);
  const [layout, setLayout] = useState<Layout>(() => (lsGet(LS_LAYOUT) === "stack" ? "stack" : "side"));
  const [paneSize, setPaneSize] = useState<Record<Layout, number>>(() => ({
    side: Number(lsGet(lsPaneKey("side"))) || PANE_DEFAULT.side,
    stack: Number(lsGet(lsPaneKey("stack"))) || PANE_DEFAULT.stack,
  }));
  const splitRef = useRef<HTMLDivElement>(null);

  const toggleLayout = () => {
    const next: Layout = layout === "side" ? "stack" : "side";
    lsSet(LS_LAYOUT, next);
    setLayout(next);
  };

  // 境界線のドラッグでノート欄のサイズを変える
  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = splitRef.current?.getBoundingClientRect();
    if (!box) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const l = layout;
    let size = paneSize[l];
    const onMove = (ev: PointerEvent) => {
      const total = l === "side" ? box.width : box.height;
      const raw = l === "side" ? box.right - ev.clientX : box.bottom - ev.clientY;
      size = Math.round(Math.min(Math.max(raw, PANE_MIN), total - PANE_MIN));
      setPaneSize((p) => ({ ...p, [l]: size }));
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      lsSet(lsPaneKey(l), String(size));
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  const viewerRef = useRef<ViewerHandle>(null);
  const sheetRef = useRef<SheetViewerHandle>(null);
  const rootRef = useRef<string | null>(null);
  const pathRef = useRef<string | null>(null);
  const notesRef = useRef<NotesFile | null>(null);
  const configRef = useRef<FolderConfig>(DEFAULT_CONFIG);
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

  /** フォルダ直下の .shiryo-memo.json を読む。壊れていても既定値で続行する */
  const loadConfig = useCallback(async (r: string) => {
    let next = DEFAULT_CONFIG;
    try {
      const json = await api.readConfig(r);
      if (json !== null) next = parseConfig(json);
      setConfigError(null);
    } catch (e) {
      setConfigError(`設定ファイル ${CONFIG_FILE}: ${errMsg(e)}（既定の設定で表示しています）`);
    }
    configRef.current = next;
  }, []);

  const docOptions = () => ({ docxHeadings: configRef.current.docxHeadings });

  const openDoc = useCallback(
    async (path: string) => {
      const r = rootRef.current;
      if (!r) return;
      await flushSave();
      setDraft(null);
      setActiveId(null);
      setSelection(null);
      try {
        const content = await loadDocument(r, path, docOptions());
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
        // バックエンドにフォルダを登録してから読む（登録したフォルダ以外は読み書きできない）
        await api.openFolder(r);
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
        await loadConfig(r);
        const last = lsGet(lsDocKey(r));
        const initial = list.find((d) => d.path === last) ?? list[0];
        if (initial) await openDoc(initial.path);
      } catch (e) {
        setError(errMsg(e));
      }
    },
    [flushSave, openDoc, loadConfig],
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

    if (paths.some((p) => /\.(md|markdown|docx|pptx|xlsx|xlsm|xls|notes\.json)$/i.test(p) || !/\.[^/]+$/.test(p))) {
      if (treeTimer.current) clearTimeout(treeTimer.current);
      treeTimer.current = setTimeout(() => void refreshDocs(), 300);
    }
    if (!cur) return;

    const configChanged = paths.includes(CONFIG_FILE);
    if (paths.includes(cur) || configChanged) {
      (configChanged ? loadConfig(r) : Promise.resolve())
        .then(() => loadDocument(r, cur, docOptions()))
        .then((c) => {
          if (pathRef.current !== cur) return;
          // 表示内容が同じなら再描画しない（Word は見出し設定の変更でハッシュは同じでも HTML が変わる）
          const view = (d: LoadedDoc) => (d.kind === "markdown" ? d.content : d.kind === "xlsx" ? d.sha256 : d.html);
          setDoc((prev) => (prev && prev.sha256 === c.sha256 && view(prev) === view(c) ? prev : c));
          setError(null);
        })
        .catch((e) => setError(`資料「${cur}」を読み込めません: ${errMsg(e)}（移動・削除された可能性があります）`));
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
    if (!notesFile || !doc) return [];
    return notesFile.notes.map((note): NoteView => {
      const stale = note.anchor.sourceSha256 !== doc.sha256;
      const lost: NoteView = { note, status: "orphaned", stale, target: null, sortKey: Infinity };
      if (note.anchor.type === "cell") {
        if (doc.kind !== "xlsx") return lost;
        const r = resolveCellAnchor(doc.book, note.anchor);
        if (r.status === "orphaned") return lost;
        const idx = doc.book.sheets.findIndex((s) => s.name === r.sheet);
        const sheet = doc.book.sheets[idx];
        return {
          note,
          status: r.status,
          stale,
          target: { kind: "cell", sheet: r.sheet, range: r.range },
          cell: `${r.sheet}!${formatRef(r.range)}`,
          heading: headerLabel(r.status === "ok" ? note.anchor : headersAt(sheet, r.range.r1, r.range.c1)),
          sortKey: idx * 1e8 + r.range.r1 * 1e3 + r.range.c1,
        };
      }
      if (doc.kind === "xlsx" || docText === null) return lost;
      // PowerPoint: 同じ ID のスライド（並べ替えても変わらない）の中を優先して探す
      const sid = note.anchor.slideId;
      const scope = sid !== undefined ? slides.find((s) => s.id === sid) : undefined;
      const r = resolveAnchor(docText, note.anchor, scope);
      const lines =
        r.status === "ok" && !stale
          ? {
              lineStart: note.anchor.lineStart,
              lineEnd: note.anchor.lineEnd,
              paragraph: note.anchor.paragraph,
              heading: note.anchor.heading,
              slide: note.anchor.slide,
              slideId: note.anchor.slideId,
            }
          : r.status === "orphaned"
            ? {}
            : (viewerRef.current?.locate(r.start, r.end) ?? {});
      const target: NoteTarget | null = r.status === "orphaned" ? null : { kind: "text", start: r.start, end: r.end };
      return { note, status: r.status, stale, target, sortKey: r.status === "orphaned" ? Infinity : r.start, ...lines };
    });
  }, [notesFile, docText, doc, slides]);

  const sortedViews = useMemo(() => {
    const arr = [...views];
    if (sortMode === "position") {
      arr.sort((a, b) => {
        const ao = a.status === "orphaned" ? 1 : 0;
        const bo = b.status === "orphaned" ? 1 : 0;
        return ao - bo || a.sortKey - b.sortKey;
      });
    } else {
      arr.sort((a, b) => b.note.createdAt.localeCompare(a.note.createdAt));
    }
    return arr;
  }, [views, sortMode]);

  const highlights: HighlightSpec[] = useMemo(
    () =>
      views.flatMap((v) =>
        v.target?.kind === "text" ? [{ id: v.note.id, start: v.target.start, end: v.target.end, stale: v.status === "fuzzy" }] : [],
      ),
    [views],
  );

  const cellHighlights: CellHighlight[] = useMemo(
    () =>
      views.flatMap((v) =>
        v.target?.kind === "cell" ? [{ id: v.note.id, sheet: v.target.sheet, range: v.target.range, stale: v.status === "fuzzy" }] : [],
      ),
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

  const canEdit = !!doc && (doc.kind === "xlsx" || docText !== null) && !notesError;

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    sheetRef.current?.clearSelection();
  };

  /** 現在の資料の範囲からアンカーを作る */
  const makeAnchor = (t: NoteTarget): Anchor | null => {
    if (!doc) return null;
    if (t.kind === "cell") {
      const sheet = doc.kind === "xlsx" ? doc.book.sheets.find((s) => s.name === t.sheet) : undefined;
      return sheet ? createCellAnchor(sheet, t.range, doc.sha256) : null;
    }
    if (docText === null || doc.kind === "xlsx") return null;
    return createAnchor(docText, t.start, t.end, doc.sha256, viewerRef.current?.locate(t.start, t.end));
  };

  const startDraft = useCallback(() => {
    if (!selection || !canEdit) return;
    setDraft(selection);
    setActiveId(null);
    window.getSelection()?.removeAllRanges();
    sheetRef.current?.clearSelection();
  }, [selection, canEdit]);

  const saveDraft = (comment: string) => {
    if (!draft) return;
    const anchor = makeAnchor(draft);
    if (!anchor) return;
    const now = new Date().toISOString();
    let newId = "";
    updateNotes((f) => {
      newId = nextNoteId(f.notes);
      return { ...f, notes: [...f.notes, { id: newId, comment, createdAt: now, updatedAt: now, anchor }] };
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
    const t = views.find((x) => x.note.id === id)?.target;
    if (!t) return;
    setActiveId(id);
    setFocusTick((n) => n + 1);
    if (t.kind === "text") viewerRef.current?.scrollToRange(t.start, t.end);
    else sheetRef.current?.scrollToRange(t.sheet, t.range);
  };

  const reattach = (id: string) => {
    if (!selection) return;
    const anchor = makeAnchor(selection);
    if (!anchor) return;
    updateNotes((f) => ({
      ...f,
      notes: f.notes.map((n) => (n.id === id ? { ...n, anchor, updatedAt: new Date().toISOString() } : n)),
    }));
    clearSelection();
    setActiveId(id);
  };

  /** 自動追従・推定した位置を現在の版のアンカーとして確定する */
  const confirmReanchor = () => {
    if (!doc) return;
    const byId = new Map(views.map((v) => [v.note.id, v]));
    updateNotes((f) => ({
      ...f,
      notes: f.notes.map((n) => {
        const v = byId.get(n.id);
        if (!v?.target || (!v.stale && v.status === "ok")) return n;
        const anchor = makeAnchor(v.target);
        return anchor ? { ...n, anchor } : n;
      }),
    }));
  };

  /** クリックした位置を含むノートのうち、範囲が最も狭いものをアクティブにする */
  const activateSmallest = (size: (t: NoteTarget) => number | null) => {
    let best: { id: string; n: number } | null = null;
    for (const v of views) {
      const n = v.target ? size(v.target) : null;
      if (n !== null && (!best || n < best.n)) best = { id: v.note.id, n };
    }
    setActiveId(best?.id ?? null);
    if (best) setFocusTick((t) => t + 1);
  };

  const onClickOffset = (off: number) =>
    activateSmallest((t) => (t.kind === "text" && off >= t.start && off < t.end ? t.end - t.start : null));

  const onClickCell = (sheet: string, r: number, c: number) =>
    activateSmallest((t) =>
      t.kind === "cell" && t.sheet === sheet && r >= t.range.r1 && r <= t.range.r2 && c >= t.range.c1 && c <= t.range.c2
        ? (t.range.r2 - t.range.r1 + 1) * (t.range.c2 - t.range.c1 + 1)
        : null,
    );

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
        <button onClick={toggleLayout} className="btn" title="資料とノートの配置を切り替え（左右 / 上下）">
          {layout === "side" ? "左右" : "上下"}
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

      {[error, notesError, saveError, configError]
        .filter((m): m is string => !!m)
        .map((m) => (
          <div key={m} className="border-b border-line px-3 py-1 text-bright">
            [!] {m}
          </div>
        ))}
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

        <div ref={splitRef} className={`flex min-h-0 min-w-0 flex-1 ${layout === "side" ? "flex-row" : "flex-col"}`}>
          <main className="min-h-0 min-w-0 flex-1">
            {doc && currentPath && doc.kind === "xlsx" ? (
              <SheetViewer
                key={currentPath}
                ref={sheetRef}
                book={doc.book}
                warnings={doc.warnings}
                highlights={cellHighlights}
                activeId={activeId}
                pending={draft?.kind === "cell" ? draft : null}
                onSelectionChange={(s) => setSelection(s && { kind: "cell", ...s })}
                onAddNote={startDraft}
                onClickCell={onClickCell}
              />
            ) : doc && currentPath && doc.kind !== "xlsx" ? (
              <Viewer
                ref={viewerRef}
                doc={doc}
                docAbsPath={docAbsPath}
                highlights={highlights}
                activeId={activeId}
                pending={draft?.kind === "text" ? draft : null}
                onTextReady={(text, spans) => {
                  setSlides(spans);
                  setDocText(text);
                }}
                onSelectionChange={(s) => setSelection(s && { kind: "text", ...s })}
                onAddNote={startDraft}
                onClickOffset={onClickOffset}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-dim">-- 左の一覧から資料を選択 --</div>
            )}
          </main>

          <div
            role="separator"
            aria-orientation={layout === "side" ? "vertical" : "horizontal"}
            title="ドラッグでサイズ変更"
            onPointerDown={startResize}
            className={`shrink-0 bg-line hover:bg-accent ${layout === "side" ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize"}`}
          />

          <aside
            className="min-h-0 min-w-0 shrink-0"
            style={
              layout === "side"
                ? { width: paneSize.side, maxWidth: `calc(100% - ${PANE_MIN}px)` }
                : { height: paneSize.stack, maxHeight: `calc(100% - ${PANE_MIN}px)` }
            }
          >
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
      </div>

      {/* フッター */}
      <footer className="truncate border-t border-line bg-panel px-2 py-0.5 text-dim">
        {selection
          ? `SEL ${selection.kind === "cell" ? `${selection.sheet}!${formatRef(selection.range)}` : `${selection.start}-${selection.end}`} "${
              selection.quote.length > 40 ? selection.quote.slice(0, 40) + "..." : selection.quote
            }"  |  Ctrl+M: ノート追加`
          : doc?.kind === "xlsx"
            ? "セルをクリック・ドラッグで選択 (Shift+クリックで拡張 / 行・列番号で行・列全体) -> Ctrl+M: ノート追加  |  Ctrl+C: コピー"
            : "テキスト選択 -> Ctrl+M: ノート追加  |  ハイライトをクリック: ノートへ移動"}
      </footer>
    </div>
  );
}
