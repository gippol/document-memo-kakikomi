import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileTree } from "./components/FileTree";
import { MinutesDialog } from "./components/MinutesDialog";
import { OrphanNotes } from "./components/OrphanNotes";
import { NotesPanel, type NoteFilter, type NoteTarget, type SortMode } from "./components/NotesPanel";
import { FolderBoard, type BoardTab, type PickSupersede } from "./components/FolderBoard";
import { SheetViewer, type CellSelection, type SheetViewerHandle } from "./components/SheetViewer";
import { Viewer, type TextSelection, type ViewerHandle } from "./components/Viewer";
import { usePaneLayout, PANE_MIN } from "./hooks/usePaneLayout";
import type { SaveState } from "./hooks/useNotesStore";
import { useFolderNotes } from "./hooks/useFolderNotes";
import { useWorkspace } from "./hooks/useWorkspace";
import { api, errMsg, NOTES_CONFLICT } from "./lib/api";
import { collectBoard, dueAlertMessage, dueAlert, setNoteDone, type BoardItem, type FolderNote } from "./lib/board";
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
import { type Anchor, nextNoteId, NOTES_SUFFIX, parseNotesFile, serializeNotesFile } from "./lib/notesFile";
import { createPlaceAnchor, placeOptions, type PlaceOption } from "./lib/place";
import { createCellAnchor, formatRef } from "./lib/sheet";
import { supersedesOf } from "./lib/supersede";
import { lastDeletedIndex, pushDeleted, removeNote, restoreNote, type DeletedNote } from "./lib/undo";

/** 資料上の選択（Markdown・Word: テキスト範囲 / Excel: セル範囲） */
type DocSelection = ({ kind: "text" } & TextSelection) | ({ kind: "cell" } & CellSelection);

/** 書きかけのノート。選択範囲に付けるか、全体メモ（付け先の選択肢つき） */
type Draft = DocSelection | { kind: "place"; quote: ""; places: PlaceOption[] };

/** 削除の取り消しのお知らせを出しておく時間（Ctrl+Z はその後も効く） */
const UNDO_TOAST_MS = 10_000;

/** 文字を入力している欄か（そこでの Ctrl+Z は入力の取り消しに使う） */
const isTextInput = (t: EventTarget | null) =>
  t instanceof HTMLElement && !!t.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']");

/** お知らせに出すノートの名前（コメントの 1 行目か、付けた文言） */
function noteLabel(n: { comment: string; anchor: { quote: string } }): string {
  const first = n.comment.trim().split(/\r?\n/)[0];
  const s = (first || n.anchor.quote || "（コメントなし）").replace(/\s+/g, " ");
  return s.length > 40 ? s.slice(0, 40) + "…" : s;
}

const SAVE_LABEL: Record<SaveState, string> = {
  none: "NOTES: ---",
  pending: "NOTES: *未保存",
  saving: "NOTES: 保存中...",
  saved: "NOTES: 保存済",
  error: "NOTES: ERR",
};

