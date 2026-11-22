import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileTree } from "./components/FileTree";
import { OrphanNotes } from "./components/OrphanNotes";
import { NotesPanel, type NoteFilter, type NoteTarget, type SortMode } from "./components/NotesPanel";
import { SheetViewer, type CellSelection, type SheetViewerHandle } from "./components/SheetViewer";
import { Viewer, type TextSelection, type ViewerHandle } from "./components/Viewer";
import { usePaneLayout, PANE_MIN } from "./hooks/usePaneLayout";
import type { SaveState } from "./hooks/useNotesStore";
import { useWorkspace } from "./hooks/useWorkspace";
import { createAnchor } from "./lib/anchor";
import { fieldsOf, fieldsPatch, hasTask, sameFields, type NoteFields } from "./lib/noteMeta";
import {
  buildNoteViews,
  cellHighlights as toCellHighlights,
  countByFilter,
  filterNoteViews,
  matchesFilter,
  sortNoteViews,
  summarizeStale,
  textHighlights,
} from "./lib/noteViews";
import { type Anchor, nextNoteId, NOTES_SUFFIX } from "./lib/notesFile";
import { createCellAnchor, formatRef } from "./lib/sheet";

/** 資料上の選択（Markdown・Word: テキスト範囲 / Excel: セル範囲） */
type DocSelection = ({ kind: "text" } & TextSelection) | ({ kind: "cell" } & CellSelection);

const SAVE_LABEL: Record<SaveState, string> = {
  none: "NOTES: ---",
  pending: "NOTES: *未保存",
  saving: "NOTES: 保存中...",
  saved: "NOTES: 保存済",
  error: "NOTES: ERR",
};

export default function App() {
  const [selection, setSelection] = useState<DocSelection | null>(null);
  const [draft, setDraft] = useState<DocSelection | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [sortMode, setSortMode] = useState<SortMode>("position");
  const [filter, setFilter] = useState<NoteFilter>("all");
  const [treeOpen, setTreeOpen] = useState(true);
  const { layout, toggleLayout, paneSize, splitRef, startResize } = usePaneLayout();

  const viewerRef = useRef<ViewerHandle>(null);
  const sheetRef = useRef<SheetViewerHandle>(null);

  const {
    root,
    docs,
    orphans,
    currentPath,
    doc,
    docText,
    slides,
    error,
    configError,
    notice,
    dismissNotice,
    relinkNotes,
    notes,
    openDoc,
    pickFolder,
    onTextReady,
  } = useWorkspace({
    onBeforeOpen: () => {
      setDraft(null);
      setActiveId(null);
      setSelection(null);
    },
  });
  const { notesFile, notesError, saveState, saveError, conflictNotice, updateNotes } = notes;

  // ---------- アンカー解決 ----------

  const views = useMemo(
    () => buildNoteViews(notesFile, doc, docText, slides, (s, e) => viewerRef.current?.locate(s, e) ?? {}),
    [notesFile, docText, doc, slides],
  );
  const sortedViews = useMemo(() => sortNoteViews(filterNoteViews(views, filter), sortMode), [views, filter, sortMode]);
  const filterCounts = useMemo(() => countByFilter(views), [views]);
  const highlights = useMemo(() => textHighlights(views), [views]);
  const cellHighlights = useMemo(() => toCellHighlights(views), [views]);
  const staleSummary = useMemo(() => summarizeStale(views), [views]);

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

  const saveDraft = (fields: NoteFields) => {
    if (!draft) return;
    const anchor = makeAnchor(draft);
    if (!anchor) return;
    const now = new Date().toISOString();
    let newId = "";
    updateNotes((f) => {
      newId = nextNoteId(f.notes, f.invalid);
      return { ...f, notes: [...f.notes, { id: newId, ...fieldsPatch(fields), createdAt: now, updatedAt: now, anchor }] };
    });
    setDraft(null);
    setActiveId(newId);
    // 追加したノートが絞り込みで隠れないようにする
    if (!matchesFilter(fieldsPatch(fields), filter)) setFilter("all");
  };

  const updateFields = (id: string, fields: NoteFields) =>
    updateNotes((f) => ({
      ...f,
      notes: f.notes.map((n) =>
        n.id === id && !sameFields(fieldsOf(n), fields) ? { ...n, ...fieldsPatch(fields), updatedAt: new Date().toISOString() } : n,
      ),
    }));

  /** 宿題の完了・質問の回答済みを切り替える */
  const toggleDone = (id: string) =>
    updateNotes((f) => ({
      ...f,
      notes: f.notes.map((n) => {
        if (n.id !== id || !n.kind || !hasTask(n.kind)) return n;
        return { ...n, ...fieldsPatch({ ...fieldsOf(n), done: !n.done }), updatedAt: new Date().toISOString() };
      }),
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

  // ---------- 描画 ----------

  if (!root) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-[56ch]">
          <pre className="text-bright">{"document-memo-kakikomi v0.1.0\n------------------"}</pre>
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
      {notice && (
        <div className="flex items-start gap-2 border-b border-line px-3 py-1">
          <span className="min-w-0 flex-1">[i] {notice}</span>
          <button onClick={dismissNotice} className="btn shrink-0">
            閉じる
          </button>
        </div>
      )}
      {conflictNotice && (
        <div className="flex items-start gap-2 border-b border-line px-3 py-1 text-bright">
          <span className="min-w-0 flex-1">[!] {conflictNotice}</span>
          <button onClick={notes.dismissConflict} className="btn shrink-0">
            閉じる
          </button>
        </div>
      )}
      {notesFile && notesFile.invalid.length > 0 && (
        <div className="border-b border-line px-3 py-1">
          <span className="text-bright">[W]</span> {currentPath}
          {NOTES_SUFFIX} に形式が不正なノートが {notesFile.invalid.length}件あり、表示していません（ファイルにはそのまま残します）
        </div>
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
            <OrphanNotes orphans={orphans} docs={docs} onRelink={relinkNotes} />
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
                onTextReady={onTextReady}
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
                ? { width: paneSize, maxWidth: `calc(100% - ${PANE_MIN}px)` }
                : { height: paneSize, maxHeight: `calc(100% - ${PANE_MIN}px)` }
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
                filter={filter}
                onFilter={setFilter}
                counts={filterCounts}
                onAddFromSelection={startDraft}
                onDraftSave={saveDraft}
                onDraftCancel={() => setDraft(null)}
                onUpdate={updateFields}
                onToggleDone={toggleDone}
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
