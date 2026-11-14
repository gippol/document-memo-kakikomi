import { describe, expect, it } from "vitest";
import { parseConfig } from "./config";

describe("parseConfig", () => {
  it("見出し指定を読む", () => {
    expect(parseConfig('{ "docxHeadings": { "社内見出し大": 1, "大きい太字": 0 } }')).toEqual({
      docxHeadings: { 社内見出し大: 1, 大きい太字: 0 },
    });
  });
  it("docxHeadings が無くてもよい", () => {
    expect(parseConfig("{}")).toEqual({ docxHeadings: {} });
  });
  it("不正な値はエラーにする", () => {
    expect(() => parseConfig("{ broken")).toThrow(/JSON/);
    expect(() => parseConfig('{ "docxHeadings": { "x": 7 } }')).toThrow(/0〜6/);
    expect(() => parseConfig('{ "docxHeadings": ["x"] }')).toThrow(/docxHeadings/);
  });
});