export default function App() {
  const [selection, setSelection] = useState<DocSelection | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [sortMode, setSortMode] = useState<SortMode>("position");
  const [filter, setFilter] = useState<NoteFilter>("all");
  const [minutesOpen, setMinutesOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [boardTab, setBoardTab] = useState<BoardTab>("tasks");
  /** フォルダを開いたときの期限前の通知（閉じたら null） */
  const [dueNotice, setDueNotice] = useState<string | null>(null);
  /** 置き換え元を選んでいる決定（開いている資料のノート ID） */
  const [supersedeFor, setSupersedeFor] = useState<string | null>(null);
  /** ボードで選んだノート。資料を開いて描画し終えたら該当箇所へ移動する */
  const [pendingJump, setPendingJump] = useState<{ path: string; id: string } | null>(null);
  /** 削除の取り消し用の履歴（新しいものが末尾。資料ごとに最後のものから戻す） */
  const [deleted, setDeleted] = useState<DeletedNote[]>([]);
  /** 「削除しました [元に戻す]」を出しているノートの ID */
  const [undoToast, setUndoToast] = useState<string | null>(null);
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
    pages,
    headings,
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
      setPendingJump(null);
      setUndoToast(null);
      setSupersedeFor(null);
    },
  });
  const { notesFile, notesError, saveState, saveError, conflictNotice, updateNotes } = notes;
  const folderNotes = useFolderNotes(root, boardOpen || supersedeFor !== null, currentPath, notesFile);

  // ---------- アンカー解決 ----------

  const views = useMemo(
    () => buildNoteViews(notesFile, doc, docText, slides, pages, headings, (s, e) => viewerRef.current?.locate(s, e) ?? {}),
    [notesFile, docText, doc, slides, pages, headings],
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
    if (!doc || t.kind === "point" || t.kind === "sheet") return null;
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

  /** 全体メモを書き始める。付け先は資料全体か、いま見ている場所（スライド・シート・見出しの節） */
  const startPlaceDraft = useCallback(() => {
    if (!doc || !canEdit) return;
    const sheet = doc.kind === "xlsx" ? sheetRef.current?.currentSheet() : null;
    const here: PlaceOption | null = sheet ? { scope: "sheet", sheet } : (viewerRef.current?.currentPlace() ?? null);
    setDraft({ kind: "place", quote: "", places: placeOptions(here) });
    setActiveId(null);
    clearSelection();
  }, [doc, canEdit]);

  const saveDraft = (fields: NoteFields, place?: PlaceOption) => {
    if (!draft || !doc) return;
    const anchor = draft.kind === "place" ? createPlaceAnchor(place ?? { scope: "doc" }, doc.sha256) : makeAnchor(draft);
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
        n.id === id && !sameFields(fieldsOf(n), fields)
          ? {
              ...n,
              ...fieldsPatch(fields),
              // 置き換えのリンクは決定のときだけ持つ
              supersedes: fields.kind === "decision" ? n.supersedes : undefined,
              updatedAt: new Date().toISOString(),
            }
          : n,
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
    if (!currentPath) return;
    const out: { deleted: DeletedNote | null } = { deleted: null };
    updateNotes((f) => {
      const r = removeNote(f, id, currentPath);
      out.deleted = r.deleted;
      return r.file;
    });
    if (out.deleted) {
      const d = out.deleted;
      setDeleted((list) => pushDeleted(list, d));
      setUndoToast(id);
    }
    if (activeId === id) setActiveId(null);
  };

  /** この資料で最後に削除したノートを元の位置に戻す */
  const undoDelete = useCallback(() => {
    const i = lastDeletedIndex(deleted, currentPath);
    if (i < 0 || !canEdit) return;
    const d = deleted[i];
    updateNotes((f) => restoreNote(f, d));
    setDeleted((list) => list.filter((x) => x !== d));
    setUndoToast(null);
    setActiveId(d.note.id);
    setFocusTick((n) => n + 1);
    if (!matchesFilter(d.note, filter)) setFilter("all");
  }, [deleted, currentPath, canEdit, updateNotes, filter]);

  // フォルダを開き直したら履歴を捨てる
  useEffect(() => setDeleted([]), [root]);

  useEffect(() => {
    if (!undoToast) return;
    const t = setTimeout(() => setUndoToast(null), UNDO_TOAST_MS);
    return () => clearTimeout(t);
  }, [undoToast]);

  const lastDeleted = deleted[lastDeletedIndex(deleted, currentPath)];
  const undoInfo = undoToast && lastDeleted?.note.id === undoToast ? { label: noteLabel(lastDeleted.note) } : null;

  const jumpTo = (id: string) => {
    const t = views.find((x) => x.note.id === id)?.target;
    if (!t) return;
    setActiveId(id);
    setFocusTick((n) => n + 1);
    if (t.kind === "text") viewerRef.current?.scrollToRange(t.start, t.end);
    else if (t.kind === "point") viewerRef.current?.scrollToRange(t.start, t.start + 1);
    else if (t.kind === "sheet") sheetRef.current?.scrollToRange(t.sheet, { r1: 0, c1: 0, r2: 0, c2: 0 });
    else sheetRef.current?.scrollToRange(t.sheet, t.range);
  };

  /**
   * ボードから宿題を完了・質問を回答済みにする。
   * 開いている資料はメモリ上のノートを変える（自動保存）。ほかの資料はノートファイルを読み直して、そのノートだけ変えて書き込む
   * （読んでから書くまでに外部で変更されていたら書き込まない）
   */
  const setDoneFromBoard = async (item: BoardItem, done: boolean): Promise<string | null> => {
    const now = new Date().toISOString();
    if (item.docPath === currentPath) {
      if (!canEdit) return "この資料のノートは今は編集できません";
      updateNotes((f) => setNoteDone(f, item.note.id, done, now).file);
      return null;
    }
    if (!root) return null;
    try {
      const json = await api.readNotes(root, item.docPath);
      if (json === null) return `${item.docPath}${NOTES_SUFFIX} が見つかりません`;
      const r = setNoteDone(parseNotesFile(json, item.docPath), item.note.id, done, now);
      if (!r.found) return "ノートが見つかりません（外部で変更・削除された可能性があります）";
      await api.writeNotes(root, item.docPath, serializeNotesFile(r.file), json);
      return null;
    } catch (e) {
      return e === NOTES_CONFLICT ? "保存する直前にノートファイルが外部で変更されました。もう一度お試しください" : errMsg(e);
    } finally {
      void folderNotes.reload();
    }
  };

  // フォルダを開いたら、期限切れ・今日・明日が期限の宿題・質問を知らせる
  useEffect(() => {
    setDueNotice(null);
    if (!root) return;
    let alive = true;
    api
      .listAllNotes(root)
      .then((entries) => {
        if (alive) setDueNotice(dueAlertMessage(dueAlert(collectBoard(entries, null).items, new Date())));
      })
      .catch(() => {
        /* 通知だけなので、読めなくても何もしない */
      });
    return () => {
      alive = false;
    };
  }, [root]);

  /** ボードの項目を押したとき: その資料を開き、描画し終えてから該当箇所へ移動する（下の effect） */
  const jumpFromBoard = async (item: FolderNote) => {
    setBoardOpen(false);
    if (item.docPath !== currentPath) await openDoc(item.docPath);
    setPendingJump({ path: item.docPath, id: item.note.id });
  };

  useEffect(() => {
    if (!pendingJump || pendingJump.path !== currentPath || !doc) return;
    // 表示テキストができるまではアンカーを解決できない
    if (doc.kind !== "xlsx" && docText === null) return;
    setPendingJump(null);
    const v = views.find((x) => x.note.id === pendingJump.id);
    if (!v) return;
    // 絞り込みで隠れていたら全部表示に戻す
    if (!matchesFilter(v.note, filter)) setFilter("all");
    if (v.target) jumpTo(v.note.id);
    else {
      // 資料から見つからないノートは、一覧で選ぶだけ
      setActiveId(v.note.id);
      setFocusTick((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJump, currentPath, doc, docText, views]);

  /** 決定の置き換え元を設定する / 外す（開いている資料のノートだけを書き換える） */
  const setSupersedes = (id: string, target: FolderNote | null) => {
    if (!currentPath) return;
    const link = target ? supersedesOf(target, currentPath) : undefined;
    updateNotes((f) => ({
      ...f,
      notes: f.notes.map((n) => (n.id === id && n.kind === "decision" ? { ...n, supersedes: link, updatedAt: new Date().toISOString() } : n)),
    }));
  };

  const supersedeNote = supersedeFor ? notesFile?.notes.find((n) => n.id === supersedeFor) : undefined;
  const pick: PickSupersede | undefined =
    supersedeFor && currentPath && supersedeNote
      ? {
          docPath: currentPath,
          noteId: supersedeFor,
          label: noteLabel(supersedeNote),
          onPick: (target) => {
            setSupersedes(supersedeFor, target);
            setSupersedeFor(null);
            setActiveId(supersedeFor);
            setFocusTick((n) => n + 1);
          },
        }
      : undefined;

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
      if (minutesOpen || boardOpen || supersedeFor) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z") {
        // 入力欄では入力の取り消し。戻せる削除が無ければ何もしない
        if (isTextInput(e.target) || lastDeletedIndex(deleted, currentPath) < 0) return;
        e.preventDefault();
        undoDelete();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "m") {
        e.preventDefault();
        if (e.shiftKey) startPlaceDraft();
        else startDraft();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startDraft, startPlaceDraft, minutesOpen, boardOpen, supersedeFor, undoDelete, deleted, currentPath]);

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
        <button onClick={() => setBoardOpen(true)} className="btn" title="フォルダ全体の未完了の宿題・質問と、決定事項の台帳">
          BOARD
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
      {dueNotice && (
        <div className="flex items-center gap-2 border-b border-line px-3 py-1">
          <span className="min-w-0 flex-1">
            <span className="text-accent">[!]</span> {dueNotice}
          </span>
          <button
            onClick={() => {
              setBoardTab("tasks");
              setBoardOpen(true);
              setDueNotice(null);
            }}
            className="btn shrink-0"
          >
            BOARD で見る
          </button>
          <button onClick={() => setDueNotice(null)} className="btn shrink-0">
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
                key={currentPath}
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
                onExportMinutes={() => setMinutesOpen(true)}
                onAddFromSelection={startDraft}
                onAddPlace={startPlaceDraft}
                canAddPlace={canEdit}
                onDraftSave={saveDraft}
                onDraftCancel={() => setDraft(null)}
                onUpdate={updateFields}
                onToggleDone={toggleDone}
                onDelete={deleteNote}
                onJump={jumpTo}
                onReattach={reattach}
                undo={undoInfo}
                onUndo={undoDelete}
                onDismissUndo={() => setUndoToast(null)}
                onPickSupersede={(id) => canEdit && setSupersedeFor(id)}
                onClearSupersede={(id) => setSupersedes(id, null)}
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
            ? "セルをクリック・ドラッグで選択 (Shift+クリックで拡張 / 行・列番号で行・列全体) -> Ctrl+M: ノート追加  |  Ctrl+Shift+M: 全体メモ  |  Ctrl+C: コピー"
            : "テキスト選択 -> Ctrl+M: ノート追加  |  Ctrl+Shift+M: 全体メモ  |  ハイライトをクリック: ノートへ移動"}
      </footer>

      {pick && (
        <FolderBoard
          tab="decisions"
          onTab={() => {}}
          board={folderNotes.board}
          decisions={folderNotes.decisions}
          error={folderNotes.error}
          onJump={(i) => void jumpFromBoard(i)}
          onSetDone={setDoneFromBoard}
          onClose={() => setSupersedeFor(null)}
          pick={pick}
        />
      )}

      {boardOpen && root && (
        <FolderBoard
          tab={boardTab}
          onTab={setBoardTab}
          board={folderNotes.board}
          decisions={folderNotes.decisions}
          error={folderNotes.error}
          onJump={(i) => void jumpFromBoard(i)}
          onSetDone={setDoneFromBoard}
          onClose={() => setBoardOpen(false)}
        />
      )}

      {minutesOpen && root && currentPath && (
        <MinutesDialog root={root} docPath={currentPath} views={views} onClose={() => setMinutesOpen(false)} />
      )}
    </div>
  );
}
