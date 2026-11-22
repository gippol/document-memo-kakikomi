import { resolveAnchor, type AnchorLocation } from "./anchor";
import type { LoadedDoc } from "./document";
import type { SlideSpan } from "./dom";
import { isOpen, type NoteKind } from "./noteMeta";
import type { Note, NotesFile } from "./notesFile";
import { formatRef, headerLabel, headersAt, resolveCellAnchor } from "./sheet";
import type { NoteFilter, NoteTarget, NoteView, SortMode } from "../components/NotesPanel";
import type { HighlightSpec } from "../components/Viewer";
import type { CellHighlight } from "../components/SheetViewer";

/** 表示テキスト上の範囲から、資料上の位置（行・段落・スライドなど）を求める */
export type Locate = (start: number, end: number) => AnchorLocation;

/**
 * 現在の資料に対して各ノートの位置を解決し、一覧・ハイライト用の情報を作る。
 * docText は表示テキスト（Markdown・Word・PowerPoint）。描画前は null。
 */
export function buildNoteViews(
  notesFile: NotesFile | null,
  doc: LoadedDoc | null,
  docText: string | null,
  slides: SlideSpan[],
  locate: Locate,
): NoteView[] {
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
    if (r.status === "orphaned") return lost;
    // 位置が変わっていなければ記録した位置情報をそのまま使い、変わっていれば今の資料で求め直す
    const loc: AnchorLocation =
      r.status === "ok" && !stale
        ? {
            lineStart: note.anchor.lineStart,
            lineEnd: note.anchor.lineEnd,
            paragraph: note.anchor.paragraph,
            heading: note.anchor.heading,
            slide: note.anchor.slide,
            slideId: note.anchor.slideId,
          }
        : locate(r.start, r.end);
    const target: NoteTarget = { kind: "text", start: r.start, end: r.end };
    return { note, status: r.status, stale, target, sortKey: r.start, ...loc };
  });
}

/** 一覧の並び順。position: 資料上の位置順（見つからないものは末尾）、timeline: 新しい順 */
export function sortNoteViews(views: NoteView[], mode: SortMode): NoteView[] {
  const arr = [...views];
  if (mode === "position") {
    const lost = (v: NoteView) => (v.status === "orphaned" ? 1 : 0);
    arr.sort((a, b) => lost(a) - lost(b) || a.sortKey - b.sortKey);
  } else {
    arr.sort((a, b) => b.note.createdAt.localeCompare(a.note.createdAt));
  }
  return arr;
}

/** 種類が無いノートはメモ */
export const kindOf = (n: Note): NoteKind => n.kind ?? "memo";

/** 絞り込みに当てはまるノートか。open: 未完了の宿題・未回答の質問 */
export function matchesFilter(note: Pick<Note, "kind" | "done">, filter: NoteFilter): boolean {
  const kind = note.kind ?? "memo";
  if (filter === "all") return true;
  if (filter === "open") return isOpen({ kind, done: note.done });
  return kind === filter;
}

export function filterNoteViews(views: NoteView[], filter: NoteFilter): NoteView[] {
  return filter === "all" ? views : views.filter((v) => matchesFilter(v.note, filter));
}

/** 絞り込みボタンに出す件数 */
export function countByFilter(views: NoteView[]): Record<NoteFilter, number> {
  const c: Record<NoteFilter, number> = { all: views.length, open: 0, memo: 0, decision: 0, action: 0, question: 0 };
  for (const v of views) {
    const kind = kindOf(v.note);
    c[kind]++;
    if (isOpen({ ...v.note, kind })) c.open++;
  }
  return c;
}

export function textHighlights(views: NoteView[]): HighlightSpec[] {
  return views.flatMap((v) =>
    v.target?.kind === "text" ? [{ id: v.note.id, start: v.target.start, end: v.target.end, stale: v.status === "fuzzy" }] : [],
  );
}

export function cellHighlights(views: NoteView[]): CellHighlight[] {
  return views.flatMap((v) =>
    v.target?.kind === "cell" ? [{ id: v.note.id, sheet: v.target.sheet, range: v.target.range, stale: v.status === "fuzzy" }] : [],
  );
}

export interface StaleSummary {
  /** 資料の更新の影響を受けたノートの数 */
  total: number;
  moved: number;
  fuzzy: number;
  orphaned: number;
}

export function summarizeStale(views: NoteView[]): StaleSummary {
  const s: StaleSummary = { total: 0, moved: 0, fuzzy: 0, orphaned: 0 };
  for (const v of views) {
    if (!v.stale && v.status === "ok") continue;
    s.total++;
    if (v.status === "moved") s.moved++;
    if (v.status === "fuzzy") s.fuzzy++;
    if (v.status === "orphaned") s.orphaned++;
  }
  return s;
}
