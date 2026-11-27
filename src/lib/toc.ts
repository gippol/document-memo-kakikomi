import type { HeadingSpan } from "./place";

/** 目次の 1 項目（Word・Markdown の見出し） */
export interface TocEntry {
  /** 見出しの順番（0 始まり。headingElements の並びと同じ） */
  index: number;
  text: string;
  /** 字下げの段（いちばん上のレベルの見出しが 0） */
  depth: number;
  /** この見出しから次の見出しの手前まで（表示テキスト上の位置） */
  start: number;
  end: number;
}

/** 見出しの一覧から目次を作る。節の範囲は、次の見出し（レベルを問わない）の手前まで */
export function tocEntries(headings: HeadingSpan[], textLength: number): TocEntry[] {
  const top = Math.min(...headings.map((h) => h.level));
  return headings.map((h, i) => ({
    index: i,
    text: h.text,
    depth: h.level - top,
    start: h.start,
    end: headings[i + 1]?.start ?? textLength,
  }));
}

/** 節ごとのノート数（ノートの開始位置で数える。最初の見出しより前のノートは数えない） */
export function notesPerEntry(entries: TocEntry[], noteStarts: number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const s of noteStarts) {
    const e = entries.find((x) => s >= x.start && s < x.end);
    if (e) m.set(e.index, (m.get(e.index) ?? 0) + 1);
  }
  return m;
}

/**
 * 上から順に並んだ位置（tops）のうち、line 以下にある最後のものの番号。どれも line より下なら -1。
 * 見出しは文書の順に上から並ぶので二分探索で求める（スクロールのたびに全部の見出しを測らない）
 */
export function lastAtOrAbove(count: number, topOf: (i: number) => number, line: number): number {
  let lo = 0;
  let hi = count - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (topOf(mid) <= line) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
