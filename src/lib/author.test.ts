import { describe, expect, it } from "vitest";
import { nextDoneBy, resolveAuthor } from "./author";

describe("書いた人の名前", () => {
  it("この PC で決めた名前、決めていなければ git の名前。空文字は記録しない", () => {
    expect(resolveAuthor("佐藤", "Taro Tanaka")).toBe("佐藤");
    expect(resolveAuthor(null, "Taro Tanaka")).toBe("Taro Tanaka");
    expect(resolveAuthor(null, null)).toBeUndefined();
    expect(resolveAuthor("", "Taro Tanaka")).toBeUndefined();
    expect(resolveAuthor("  田中  ", null)).toBe("田中");
    expect(resolveAuthor("あ".repeat(50), null)).toBe("あ".repeat(40));
  });

  it("完了にした人は完了にしたときだけ記録し、完了のままなら前の人、未完了なら消す", () => {
    expect(nextDoneBy({}, true, "田中")).toBe("田中");
    expect(nextDoneBy({ done: true, doneBy: "佐藤" }, true, "田中")).toBe("佐藤");
    // 記録を始める前に完了にしたノートは、誰が完了にしたか分からないので記録しない
    expect(nextDoneBy({ done: true }, true, "田中")).toBeUndefined();
    expect(nextDoneBy({ done: true, doneBy: "佐藤" }, false, "田中")).toBeUndefined();
    expect(nextDoneBy({}, true, undefined)).toBeUndefined();
  });
});
