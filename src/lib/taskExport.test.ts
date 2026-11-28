import { describe, expect, it } from "vitest";
import { groupBoard, type BoardItem } from "./board";
import type { Note } from "./notesFile";
import { boardCsv, csvCell, exportFileName, issueMarkdown, issueTitle } from "./taskExport";

// 2026-11-23 は月曜
const TODAY = new Date(2026, 10, 23);

let seq = 0;
function item(n: Partial<Note>, docPath = "定例.md", where: string | null = "§ 予算 L3"): BoardItem {
  seq++;
  const note: Note = {
    id: `note-${seq}`,
    kind: "action",
    comment: `宿題${seq}`,
    createdAt: "2026-11-20T03:00:00.000Z",
    updatedAt: "2026-11-23T00:00:00.000Z",
    anchor: { type: "text", quote: "予算の見直し", prefix: "", suffix: "", start: 0, end: 6, sourceSha256: "x" },
    ...n,
  };
  return { docPath, docExists: true, note, kind: note.kind as "action" | "question", where };
}

describe("csvCell", () => {
  it("区切り・引用符・改行を含む値だけ引用符で囲む", () => {
    expect(csvCell("見積もり")).toBe("見積もり");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('「"案"」')).toBe('"「""案""」"');
    expect(csvCell("1行目\n2行目")).toBe('"1行目\n2行目"');
  });

  it("数式として読まれる値の前に ' を付ける", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-")).toBe("'-");
    expect(csvCell("@田中")).toBe("'@田中");
    expect(csvCell("=A1,B1")).toBe(`"'=A1,B1"`);
    expect(csvCell("2026-12-01")).toBe("2026-12-01");
  });
});

describe("boardCsv", () => {
  it("BOM・見出し行付きで、画面の並び順（グループ順）に 1 行ずつ書く", () => {
    const a = item({ comment: "見積もりを出す", assignee: "田中", due: "2026-12-01", priority: "high", author: "佐藤" });
    const b = item({ kind: "question", comment: "予算は?", due: undefined }, "sub/b.docx", null);
    const c = item({ comment: "", assignee: undefined });
    const csv = boardCsv(groupBoard([a, b, c], "assignee", TODAY));
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("種類,内容,担当,期限,優先度,資料,位置,書いた人,作成日,ノートID");
    // 担当なしが先頭（同じ期限なら資料のパス順）。コメントが空なら付けた文言
    expect(lines[1]).toBe(`質問,予算は?,,,,sub/b.docx,,,2026-11-20,${b.note.id}`);
    expect(lines[2]).toBe(`宿題,「予算の見直し」,,,,定例.md,§ 予算 L3,,2026-11-20,${c.note.id}`);
    expect(lines[3]).toBe(`宿題,見積もりを出す,田中,2026-12-01,高,定例.md,§ 予算 L3,佐藤,2026-11-20,${a.note.id}`);
    expect(lines[4]).toBe("");
    expect(lines).toHaveLength(5);
  });

  it("複数行のコメントは 1 マスに入れる", () => {
    const csv = boardCsv(groupBoard([item({ comment: "1行目\n2行目", assignee: "田中" })], "due", TODAY));
    expect(csv).toContain('"1行目\n2行目"');
  });

  it("何も無ければ見出し行だけ", () => {
    expect(boardCsv([])).toBe("﻿種類,内容,担当,期限,優先度,資料,位置,書いた人,作成日,ノートID\r\n");
  });
});

describe("issueMarkdown", () => {
  it("グループごとのチェックリストにし、担当者に @ を付けない", () => {
    const a = item({ comment: "見積もりを出す", assignee: "tanaka", due: "2026-12-01", priority: "high" });
    const b = item({ kind: "question", comment: "予算は?\n上限も", assignee: undefined }, "sub/b.docx", null);
    b.docExists = false;
    const md = issueMarkdown(groupBoard([a, b], "assignee", TODAY), TODAY, "未完了の宿題・質問");
    expect(md).toBe(
      [
        '<!-- gh issue create --title "未完了の宿題・質問（2026-11-23）" --body-file <このファイル> -->',
        "",
        "資料メモ かきこみ のノートから書き出した未完了の宿題・質問（2026-11-23 時点・2件）。",
        "",
        "## 担当なし",
        "",
        "- [ ] 質問: 予算は?",
        "  上限も",
        "  - 出典: sub/b.docx（資料なし）",
        "  > 予算の見直し",
        "",
        "## 担当: tanaka",
        "",
        "- [ ] 見積もりを出す",
        "  - 担当: tanaka / 期限: 2026-12-01 / 優先度: 高",
        "  - 出典: 定例.md § 予算 L3",
        "  > 予算の見直し",
        "",
      ].join("\n"),
    );
    expect(md).not.toMatch(/@tanaka/);
  });

  it("期限順の見出しはそのまま。コメントが空なら文言を本文にして引用は付けない", () => {
    const md = issueMarkdown(groupBoard([item({ comment: "", due: "2026-11-20" })], "due", TODAY), TODAY, "未完了の宿題");
    expect(md).toContain("## 期限切れ\n\n- [ ] 「予算の見直し」\n  - 期限: 2026-11-20\n  - 出典: 定例.md § 予算 L3\n");
    expect(md).not.toMatch(/^ *> /m);
  });

  it("全体メモの宿題には引用（見出しの名前）を付けない", () => {
    const i = item({ anchor: { type: "place", scope: "heading", heading: "予算", quote: "予算", sourceSha256: "x" } }, "定例.md", "§ 予算");
    expect(issueMarkdown(groupBoard([i], "due", TODAY), TODAY, "t")).not.toMatch(/^ *> /m);
  });

  it("何も無ければその旨を書く。タイトルの \" はコメントを壊さないよう ' にする", () => {
    const md = issueMarkdown([], TODAY, '"宿題"');
    expect(md).toContain(`--title "'宿題'（2026-11-23）"`);
    expect(md).toContain("（未完了の宿題・質問はありません）");
  });
});

describe("issueTitle / exportFileName", () => {
  it("日付付きの名前にし、ファイル名に使えない文字は _ にする", () => {
    expect(issueTitle("未完了の宿題", TODAY)).toBe("未完了の宿題（2026-11-23）");
    expect(exportFileName("未完了の宿題", "csv", TODAY)).toBe("未完了の宿題_2026-11-23.csv");
    expect(exportFileName("未完了の宿題（期限切れ）", "issue", TODAY)).toBe("未完了の宿題（期限切れ）_Issue_2026-11-23.md");
    expect(exportFileName('a/b:"c"', "csv", TODAY)).toBe("a_b__c__2026-11-23.csv");
  });
});
