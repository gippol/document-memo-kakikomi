import { describe, expect, it } from "vitest";
import { applyShorthand, fieldsPatch, isOverdue, normalizeFields, parseDue, sameFields, type NoteFields } from "./noteMeta";

const TODAY = new Date(2026, 10, 23); // 2026-11-23
const memo = (comment: string): NoteFields => ({ kind: "memo", comment });

describe("parseDue", () => {
  it("月/日は今年（半年以上前になるなら来年）", () => {
    expect(parseDue("12/1", TODAY)).toBe("2026-12-01");
    expect(parseDue("11/20", TODAY)).toBe("2026-11-20");
    expect(parseDue("1/15", TODAY)).toBe("2027-01-15");
  });

  it("年付き・全角・相対指定", () => {
    expect(parseDue("2027/2/3", TODAY)).toBe("2027-02-03");
    expect(parseDue("2027-02-03", TODAY)).toBe("2027-02-03");
    expect(parseDue("１２／１", TODAY)).toBe("2026-12-01");
    expect(parseDue("今日", TODAY)).toBe("2026-11-23");
    expect(parseDue("明日", TODAY)).toBe("2026-11-24");
    expect(parseDue("+10", TODAY)).toBe("2026-12-03");
  });

  it("存在しない日付・日付でない文字は null", () => {
    expect(parseDue("2/30", TODAY)).toBeNull();
    expect(parseDue("13/1", TODAY)).toBeNull();
    expect(parseDue("重要", TODAY)).toBeNull();
  });
});

describe("applyShorthand", () => {
  it("先頭の記法から種類・担当者・期限を読み取り、コメントから取り除く", () => {
    expect(applyShorthand(memo("/宿 @田中 !12/1 見積もりを再提出"), TODAY)).toEqual({
      kind: "action",
      comment: "見積もりを再提出",
      assignee: "田中",
      due: "2026-12-01",
    });
    expect(applyShorthand(memo("/決 予算は案Bで進める"), TODAY)).toEqual({ kind: "decision", comment: "予算は案Bで進める" });
    expect(applyShorthand(memo("/q 前回の数字の根拠は?"), TODAY)).toMatchObject({ kind: "question" });
  });

  it("全角の記号でもよい", () => {
    expect(applyShorthand(memo("／質　＠佐藤 根拠は？"), TODAY)).toEqual({ kind: "question", comment: "根拠は？", assignee: "佐藤" });
  });

  it("担当者・期限だけ書くと宿題になる", () => {
    expect(applyShorthand(memo("@田中 確認する"), TODAY)).toMatchObject({ kind: "action", assignee: "田中" });
  });

  it("記法でない語が出たらそこから後はコメント", () => {
    expect(applyShorthand(memo("/決 期限は !12/1 にする"), TODAY)).toEqual({ kind: "decision", comment: "期限は !12/1 にする" });
    expect(applyShorthand(memo("/不明 メモ"), TODAY)).toEqual(memo("/不明 メモ"));
    expect(applyShorthand(memo("普通のメモ"), TODAY)).toEqual(memo("普通のメモ"));
  });

  it("改行の後もコメントとして残す", () => {
    expect(applyShorthand(memo("/決\n1行目\n2行目"), TODAY)).toEqual({ kind: "decision", comment: "1行目\n2行目" });
  });

  it("書かなかった項目は元の値のまま", () => {
    const f: NoteFields = { kind: "action", comment: "!12/5 延期", assignee: "田中", due: "2026-12-01" };
    expect(applyShorthand(f, TODAY)).toEqual({ ...f, comment: "延期", due: "2026-12-05" });
  });
});

describe("normalizeFields / fieldsPatch", () => {
  it("メモ・決定は担当者・期限・完了状態を持たない", () => {
    expect(normalizeFields({ kind: "decision", comment: "x", assignee: "田中", due: "2026-12-01", done: true })).toEqual({
      kind: "decision",
      comment: "x",
    });
  });

  it("空の担当者・不正な期限を落とす", () => {
    expect(normalizeFields({ kind: "action", comment: "x", assignee: "  ", due: "2026-02-30", done: false })).toEqual({
      kind: "action",
      comment: "x",
    });
  });

  it("メモは kind を書かない", () => {
    expect(fieldsPatch(memo("x"))).toEqual({ kind: undefined, comment: "x", assignee: undefined, due: undefined, done: undefined });
  });

  it("sameFields は正規化してから比べる", () => {
    expect(sameFields({ kind: "action", comment: "x", done: false }, { kind: "action", comment: "x" })).toBe(true);
    expect(sameFields({ kind: "action", comment: "x" }, { kind: "question", comment: "x" })).toBe(false);
  });
});

describe("isOverdue", () => {
  it("期限を過ぎた未完了の宿題・質問だけ", () => {
    expect(isOverdue({ kind: "action", due: "2026-11-22" }, TODAY)).toBe(true);
    expect(isOverdue({ kind: "action", due: "2026-11-23" }, TODAY)).toBe(false);
    expect(isOverdue({ kind: "action", due: "2026-11-22", done: true }, TODAY)).toBe(false);
    expect(isOverdue({ kind: "decision", due: "2026-11-22" }, TODAY)).toBe(false);
  });
});
