import { describe, expect, it } from "vitest";
import type { NoteView } from "../components/NotesPanel";
import { buildMinutes, minutesFileName } from "./minutes";
import type { Note } from "./notesFile";

const TODAY = new Date(2026, 10, 23);
const opts = { docPath: "会議/定例会議資料.docx", today: TODAY, includeQuotes: false };

let seq = 0;
function view(n: Partial<Note> & { quote?: string }, loc: Partial<NoteView> = {}): NoteView {
  seq++;
  const { quote = `引用${seq}`, ...rest } = n;
  const note: Note = {
    id: `n${seq}`,
    comment: "",
    createdAt: "2026-11-23T00:00:00.000Z",
    updatedAt: "2026-11-23T00:00:00.000Z",
    anchor: { type: "text", quote, prefix: "", suffix: "", start: 0, end: 1, sourceSha256: "x" },
    ...rest,
  };
  return { note, status: "ok", stale: false, target: null, sortKey: seq, ...loc };
}

describe("buildMinutes", () => {
  it("決定・宿題・質問を先頭に集め、メモは見出しごとにまとめる", () => {
    const md = buildMinutes(
      [
        view({ comment: "背景の補足" }, { heading: "1. 背景", paragraph: 2 }),
        view({ kind: "decision", comment: "予算は案Bで進める" }, { heading: "2. 予算", paragraph: 5 }),
        view({ kind: "action", comment: "見積もりを再提出", assignee: "田中", due: "2026-12-01" }, { heading: "2. 予算", paragraph: 6 }),
        view({ kind: "action", comment: "会議室を予約", done: true }, { heading: "3. 日程", paragraph: 9 }),
        view({ kind: "question", comment: "前回の数字の根拠は？", assignee: "佐藤" }, { heading: "2. 予算", paragraph: 7 }),
        view({ comment: "日程は再調整" }, { heading: "3. 日程", paragraph: 10 }),
        view({ comment: "もう一つの背景" }, { heading: "1. 背景", paragraph: 3 }),
      ],
      opts,
    );
    expect(md).toBe(
      [
        "# 議事録: 定例会議資料.docx",
        "",
        "- 日付: 2026-11-23",
        "- 資料: 会議/定例会議資料.docx",
        "",
        "## 決定事項",
        "",
        "- 予算は案Bで進める（§ 2. 予算 ¶5）",
        "",
        "## 宿題",
        "",
        "- [ ] 見積もりを再提出 — @田中 〜12/1（§ 2. 予算 ¶6）",
        "- [x] 会議室を予約（§ 3. 日程 ¶9）",
        "",
        "## 質問",
        "",
        "- [ ] 前回の数字の根拠は？ — @佐藤（§ 2. 予算 ¶7）",
        "",
        "## メモ",
        "",
        "### 1. 背景",
        "",
        "- 背景の補足（¶2）",
        "- もう一つの背景（¶3）",
        "",
        "### 3. 日程",
        "",
        "- 日程は再調整（¶10）",
        "",
      ].join("\n"),
    );
  });

  it("引用を含める・コメントが空なら引用を本文にする", () => {
    const md = buildMinutes(
      [
        view({ kind: "decision", comment: "", quote: "案Bで進める" }, { lineStart: 3 }),
        view({ comment: "要確認", quote: "ここが\n重要な仕様" }, { lineStart: 8 }),
      ],
      { ...opts, includeQuotes: true },
    );
    expect(md).toContain("- 「案Bで進める」（L3）\n");
    expect(md).toContain("### （見出しなし）\n\n- 要確認（L8）\n  > ここが 重要な仕様\n");
  });

  it("宿題・質問の引用・続きの行も 2 文字下げ（コードブロックにしない）", () => {
    const md = buildMinutes([view({ kind: "action", comment: "1行目\n2行目", quote: "根拠" }, { paragraph: 1 })], {
      ...opts,
      includeQuotes: true,
    });
    expect(md).toContain("- [ ] 1行目\n  2行目（¶1）\n  > 根拠\n");
  });

  it("決定を変えたときは置き換え元を添える", () => {
    const md = buildMinutes(
      [view({ kind: "decision", comment: "予算は案Bに変更", supersedes: { id: "note-a", doc: "第3回.docx", text: "予算は案A" } }, { heading: "2. 予算", paragraph: 5 })],
      opts,
    );
    expect(md).toContain("- 予算は案Bに変更（§ 2. 予算 ¶5）\n  - 置き換え元: 予算は案A\n");
  });

  it("複数行のコメントは字下げして続ける", () => {
    const md = buildMinutes([view({ comment: "1行目\n2行目" }, { heading: "A" })], opts);
    expect(md).toContain("- 1行目\n  2行目\n");
  });

  it("Excel はシート、PowerPoint はスライドでまとめ、見つからないノートは別にする", () => {
    const md = buildMinutes(
      [
        view({ comment: "人件費が多い" }, { cell: "予算!C4", heading: "人件費 / 5月" }),
        view({ comment: "タイトル案" }, { slide: 3, heading: "体制" }),
        view({ comment: "消えた" }, { status: "orphaned", sortKey: Infinity }),
      ],
      opts,
    );
    expect(md).toContain("### 予算\n\n- 人件費が多い（予算!C4）");
    expect(md).toContain("### S3 体制\n\n- タイトル案（S3）");
    expect(md).toContain("### （資料に見つからないノート）\n\n- 消えた\n");
  });

  it("PDF はページでまとめ、出典にページ番号を付ける", () => {
    const md = buildMinutes(
      [
        view({ comment: "図の説明" }, { page: 2, sortKey: 10 }),
        view({ kind: "decision", comment: "この案で進める" }, { page: 3, sortKey: 20 }),
        view(
          { comment: "口頭の補足", anchor: { type: "place", scope: "page", page: 2, quote: "p.2", sourceSha256: "x" } },
          { place: { scope: "page", page: 2 }, page: 2, sortKey: 9.5 },
        ),
      ],
      { ...opts, docPath: "資料.pdf" },
    );
    expect(md).toContain("## 決定事項\n\n- この案で進める（p.3）\n");
    expect(md).toContain("### p.2\n\n- 口頭の補足\n- 図の説明（p.2）\n");
  });

  it("全体メモは資料全体を先頭に、見出しの節のものはその見出しの先頭にまとめる", () => {
    const placeAnchor = (scope: "doc" | "heading", heading?: string) =>
      ({ type: "place", scope, heading, quote: heading ?? "", sourceSha256: "x" }) as const;
    const md = buildMinutes(
      [
        view({ comment: "背景の補足" }, { heading: "1. 背景", paragraph: 2, sortKey: 20 }),
        view({ comment: "脱線: 来期の話", anchor: placeAnchor("doc") }, { place: { scope: "doc" }, sortKey: -1 }),
        view(
          { comment: "背景は口頭で補足あり", anchor: placeAnchor("heading", "1. 背景") },
          { place: { scope: "heading", heading: "1. 背景" }, heading: "1. 背景", sortKey: 10 },
        ),
        view({ kind: "decision", comment: "次回は対面", anchor: placeAnchor("doc") }, { place: { scope: "doc" }, sortKey: -1 }),
      ],
      { ...opts, includeQuotes: true },
    );
    expect(md).toContain("## 決定事項\n\n- 次回は対面（資料全体）\n");
    expect(md).toContain("### （資料全体）\n\n- 脱線: 来期の話\n\n### 1. 背景\n\n- 背景は口頭で補足あり\n- 背景の補足（¶2）\n");
  });

  it("ノートが無ければその旨を書く", () => {
    expect(buildMinutes([], opts)).toContain("（ノートなし）");
  });
});

describe("minutesFileName", () => {
  it("資料名と日付から付ける", () => {
    expect(minutesFileName("会議/定例会議資料.docx", TODAY)).toBe("定例会議資料_議事録_2026-11-23.md");
    expect(minutesFileName("README", TODAY)).toBe("README_議事録_2026-11-23.md");
  });
});
