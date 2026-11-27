import { describe, expect, it } from "vitest";
import { inSession, listSessions, sessionLabel, sessionOf } from "./session";

/** この PC の時刻での日時（タイムゾーンに左右されないよう、ローカル時刻で作る） */
const at = (y: number, mo: number, d: number, h = 10) => ({ createdAt: new Date(y, mo - 1, d, h).toISOString() });

describe("sessionOf", () => {
  it("作成日時のこの PC での日付", () => {
    expect(sessionOf(at(2026, 11, 20))).toBe("2026-11-20");
    // 日付が変わる直前・直後
    expect(sessionOf(at(2026, 11, 20, 23))).toBe("2026-11-20");
    expect(sessionOf(at(2026, 11, 21, 0))).toBe("2026-11-21");
  });
  it("読めない日時は先頭 10 文字", () => {
    expect(sessionOf({ createdAt: "2026-11-20 ごろ" })).toBe("2026-11-20");
  });
});

describe("listSessions", () => {
  it("回ごとの件数を新しい順に", () => {
    expect(listSessions([at(2026, 11, 20), at(2026, 11, 27), at(2026, 11, 20, 11), at(2026, 11, 13)])).toEqual([
      { date: "2026-11-27", count: 1 },
      { date: "2026-11-20", count: 2 },
      { date: "2026-11-13", count: 1 },
    ]);
  });
  it("ノートが無ければ空", () => {
    expect(listSessions([])).toEqual([]);
  });
});

describe("inSession", () => {
  it("null は全部の回", () => {
    expect(inSession(at(2026, 11, 20), null)).toBe(true);
    expect(inSession(at(2026, 11, 20), "2026-11-20")).toBe(true);
    expect(inSession(at(2026, 11, 20), "2026-11-27")).toBe(false);
  });
});

describe("sessionLabel", () => {
  const today = new Date(2026, 10, 28);
  it("今年なら月/日(曜日)", () => {
    expect(sessionLabel("2026-11-20", today)).toBe("11/20(金)");
  });
  it("今年でなければ年も付ける", () => {
    expect(sessionLabel("2025-12-05", today)).toBe("2025/12/5(金)");
  });
  it("日付の形でなければそのまま", () => {
    expect(sessionLabel("不明", today)).toBe("不明");
  });
});
