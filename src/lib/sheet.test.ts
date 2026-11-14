import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { createCellAnchor, expandMerges, formatRef, parseRef, resolveCellAnchor, type SheetBook } from "./sheet";
import { xlsxToBook } from "./xlsx";

type Aoa = (string | number | Date | null)[][];

function buildXlsx(sheets: Record<string, Aoa>, opts: { merges?: Record<string, string[]> } = {}): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
    if (opts.merges?.[name]) ws["!merges"] = opts.merges[name].map((r) => XLSX.utils.decode_range(r));
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return out;
}

const BUDGET: Aoa = [
  ["2026年度 予算案"],
  ["項目", "4月", "5月", "備考"],
  ["人件費", 1200, 1350, "5月から増員"],
  ["外注費", 800, 800, null],
  ["合計", 2000, 2150, null],
];

function book(aoa: Aoa, extra: Record<string, Aoa> = {}): SheetBook {
  return xlsxToBook(buildXlsx({ 予算: aoa, ...extra })).book;
}

describe("番地", () => {
  it("範囲の表記と解析が往復する", () => {
    expect(formatRef({ r1: 2, c1: 1, r2: 4, c2: 3 })).toBe("B3:D5");
    expect(formatRef({ r1: 0, c1: 27, r2: 0, c2: 27 })).toBe("AB1");
    expect(parseRef("B3:D5")).toEqual({ r1: 2, c1: 1, r2: 4, c2: 3 });
    expect(parseRef("$AB$1")).toEqual({ r1: 0, c1: 27, r2: 0, c2: 27 });
    expect(parseRef("D5:B3")).toEqual({ r1: 2, c1: 1, r2: 4, c2: 3 });
    expect(parseRef("あ")).toBeNull();
  });

  it("結合セルにかかる選択は結合セル全体に広がる", () => {
    const merges = [{ r1: 0, c1: 0, r2: 0, c2: 3 }];
    expect(expandMerges({ r1: 0, c1: 2, r2: 1, c2: 2 }, merges)).toEqual({ r1: 0, c1: 0, r2: 1, c2: 3 });
  });
});

describe("xlsxToBook", () => {
  it("表示形式どおりの文字列と結合セルを読む", () => {
    const data = buildXlsx({ 予算: BUDGET, 日程: [["日付"], [new Date(Date.UTC(2026, 3, 1))]] }, { merges: { 予算: ["A1:D1"] } });
    const { book: b } = xlsxToBook(data);
    expect(b.sheets.map((s) => s.name)).toEqual(["予算", "日程"]);
    const s = b.sheets[0];
    expect(s.rows[2]).toEqual(["人件費", "1200", "1350", "5月から増員"]);
    expect(s.rows.length).toBe(5);
    expect(s.rows[0].length).toBe(4);
    expect(s.merges).toEqual([{ r1: 0, c1: 0, r2: 0, c2: 3 }]);
    expect(b.sheets[1].rows[1][0]).toMatch(/^2026\/4\/1/);
  });

  it("同じ内容なら版の判定用テキストも同じ", () => {
    expect(xlsxToBook(buildXlsx({ 予算: BUDGET })).text).toBe(xlsxToBook(buildXlsx({ 予算: BUDGET })).text);
  });
});

describe("セル範囲アンカー", () => {
  const b1 = book(BUDGET);
  const s1 = b1.sheets[0];

  it("行・列の見出しと値を記録する", () => {
    const a = createCellAnchor(s1, { r1: 2, c1: 2, r2: 2, c2: 2 }, "v1");
    expect(a).toMatchObject({ sheet: "予算", ref: "C3", values: [["1350"]], rowHeader: "人件費", colHeader: "5月", quote: "1350" });
  });

  it("変更がなければ ok", () => {
    const a = createCellAnchor(s1, { r1: 2, c1: 1, r2: 3, c2: 2 }, "v1");
    expect(resolveCellAnchor(b1, a)).toEqual({ status: "ok", sheet: "予算", range: { r1: 2, c1: 1, r2: 3, c2: 2 } });
  });

  it("上に行・左に列が挿入されても追従する（moved）", () => {
    const a = createCellAnchor(s1, { r1: 2, c1: 2, r2: 2, c2: 2 }, "v1");
    const inserted: Aoa = [
      BUDGET[0],
      [null, "区分", ...BUDGET[1]],
      [null, "固定", "通信費", 50, 50, null],
      ...BUDGET.slice(2).map((r) => [null, "固定", ...r]),
    ];
    const r = resolveCellAnchor(book(inserted), a);
    expect(r.status).toBe("moved");
    expect(r.range).toEqual({ r1: 3, c1: 4, r2: 3, c2: 4 });
  });

  it("同じ値が他にあっても、見出しが一致する方を選ぶ", () => {
    // 外注費の 4月・5月はどちらも 800
    const a = createCellAnchor(s1, { r1: 3, c1: 2, r2: 3, c2: 2 }, "v1");
    const swapped: Aoa = [BUDGET[0], ["項目", "5月", "4月", "備考"], ["人件費", 1350, 1200, null], ["外注費", 800, 800, null]];
    const r = resolveCellAnchor(book(swapped), a);
    expect(r.range).toEqual({ r1: 3, c1: 1, r2: 3, c2: 1 });
  });

  it("値が変わっても、行・列の見出しの交点を推定する（fuzzy）", () => {
    const a = createCellAnchor(s1, { r1: 2, c1: 2, r2: 2, c2: 2 }, "v1");
    const changed: Aoa = [BUDGET[0], BUDGET[1], ["外注費", 800, 900, null], ["人件費", 1200, 1400, null]];
    const r = resolveCellAnchor(book(changed), a);
    expect(r).toEqual({ status: "fuzzy", sheet: "予算", range: { r1: 3, c1: 2, r2: 3, c2: 2 } });
  });

  it("シート名が変わっても、値と見出しで見つける", () => {
    const a = createCellAnchor(s1, { r1: 2, c1: 3, r2: 2, c2: 3 }, "v1");
    const r = resolveCellAnchor(xlsxToBook(buildXlsx({ 予算v2: BUDGET })).book, a);
    expect(r).toMatchObject({ status: "moved", sheet: "予算v2", range: { r1: 2, c1: 3, r2: 2, c2: 3 } });
  });

  it("行が消えて見出しも値もなければ orphaned", () => {
    const a = createCellAnchor(s1, { r1: 2, c1: 2, r2: 2, c2: 2 }, "v1");
    const removed: Aoa = [BUDGET[0], BUDGET[1], BUDGET[3]];
    expect(resolveCellAnchor(book(removed), a).status).toBe("orphaned");
  });

  it("短い値は見出しの裏付けがないと別の場所へ移さない", () => {
    const aoa: Aoa = [["1", "2"], ["3", "4"]];
    const a = createCellAnchor(book(aoa).sheets[0], { r1: 1, c1: 1, r2: 1, c2: 1 }, "v1");
    // a の見出し: 行 "3"、列 "2"。値 "4" が別の行列に移り、見出しも無関係になった
    const r = resolveCellAnchor(book([["x", "y"], ["z", "w"], ["", "", "4"]]), a);
    expect(r.status).toBe("orphaned");
  });
});
