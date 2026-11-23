import { describe, expect, it } from "vitest";
import type { FolderNote, NotesFileEntry } from "./board";
import { collectDecisions, groupLedger, ledgerMarkdown, searchLedger, withoutReplaced } from "./ledger";
import { linkDecisions } from "./supersede";
import { emptyNotesFile, serializeNotesFile, type Note } from "./notesFile";

const TODAY = new Date(2026, 10, 23);

let seq = 0;
function note(n: Partial<Note>): Note {
  seq++;
  return {
    id: `note-${seq}`,
    comment: `ノート${seq}`,
    createdAt: "2026-11-23T01:00:00.000Z",
    updatedAt: "2026-11-23T01:00:00.000Z",
    anchor: { type: "text", quote: "引用", prefix: "", suffix: "", start: 0, end: 2, sourceSha256: "x" },
    ...n,
  };
}

function entry(path: string, notes: Note[]): NotesFileEntry {
  return { path, json: serializeNotesFile({ ...emptyNotesFile(path), notes }), docExists: true };
}

/** ローカル時刻の日時（日付の切れ目がタイムゾーンに左右されないように） */
const at = (d: number, h: number) => new Date(2026, 10, d, h).toISOString();

function item(comment: string, createdAt: string, docPath = "a.md", where: string | null = null, quote = "引用"): FolderNote {
  return { docPath, docExists: true, where, note: note({ kind: "decision", comment, createdAt, anchor: { type: "text", quote, prefix: "", suffix: "", start: 0, end: 1, sourceSha256: "x" } }) };
}

describe("collectDecisions", () => {
  it("決定事項だけを集め、開いている資料はメモリ上のノートを使う", () => {
    const data = collectDecisions(
      [
        entry("a.md", [note({ kind: "decision", comment: "ディスクの決定" })]),
        entry("b.docx", [note({ kind: "decision", comment: "B案で進める" }), note({ kind: "action", comment: "宿題" }), note({ comment: "メモ" })]),
        { path: "broken.md", json: "{", docExists: true },
      ],
      { path: "a.md", file: { ...emptyNotesFile("a.md"), notes: [note({ kind: "decision", comment: "未保存の決定" })] } },
    );
    expect(data.items.map((i) => [i.docPath, i.note.comment])).toEqual([
      ["a.md", "未保存の決定"],
      ["b.docx", "B案で進める"],
    ]);
    expect(data.unreadable).toEqual(["broken.md"]);
  });
});

describe("searchLedger", () => {
  const items = [
    item("予算は案Bで進める", at(20, 10), "定例/第3回.docx", "§ 2. 予算 ¶5"),
    item("リリースは12月第1週", at(21, 10), "報告.pptx", "S3"),
    item("", at(22, 10), "spec.md", "L3", "JWT を採用する"),
  ];
  const found = (q: string) => searchLedger(items, q).map((i) => i.docPath);

  it("内容・付けた文言・資料のパス・位置を、空白区切りのすべての語で探す", () => {
    expect(found("")).toEqual(["定例/第3回.docx", "報告.pptx", "spec.md"]);
    expect(found("予算")).toEqual(["定例/第3回.docx"]);
    expect(found("jwt")).toEqual(["spec.md"]);
    expect(found("第3回")).toEqual(["定例/第3回.docx"]);
    expect(found("S3")).toEqual(["報告.pptx"]);
    expect(found("予算　案Ｂ")).toEqual(["定例/第3回.docx"]);
    expect(found("予算 12月")).toEqual([]);
  });
});

describe("groupLedger", () => {
  const items = [
    item("2日目の朝", at(21, 9)),
    item("1日目", at(20, 15)),
    item("2日目の夕方", at(21, 18)),
  ];

  it("日付ごとにまとめ、新しい順 / 古い順に並べる", () => {
    const view = (order: "newest" | "oldest") => groupLedger(items, order).map((g) => [g.date, g.items.map((i) => i.note.comment)]);
    expect(view("newest")).toEqual([
      ["2026-11-21", ["2日目の夕方", "2日目の朝"]],
      ["2026-11-20", ["1日目"]],
    ]);
    expect(view("oldest")).toEqual([
      ["2026-11-20", ["1日目"]],
      ["2026-11-21", ["2日目の朝", "2日目の夕方"]],
    ]);
  });
});

describe("ledgerMarkdown", () => {
  it("日付ごとの箇条書きにする", () => {
    const items = [item("予算は案Bで進める", at(20, 10), "第3回.docx", "§ 2. 予算 ¶5"), item("", at(21, 10), "spec.md", null, "JWT を採用")];
    expect(ledgerMarkdown(groupLedger(items, "newest"), TODAY, " 予算 ")).toBe(
      [
        "# 決定事項（2026-11-23）",
        "",
        "- 検索: 予算",
        "- 全 2件",
        "",
        "## 2026-11-21",
        "",
        "- 「JWT を採用」（spec.md）",
        "",
        "## 2026-11-20",
        "",
        "- 予算は案Bで進める（第3回.docx § 2. 予算 ¶5）",
        "",
      ].join("\n"),
    );
    expect(ledgerMarkdown([], TODAY)).toContain("（決定事項はありません）");
  });
});

describe("置き換え", () => {
  const old = item("予算は案A", at(13, 10), "会議/第3回.docx", "§ 2. 予算");
  const next: FolderNote = {
    ...item("予算は案Bに変更", at(20, 10), "会議/第4回.docx", "§ 2. 予算"),
  };
  next.note.supersedes = { id: old.note.id, doc: "第3回.docx", text: "予算は案A" };
  const gone = item("期限を延ばす", at(21, 10), "会議/第4回.docx");
  gone.note.supersedes = { id: "note-gone", doc: "../old/第1回.docx", text: "期限は11月末" };
  const items = [old, next, gone];
  const links = linkDecisions(items);

  it("置き換えられた決定は取り消し線にし、経緯を下に添える", () => {
    const md = ledgerMarkdown(groupLedger(items, "oldest"), TODAY, "", links);
    expect(md).toContain(
      [
        "## 2026-11-13",
        "",
        "- ~~予算は案A~~（会議/第3回.docx § 2. 予算）",
        "  - 置き換え先: 予算は案Bに変更（会議/第4回.docx § 2. 予算）",
        "",
        "## 2026-11-20",
        "",
        "- 予算は案Bに変更（会議/第4回.docx § 2. 予算）",
        "  - 置き換え元: 予算は案A（会議/第3回.docx § 2. 予算）",
        "",
        "## 2026-11-21",
        "",
        "- 期限を延ばす（会議/第4回.docx）",
        "  - 置き換え元: 期限は11月末（old/第1回.docx・見つかりません）",
      ].join("\n"),
    );
  });

  it("置き換えられた決定を除ける", () => {
    expect(withoutReplaced(items, links).map((i) => i.note.comment)).toEqual(["予算は案Bに変更", "期限を延ばす"]);
  });
});
