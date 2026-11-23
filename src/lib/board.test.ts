import { describe, expect, it } from "vitest";
import {
  boardMarkdown,
  collectBoard,
  dueAlert,
  dueAlertMessage,
  filterKind,
  setNoteDone,
  endOfWeek,
  filterBoard,
  groupBoard,
  summarizeBoard,
  whereOf,
  type BoardItem,
  type NotesFileEntry,
} from "./board";
import { emptyNotesFile, serializeNotesFile, type Note } from "./notesFile";

// 2026-11-23 は月曜。今週の終わりは 11/29（日）
const TODAY = new Date(2026, 10, 23);

let seq = 0;
function note(n: Partial<Note>): Note {
  seq++;
  return {
    id: `note-${seq}`,
    comment: `ノート${seq}`,
    createdAt: `2026-11-2${seq % 10}T00:00:00.000Z`,
    updatedAt: "2026-11-23T00:00:00.000Z",
    anchor: { type: "text", quote: "引用", prefix: "", suffix: "", start: 0, end: 2, sourceSha256: "x" },
    ...n,
  };
}

function entry(path: string, notes: Note[], docExists = true): NotesFileEntry {
  return { path, json: serializeNotesFile({ ...emptyNotesFile(path), notes }), docExists };
}

function item(n: Partial<Note>, docPath = "a.md"): BoardItem {
  const x = note({ kind: "action", ...n });
  return { docPath, docExists: true, note: x, kind: x.kind as "action" | "question", where: null };
}

describe("collectBoard", () => {
  it("未完了の宿題・未回答の質問だけを集め、読めないファイルは別に返す", () => {
    const data = collectBoard(
      [
        entry("a.md", [
          note({ kind: "action", comment: "宿題" }),
          note({ kind: "action", comment: "済んだ宿題", done: true }),
          note({ kind: "question", comment: "質問" }),
          note({ kind: "decision", comment: "決定" }),
          note({ comment: "メモ" }),
        ]),
        entry("old/gone.docx", [note({ kind: "action", comment: "孤立" })], false),
        { path: "broken.md", json: "{", docExists: true },
        { path: "locked.md", json: null, docExists: true },
      ],
      null,
    );
    expect(data.items.map((i) => [i.docPath, i.note.comment, i.kind, i.docExists])).toEqual([
      ["a.md", "宿題", "action", true],
      ["a.md", "質問", "question", true],
      ["old/gone.docx", "孤立", "action", false],
    ]);
    expect(data.unreadable).toEqual(["broken.md", "locked.md"]);
  });

  it("開いている資料はディスクではなくメモリ上のノートを使う（未保存のファイルも含める）", () => {
    const mem = { ...emptyNotesFile("a.md"), notes: [note({ kind: "action", comment: "未保存の宿題" })] };
    const data = collectBoard([entry("a.md", [note({ kind: "action", comment: "ディスクの宿題" })])], { path: "a.md", file: mem });
    expect(data.items.map((i) => i.note.comment)).toEqual(["未保存の宿題"]);

    const fresh = collectBoard([], { path: "new.md", file: { ...mem, source: { file: "new.md" } } });
    expect(fresh.items.map((i) => [i.docPath, i.note.comment])).toEqual([["new.md", "未保存の宿題"]]);
  });
});

describe("whereOf", () => {
  it("記録してある位置情報から位置を表す", () => {
    const text = (loc: object) => note({ anchor: { type: "text", quote: "q", prefix: "", suffix: "", start: 0, end: 1, sourceSha256: "x", ...loc } });
    expect(whereOf(text({ slide: 3, heading: "課題" }))).toBe("S3");
    expect(whereOf(text({ heading: "2. 予算", paragraph: 5 }))).toBe("§ 2. 予算 ¶5");
    expect(whereOf(text({ lineStart: 4, lineEnd: 6 }))).toBe("L4-6");
    expect(whereOf(text({}))).toBeNull();
    expect(whereOf(note({ anchor: { type: "cell", sheet: "予算", ref: "B3", quote: "", values: [], sourceSha256: "x" } }))).toBe("予算!B3");
    expect(whereOf(note({ anchor: { type: "place", scope: "doc", quote: "", sourceSha256: "x" } }))).toBe("全体");
    expect(whereOf(note({ anchor: { type: "place", scope: "heading", heading: "日程", quote: "日程", sourceSha256: "x" } }))).toBe("§ 日程");
  });
});

