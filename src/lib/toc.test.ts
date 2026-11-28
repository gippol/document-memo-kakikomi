import { describe, expect, it } from "vitest";
import { lastAtOrAbove, notesPerEntry, tocByPage, tocEntries } from "./toc";

const headings = [
  { text: "概要", level: 2, start: 0 },
  { text: "背景", level: 3, start: 10 },
  { text: "スケジュール", level: 2, start: 30 },
];

describe("tocEntries", () => {
  it("一番上のレベルを 0 段にし、節は次の見出しの手前まで", () => {
    expect(tocEntries(headings, 50)).toEqual([
      { index: 0, text: "概要", depth: 0, start: 0, end: 10 },
      { index: 1, text: "背景", depth: 1, start: 10, end: 30 },
      { index: 2, text: "スケジュール", depth: 0, start: 30, end: 50 },
    ]);
  });

  it("見出しが無ければ空", () => {
    expect(tocEntries([], 50)).toEqual([]);
  });
});

describe("notesPerEntry", () => {
  it("ノートの開始位置がある節で数える。最初の見出しより前は数えない", () => {
    const entries = tocEntries([{ text: "a", level: 1, start: 5 }, ...headings.slice(1)], 50);
    const m = notesPerEntry(entries, [0, 5, 9, 10, 29, 30, 49]);
    expect([...m]).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
  });
});

describe("tocByPage", () => {
  it("PDF の見出しを、始まる位置のページに振り分ける（見出しの無いページも出す）", () => {
    const pages = [
      { no: 1, start: 0, end: 100 },
      { no: 2, start: 100, end: 200 },
      { no: 3, start: 200, end: 300 },
    ];
    const toc = tocEntries(
      [
        { text: "表題", level: 1, start: 0 },
        { text: "1. 進捗", level: 2, start: 40 },
        { text: "2. 課題", level: 2, start: 200 },
      ],
      300,
    );
    expect(tocByPage(pages, toc).map((p) => [p.no, p.entries.map((e) => [e.text, e.depth])])).toEqual([
      [
        1,
        [
          ["表題", 0],
          ["1. 進捗", 1],
        ],
      ],
      [2, []],
      [3, [["2. 課題", 1]]],
    ]);
    expect(tocByPage(pages, []).map((p) => p.entries.length)).toEqual([0, 0, 0]);
  });
});

describe("lastAtOrAbove", () => {
  const tops = [0, 100, 250, 400];
  const f = (line: number) => lastAtOrAbove(tops.length, (i) => tops[i], line);

  it("line 以下にある最後の番号", () => {
    expect(f(0)).toBe(0);
    expect(f(99)).toBe(0);
    expect(f(100)).toBe(1);
    expect(f(300)).toBe(2);
    expect(f(1000)).toBe(3);
  });

  it("どれも line より下なら -1", () => {
    expect(f(-50)).toBe(-1);
  });
});
