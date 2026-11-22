import { describe, expect, it } from "vitest";
import { createAnchor } from "./anchor";
import type { LoadedDoc } from "./document";
import type { Note, NotesFile } from "./notesFile";
import { buildNoteViews, cellHighlights, countByFilter, filterNoteViews, sortNoteViews, summarizeStale, textHighlights } from "./noteViews";

const OLD = "前置き。ここが重要な仕様です。後書き。";
const NEW = "追記した段落。前置き。ここが重要な仕様です。後書き。";

const md = (content: string, sha256: string): LoadedDoc => ({ kind: "markdown", content, sha256, encoding: "UTF-8" });

function note(id: string, text: string, quote: string, sha: string, createdAt = "2026-11-15T00:00:00.000Z"): Note {
  const start = text.indexOf(quote);
  return {
    id,
    comment: id,
    createdAt,
    updatedAt: createdAt,
    anchor: createAnchor(text, start, start + quote.length, sha, { lineStart: 3, lineEnd: 3 }),
  };
}

const file = (notes: Note[]): NotesFile => ({ version: 1, source: { file: "a.md" }, notes, invalid: [] });
const locate = () => ({ lineStart: 99, lineEnd: 99 });

describe("buildNoteViews", () => {
  it("資料・ノートが無ければ空", () => {
    expect(buildNoteViews(null, md(OLD, "v1"), OLD, [], locate)).toEqual([]);
    expect(buildNoteViews(file([]), null, null, [], locate)).toEqual([]);
  });

  it("同じ版で位置が変わらなければ記録した行番号を使う", () => {
    const [v] = buildNoteViews(file([note("a", OLD, "重要な仕様", "v1")]), md(OLD, "v1"), OLD, [], locate);
    expect(v).toMatchObject({ status: "ok", stale: false, lineStart: 3, target: { kind: "text", start: OLD.indexOf("重要な仕様") } });
  });

  it("位置がずれていれば今の資料で位置情報を求め直す", () => {
    const [v] = buildNoteViews(file([note("a", OLD, "重要な仕様", "v1")]), md(NEW, "v2"), NEW, [], locate);
    expect(v).toMatchObject({ status: "moved", stale: true, lineStart: 99, sortKey: NEW.indexOf("重要な仕様") });
  });

  it("見つからないノート・種類の合わないノートは orphaned", () => {
    const gone = note("a", OLD, "重要な仕様", "v1");
    const cell: Note = {
      ...gone,
      id: "c",
      anchor: { type: "cell", sheet: "S", ref: "A1", quote: "x", values: [["x"]], sourceSha256: "v1" },
    };
    const views = buildNoteViews(file([gone, cell]), md("まったく別の内容", "v2"), "まったく別の内容", [], locate);
    expect(views.map((v) => [v.status, v.target, v.sortKey])).toEqual([
      ["orphaned", null, Infinity],
      ["orphaned", null, Infinity],
    ]);
  });

  it("表示テキストがまだ無いうちは orphaned 扱い", () => {
    const [v] = buildNoteViews(file([note("a", OLD, "重要な仕様", "v1")]), md(OLD, "v1"), null, [], locate);
    expect(v.status).toBe("orphaned");
  });
});

describe("並べ替え・集計", () => {
  const views = buildNoteViews(
    file([
      note("late", OLD, "後書き", "v1", "2026-11-16T00:00:00.000Z"),
      note("early", OLD, "前置き", "v1", "2026-11-14T00:00:00.000Z"),
      { ...note("lost", OLD, "重要な仕様", "v1"), anchor: createAnchor("存在しない", 0, 5, "v1") },
    ]),
    md(OLD, "v1"),
    OLD,
    [],
    locate,
  );

  it("位置順では見つからないものを末尾にする", () => {
    expect(sortNoteViews(views, "position").map((v) => v.note.id)).toEqual(["early", "late", "lost"]);
  });

  it("時系列では新しい順", () => {
    expect(sortNoteViews(views, "timeline").map((v) => v.note.id)).toEqual(["late", "lost", "early"]);
  });

  it("テキストのハイライトは位置のあるノートだけ", () => {
    expect(textHighlights(views).map((h) => h.id)).toEqual(["late", "early"]);
    expect(cellHighlights(views)).toEqual([]);
  });

  it("資料の更新で影響を受けたノートを数える", () => {
    expect(summarizeStale(views)).toEqual({ total: 1, moved: 0, fuzzy: 0, orphaned: 1 });
  });
});

describe("種類での絞り込み", () => {
  const notes: Note[] = [
    note("m", OLD, "前置き", "v1"),
    { ...note("d", OLD, "重要", "v1"), kind: "decision" },
    { ...note("a1", OLD, "仕様", "v1"), kind: "action" },
    { ...note("a2", OLD, "後書き", "v1"), kind: "action", done: true },
    { ...note("q", OLD, "ここ", "v1"), kind: "question" },
  ];
  const views = buildNoteViews(file(notes), md(OLD, "v1"), OLD, [], locate);
  const ids = (f: Parameters<typeof filterNoteViews>[1]) => filterNoteViews(views, f).map((v) => v.note.id);

  it("種類ごと・未完了（宿題と質問）で絞り込む", () => {
    expect(ids("all")).toEqual(["m", "d", "a1", "a2", "q"]);
    expect(ids("memo")).toEqual(["m"]);
    expect(ids("action")).toEqual(["a1", "a2"]);
    expect(ids("open")).toEqual(["a1", "q"]);
  });

  it("件数", () => {
    expect(countByFilter(views)).toEqual({ all: 5, open: 2, memo: 1, decision: 1, action: 2, question: 1 });
  });
});
