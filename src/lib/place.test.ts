import { describe, expect, it } from "vitest";
import { createPlaceAnchor, placeLabel, placeOptions, resolvePlace, type PlaceContext } from "./place";

const ctx: PlaceContext = {
  slides: [
    { no: 1, id: 256, title: "表紙", start: 0 },
    { no: 2, id: 300, title: "体制", start: 40 },
  ],
  pages: [
    { no: 1, start: 0 },
    { no: 2, start: 50 },
  ],
  headings: [
    { text: "1. 背景", level: 1, start: 10 },
    { text: "2. 予算", level: 1, start: 80 },
  ],
  sheets: ["概要", "予算"],
};

describe("全体メモの付け先", () => {
  it("資料全体はいつも見つかり、先頭に並ぶ", () => {
    const r = resolvePlace(createPlaceAnchor({ scope: "doc" }, "x"), ctx);
    expect(r).toMatchObject({ found: true, target: null, sortKey: -1 });
  });

  it("スライドは ID で探し、番号とタイトルは今の資料のものにする", () => {
    const a = createPlaceAnchor({ scope: "slide", slide: 5, slideId: 300, heading: "旧タイトル" }, "x");
    expect(a.quote).toBe("旧タイトル");
    const r = resolvePlace(a, ctx);
    expect(r).toMatchObject({ found: true, place: { slide: 2, heading: "体制" }, target: { kind: "point", start: 40 } });
    expect(r.sortKey).toBeLessThan(40);
    expect(resolvePlace({ ...a, slideId: 999 }, ctx).found).toBe(false);
  });

  it("PDF のページは番号で探す", () => {
    const a = createPlaceAnchor({ scope: "page", page: 2 }, "x");
    expect(a).toMatchObject({ scope: "page", page: 2, quote: "p.2" });
    expect(resolvePlace(a, ctx)).toMatchObject({ found: true, place: { page: 2 }, target: { kind: "point", start: 50 }, sortKey: 49.5 });
    expect(resolvePlace(createPlaceAnchor({ scope: "page", page: 9 }, "x"), ctx).found).toBe(false);
    expect(placeLabel({ scope: "page", page: 2 })).toBe("ページ 2");
  });

  it("シートは名前、見出しは文言で探す", () => {
    expect(resolvePlace(createPlaceAnchor({ scope: "sheet", sheet: "予算" }, "x"), ctx)).toMatchObject({
      found: true,
      target: { kind: "sheet", sheet: "予算" },
    });
    expect(resolvePlace(createPlaceAnchor({ scope: "sheet", sheet: "消えた" }, "x"), ctx).found).toBe(false);
    expect(resolvePlace(createPlaceAnchor({ scope: "heading", heading: "2. 予算" }, "x"), ctx)).toMatchObject({
      found: true,
      target: { kind: "point", start: 80 },
    });
    expect(resolvePlace(createPlaceAnchor({ scope: "heading", heading: "3. 日程" }, "x"), ctx).found).toBe(false);
  });

  it("選択肢は資料全体と、いま見ている場所", () => {
    expect(placeOptions(null)).toEqual([{ scope: "doc" }]);
    expect(placeOptions({ scope: "sheet", sheet: "予算" })).toEqual([{ scope: "doc" }, { scope: "sheet", sheet: "予算" }]);
  });

  it("表示名", () => {
    expect(placeLabel({ scope: "doc" })).toBe("資料全体");
    expect(placeLabel({ scope: "slide", slide: 2, heading: "体制" })).toBe("スライド 2 体制");
    expect(placeLabel({ scope: "sheet", sheet: "予算" })).toBe("シート 予算");
    expect(placeLabel({ scope: "heading", heading: "2. 予算" })).toBe("§ 2. 予算");
  });
});