describe("集計・絞り込み", () => {
  const items = [
    item({ comment: "期限切れ", assignee: "田中", due: "2026-11-20" }),
    item({ comment: "今日", assignee: "田中", due: "2026-11-23" }),
    item({ comment: "日曜", due: "2026-11-29" }),
    item({ comment: "来週", assignee: "佐藤", due: "2026-11-30" }),
    item({ comment: "期限なし" }),
    item({ kind: "question", comment: "担当なしの質問", due: "2026-11-01" }),
  ];

  it("今週は今日から日曜まで。期限切れは含めず、担当なしは宿題だけ数える", () => {
    expect(endOfWeek(TODAY)).toBe("2026-11-29");
    expect(endOfWeek(new Date(2026, 10, 29))).toBe("2026-11-29");
    expect(summarizeBoard(items, TODAY)).toEqual({ total: 6, overdue: 2, thisWeek: 2, unassigned: 2 });
    expect(filterBoard(items, "thisWeek", TODAY).map((i) => i.note.comment)).toEqual(["今日", "日曜"]);
    expect(filterBoard(items, "unassigned", TODAY).map((i) => i.note.comment)).toEqual(["日曜", "期限なし"]);
    expect(filterBoard(items, "overdue", TODAY).map((i) => i.note.comment)).toEqual(["期限切れ", "担当なしの質問"]);
  });

  it("担当者別: 担当なしを先頭にして目立たせ、中は期限の近い順（期限なしは末尾）", () => {
    const groups = groupBoard(items, "assignee", TODAY);
    expect(groups.map((g) => [g.label, g.warn, g.items.map((i) => i.note.comment)])).toEqual([
      ["担当なし", true, ["担当なしの質問", "日曜", "期限なし"]],
      ["@佐藤", false, ["来週"]],
      ["@田中", false, ["期限切れ", "今日"]],
    ]);
  });

  it("担当なしが質問だけなら目立たせない", () => {
    const groups = groupBoard([item({ kind: "question", comment: "q" })], "assignee", TODAY);
    expect(groups[0].warn).toBe(false);
  });

  it("期限順: 期限切れ・今週・来週以降・期限なし", () => {
    const groups = groupBoard(items, "due", TODAY);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.note.comment)])).toEqual([
      ["期限切れ", ["担当なしの質問", "期限切れ"]],
      ["今週（〜11/29）", ["今日", "日曜"]],
      ["来週以降", ["来週"]],
      ["期限なし", ["期限なし"]],
    ]);
  });
});

describe("boardMarkdown", () => {
  it("議事録と同じ行の形で書き出す", () => {
    const items: BoardItem[] = [
      { ...item({ comment: "見積を出す", assignee: "田中", due: "2026-12-01" }, "報告.pptx"), where: "S3" },
      { ...item({ kind: "question", comment: "根拠は？\n前回の数字" }, "資料.docx"), where: "§ 予算 ¶5" },
      { ...item({ comment: "" }, "a.md"), where: "L2" },
    ];
    const md = boardMarkdown(groupBoard(items, "assignee", TODAY), summarizeBoard(items, TODAY), TODAY);
    expect(md).toBe(
      [
        "# 未完了の宿題・質問（2026-11-23）",
        "",
        "- 期限切れ 0件 / 今週 0件 / 担当なし 1件（全 3件）",
        "",
        "## 担当なし",
        "",
        "- [ ] 「引用」（a.md L2）",
        "- [ ] 質問: 根拠は？",
        "  前回の数字（資料.docx § 予算 ¶5）",
        "",
        "## @田中",
        "",
        "- [ ] 見積を出す — @田中 〜12/1（報告.pptx S3）",
        "",
      ].join("\n"),
    );
  });

  it("空のとき", () => {
    expect(boardMarkdown([], summarizeBoard([], TODAY), TODAY)).toContain("（未完了の宿題・質問はありません）");
  });
});

describe("種類での絞り込み・完了にする", () => {
  it("宿題だけ・質問だけに絞る", () => {
    const items = [item({ comment: "宿題" }), item({ kind: "question", comment: "質問" })];
    expect(filterKind(items, "question").map((i) => i.note.comment)).toEqual(["質問"]);
    expect(filterKind(items, "action").map((i) => i.note.comment)).toEqual(["宿題"]);
    expect(filterKind(items, "all")).toHaveLength(2);
  });

  it("宿題・質問を完了（回答済み）にし、戻せる。ほかのノートは変えない", () => {
    const q = note({ kind: "question", comment: "質問" });
    const m = note({ comment: "メモ" });
    const f = { ...emptyNotesFile("a.md"), notes: [q, m] };
    const done = setNoteDone(f, q.id, true, "2026-11-23T10:00:00.000Z");
    expect(done.found).toBe(true);
    expect(done.file.notes[0]).toMatchObject({ done: true, updatedAt: "2026-11-23T10:00:00.000Z" });
    expect(done.file.notes[1]).toBe(m);
    const undone = setNoteDone(done.file, q.id, false, "2026-11-23T11:00:00.000Z");
    expect(undone.file.notes[0].done).toBeUndefined();
    expect(setNoteDone(f, m.id, true, "x")).toEqual({ file: f, found: false });
    expect(setNoteDone(f, "none", true, "x").found).toBe(false);
  });
});

describe("期限前の通知", () => {
  it("期限切れ・今日・明日を数える", () => {
    const items = [
      item({ due: "2026-11-20" }),
      item({ kind: "question", due: "2026-11-22" }),
      item({ due: "2026-11-23" }),
      item({ due: "2026-11-24" }),
      item({ due: "2026-11-25" }),
      item({}),
    ];
    const a = dueAlert(items, TODAY);
    expect(a).toEqual({ overdue: 2, today: 1, tomorrow: 1 });
    expect(dueAlertMessage(a)).toBe("期限切れ 2件・今日が期限 1件・明日が期限 1件の宿題・質問があります");
    expect(dueAlertMessage({ overdue: 0, today: 0, tomorrow: 2 })).toBe("明日が期限 2件の宿題・質問があります");
    expect(dueAlertMessage({ overdue: 0, today: 0, tomorrow: 0 })).toBeNull();
  });

  it("月末・年末の明日", () => {
    expect(dueAlert([item({ due: "2027-01-01" })], new Date(2026, 11, 31)).tomorrow).toBe(1);
  });
});
