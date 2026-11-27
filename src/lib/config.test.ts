import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES, insertTemplate, parseConfig } from "./config";

/** 項目のエラーが無いことを確かめて設定を返す */
const ok = (json: string) => {
  const r = parseConfig(json);
  expect(r.errors).toEqual([]);
  return r.config;
};

describe("parseConfig", () => {
  it("見出し指定を読む", () => {
    expect(ok('{ "docxHeadings": { "社内見出し大": 1, "大きい太字": 0 } }').docxHeadings).toEqual({
      社内見出し大: 1,
      大きい太字: 0,
    });
  });
  it("docxHeadings・templates が無くてもよい（テンプレートは既定のもの）", () => {
    expect(ok("{}")).toEqual({ docxHeadings: {}, templates: DEFAULT_TEMPLATES });
  });
  it("JSON として読めない・最上位がオブジェクトでないときは例外", () => {
    expect(() => parseConfig("{ broken")).toThrow(/JSON/);
    expect(() => parseConfig("[]")).toThrow(/最上位/);
  });
  it("不正な docxHeadings はその項目だけ既定にしてエラーを返す", () => {
    expect(parseConfig('{ "docxHeadings": { "x": 7 } }').errors).toEqual([expect.stringMatching(/0〜6/)]);
    const r = parseConfig('{ "docxHeadings": ["x"], "templates": [{ "name": "a", "text": "b" }] }');
    expect(r.errors).toEqual([expect.stringMatching(/docxHeadings/)]);
    expect(r.config).toEqual({ docxHeadings: {}, templates: [{ name: "a", text: "b" }] });
  });
});

describe("parseConfig の templates", () => {
  it("本文は文字列でも行の配列でもよい", () => {
    const c = ok(
      JSON.stringify({
        templates: [
          { name: "定例会", text: "出席者：\n議題：" },
          { name: " レビュー会 ", text: ["指摘者：", "対象版："] },
        ],
      }),
    );
    expect(c.templates).toEqual([
      { name: "定例会", text: "出席者：\n議題：" },
      { name: "レビュー会", text: "指摘者：\n対象版：" },
    ]);
  });
  it("Windows の改行（\\r\\n）は \\n にそろえる", () => {
    expect(ok(JSON.stringify({ templates: [{ name: "a", text: "出席者：\r\n議題：\r次回：" }] })).templates).toEqual([
      { name: "a", text: "出席者：\n議題：\n次回：" },
    ]);
  });
  it("空の配列ならテンプレートを出さない", () => {
    expect(ok('{ "templates": [] }').templates).toEqual([]);
  });
  it("不正な値はエラーにする", () => {
    const err = (json: string) => parseConfig(json).errors.join("\n");
    expect(err('{ "templates": {} }')).toMatch(/"templates" は/);
    expect(err('{ "templates": ["x"] }')).toMatch(/1 番目/);
    expect(err('{ "templates": [{ "name": "", "text": "a" }] }')).toMatch(/"name"/);
    expect(err('{ "templates": [{ "name": "a" }] }')).toMatch(/"text"/);
    expect(err('{ "templates": [{ "name": "a", "text": ["x", 1] }] }')).toMatch(/"text"/);
  });
  it("テンプレートが壊れていても Word の見出し設定は残す（テンプレートは既定に戻す）", () => {
    const r = parseConfig('{ "docxHeadings": { "社内見出し大": 1 }, "templates": [{ "name": "x" }] }');
    expect(r.errors).toEqual([expect.stringMatching(/"text"/)]);
    expect(r.config).toEqual({ docxHeadings: { 社内見出し大: 1 }, templates: DEFAULT_TEMPLATES });
  });
  it("両方壊れていればエラーを 2 つ返す", () => {
    expect(parseConfig('{ "docxHeadings": 1, "templates": 1 }').errors).toHaveLength(2);
  });
});

describe("insertTemplate", () => {
  it("空ならそのまま入れ、1 行目の末尾にカーソルを置く", () => {
    expect(insertTemplate("", "出席者：\n議題：")).toEqual({ comment: "出席者：\n議題：", cursor: 4 });
  });
  it("書いてあるものは消さずに後ろへ足す", () => {
    expect(insertTemplate("メモ\n\n", "出席者：\n議題：")).toEqual({ comment: "メモ\n出席者：\n議題：", cursor: 7 });
  });
  it("空白だけなら空と同じ", () => {
    expect(insertTemplate("  \n", "a")).toEqual({ comment: "a", cursor: 1 });
  });
});
