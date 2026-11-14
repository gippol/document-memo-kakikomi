import type { AnchorStatus } from "./anchor";

/** セル範囲（0 始まり、両端を含む） */
export interface CellRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

/** 表示用に変換したシート。セルの値は Excel の表示どおりの文字列 */
export interface Sheet {
  name: string;
  /** A1 から使用範囲の右下までの表示文字列（行 × 列、すべて同じ長さ） */
  rows: string[][];
  /** セルの種類（行ごとに 1 文字 1 セル）。n: 数値・日付, b: 真偽値, e: エラー, 空白: 文字列など。配置に使う */
  types: string[];
  merges: CellRange[];
  /** 列幅（文字数の目安）。不明な列は undefined */
  colWidths: (number | undefined)[];
  /** 表示上限を超えたため一部を省略した */
  truncated: boolean;
}

export interface SheetBook {
  sheets: Sheet[];
}

/**
 * セル範囲アンカー（Excel 用）。
 * セル番地と範囲の値、行・列の見出しを持ち、行や列の挿入でずれても位置を再特定できる。
 */
export interface CellAnchor {
  type: "cell";
  sheet: string;
  /** Excel 表記の範囲（例: "B3:D5"、1 セルなら "B3"） */
  ref: string;
  /** 表示用の引用（範囲の値をタブ・改行でつないだもの） */
  quote: string;
  /** 範囲の左上（最大 VALUES_MAX × VALUES_MAX）の値。位置の再特定に使う */
  values: string[][];
  /** 行の見出し: その行で範囲より左にある最初の値 */
  rowHeader?: string;
  /** 列の見出し: その列で範囲より上にある最初の値 */
  colHeader?: string;
  sourceSha256: string;
}

export interface ResolvedCell {
  status: AnchorStatus;
  sheet: string;
  range: CellRange;
}

export const VALUES_MAX = 10;
const QUOTE_MAX = 200;

// ---------- 番地 ----------

export function colName(c: number): string {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function cellName(r: number, c: number): string {
  return `${colName(c)}${r + 1}`;
}

export function formatRef(g: CellRange): string {
  const a = cellName(g.r1, g.c1);
  return g.r1 === g.r2 && g.c1 === g.c2 ? a : `${a}:${cellName(g.r2, g.c2)}`;
}

function parseCell(s: string): { r: number; c: number } | null {
  const m = /^\$?([A-Z]{1,3})\$?(\d{1,7})$/i.exec(s.trim());
  if (!m) return null;
  let c = 0;
  for (const ch of m[1].toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: Number(m[2]) - 1, c: c - 1 };
}

export function parseRef(ref: string): CellRange | null {
  const [a, b = a] = ref.split(":");
  const p = parseCell(a);
  const q = parseCell(b);
  if (!p || !q || p.r < 0 || q.r < 0) return null;
  return normalize({ r1: p.r, c1: p.c, r2: q.r, c2: q.c });
}

export function normalize(g: CellRange): CellRange {
  return { r1: Math.min(g.r1, g.r2), c1: Math.min(g.c1, g.c2), r2: Math.max(g.r1, g.r2), c2: Math.max(g.c1, g.c2) };
}

export function contains(g: CellRange, r: number, c: number): boolean {
  return r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2;
}

function intersects(a: CellRange, b: CellRange): boolean {
  return a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2;
}

/** 結合セルにかかる範囲を、結合セル全体を含むように広げる */
export function expandMerges(g: CellRange, merges: CellRange[]): CellRange {
  let cur = normalize(g);
  for (let changed = true; changed; ) {
    changed = false;
    for (const m of merges) {
      if (!intersects(cur, m)) continue;
      const next = { r1: Math.min(cur.r1, m.r1), c1: Math.min(cur.c1, m.c1), r2: Math.max(cur.r2, m.r2), c2: Math.max(cur.c2, m.c2) };
      if (next.r1 !== cur.r1 || next.c1 !== cur.c1 || next.r2 !== cur.r2 || next.c2 !== cur.c2) {
        cur = next;
        changed = true;
      }
    }
  }
  return cur;
}

// ---------- 値 ----------

export function cellText(sheet: Sheet, r: number, c: number): string {
  return sheet.rows[r]?.[c] ?? "";
}

/** 範囲を Excel からコピーしたときと同じ形（タブ区切り・改行）の文字列にする */
export function rangeText(sheet: Sheet, g: CellRange): string {
  const lines: string[] = [];
  for (let r = g.r1; r <= g.r2; r++) {
    const row: string[] = [];
    for (let c = g.c1; c <= g.c2; c++) row.push(cellText(sheet, r, c));
    lines.push(row.join("\t"));
  }
  return lines.join("\n");
}

/** 範囲の値を、空のセル・空の行を省いて読みやすくした引用文 */
export function rangeQuote(sheet: Sheet, g: CellRange): string {
  const lines: string[] = [];
  for (let r = g.r1; r <= g.r2 && lines.length < 20; r++) {
    const row: string[] = [];
    for (let c = g.c1; c <= g.c2; c++) {
      const v = cellText(sheet, r, c);
      if (v) row.push(v);
    }
    if (row.length) lines.push(row.join(" | "));
  }
  const q = lines.join("\n");
  return q.length > QUOTE_MAX ? q.slice(0, QUOTE_MAX) + "…" : q;
}

interface Labels {
  /** 行ごとの最初の値とその列 */
  rowFirst: ({ c: number; text: string } | null)[];
  /** 列ごとの最初の値とその行 */
  colFirst: ({ r: number; text: string } | null)[];
}

const labelCache = new WeakMap<Sheet, Labels>();

function labels(sheet: Sheet): Labels {
  const hit = labelCache.get(sheet);
  if (hit) return hit;
  const nCols = sheet.rows[0]?.length ?? 0;
  const rowFirst: Labels["rowFirst"] = sheet.rows.map((row) => {
    const c = row.findIndex((v) => v.trim() !== "");
    return c === -1 ? null : { c, text: row[c] };
  });
  const colFirst: Labels["colFirst"] = [];
  for (let c = 0; c < nCols; c++) {
    const r = sheet.rows.findIndex((row) => (row[c] ?? "").trim() !== "");
    colFirst.push(r === -1 ? null : { r, text: sheet.rows[r][c] });
  }
  const l = { rowFirst, colFirst };
  labelCache.set(sheet, l);
  return l;
}

/** 範囲の左上セルから見た行・列の見出し */
export function headersAt(sheet: Sheet, r: number, c: number): { rowHeader?: string; colHeader?: string } {
  return { rowHeader: rowHeaderAt(sheet, r, c), colHeader: colHeaderAt(sheet, r, c) };
}

function rowHeaderAt(sheet: Sheet, r: number, c: number): string | undefined {
  const f = labels(sheet).rowFirst[r];
  return f && f.c < c ? f.text : undefined;
}

function colHeaderAt(sheet: Sheet, r: number, c: number): string | undefined {
  const f = labels(sheet).colFirst[c];
  return f && f.r < r ? f.text : undefined;
}

// ---------- アンカー ----------

export function createCellAnchor(sheet: Sheet, range: CellRange, sourceSha256: string): CellAnchor {
  const g = normalize(range);
  const values: string[][] = [];
  for (let r = g.r1; r <= Math.min(g.r2, g.r1 + VALUES_MAX - 1); r++) {
    const row: string[] = [];
    for (let c = g.c1; c <= Math.min(g.c2, g.c1 + VALUES_MAX - 1); c++) row.push(cellText(sheet, r, c));
    values.push(row);
  }
  return {
    type: "cell",
    sheet: sheet.name,
    ref: formatRef(g),
    quote: rangeQuote(sheet, g),
    values,
    rowHeader: rowHeaderAt(sheet, g.r1, g.c1),
    colHeader: colHeaderAt(sheet, g.r1, g.c1),
    sourceSha256,
  };
}

/** 見出しの表示（例: "人件費 × 4月"） */
export function headerLabel(a: Pick<CellAnchor, "rowHeader" | "colHeader">): string | undefined {
  const parts = [a.rowHeader, a.colHeader].filter((s): s is string => !!s);
  return parts.length ? parts.join(" × ") : undefined;
}

function matchesAt(sheet: Sheet, values: string[][], r: number, c: number): boolean {
  for (let i = 0; i < values.length; i++) {
    for (let j = 0; j < values[i].length; j++) {
      if (cellText(sheet, r + i, c + j) !== values[i][j]) return false;
    }
  }
  return true;
}

function sameRatio(sheet: Sheet, values: string[][], r: number, c: number): number {
  let same = 0;
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    for (let j = 0; j < values[i].length; j++) {
      total++;
      if (cellText(sheet, r + i, c + j) === values[i][j]) same++;
    }
  }
  return total ? same / total : 0;
}

function nearest(list: number[], target: number): number {
  return list.reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best), list[0]);
}

/** 現在のブックでセル範囲アンカーの位置を特定する */
export function resolveCellAnchor(book: SheetBook, anchor: CellAnchor): ResolvedCell {
  const orphan: ResolvedCell = { status: "orphaned", sheet: anchor.sheet, range: { r1: 0, c1: 0, r2: 0, c2: 0 } };
  const orig = parseRef(anchor.ref);
  if (!orig) return orphan;
  const h = orig.r2 - orig.r1;
  const w = orig.c2 - orig.c1;
  const at = (sheet: Sheet, r: number, c: number, status: AnchorStatus): ResolvedCell => ({
    status,
    sheet: sheet.name,
    range: { r1: r, c1: c, r2: r + h, c2: c + w },
  });
  const values = anchor.values ?? [];
  const home = book.sheets.find((s) => s.name === anchor.sheet);

  const headerScore = (sheet: Sheet, r: number, c: number) =>
    (anchor.rowHeader !== undefined && rowHeaderAt(sheet, r, c) === anchor.rowHeader ? 1 : 0) +
    (anchor.colHeader !== undefined && colHeaderAt(sheet, r, c) === anchor.colHeader ? 1 : 0);
  const headerMax = (anchor.rowHeader !== undefined ? 1 : 0) + (anchor.colHeader !== undefined ? 1 : 0);

  // 1. 記録位置に同じ値があり、見出しも一致する
  if (home && matchesAt(home, values, orig.r1, orig.c1) && headerScore(home, orig.r1, orig.c1) === headerMax) {
    return at(home, orig.r1, orig.c1, "ok");
  }

  // 2. 同じ値の並びを探し、見出しが一致して元の位置に近いものを選ぶ（シート名が変わった場合は他のシートも探す）
  const flat = values.flat();
  const firstIdx = flat.findIndex((v) => v.trim() !== "");
  if (firstIdx !== -1) {
    const fi = Math.floor(firstIdx / (values[0]?.length || 1));
    const fj = firstIdx % (values[0]?.length || 1);
    const needle = flat[firstIdx];
    const signature = flat.join("").trim().length;
    let best: { sheet: Sheet; r: number; c: number; score: number; hs: number } | null = null;
    const sheets = home ? [home, ...book.sheets.filter((s) => s !== home)] : book.sheets;
    for (const sheet of sheets) {
      for (let r = 0; r < sheet.rows.length; r++) {
        const row = sheet.rows[r];
        for (let c = 0; c < row.length; c++) {
          if (row[c] !== needle) continue;
          const r0 = r - fi;
          const c0 = c - fj;
          if (r0 < 0 || c0 < 0 || !matchesAt(sheet, values, r0, c0)) continue;
          const hs = headerScore(sheet, r0, c0);
          const dist = Math.abs(r0 - orig.r1) + Math.abs(c0 - orig.c1);
          const score = hs * 1_000_000 - dist - (sheet === home ? 0 : 500_000);
          if (!best || score > best.score) best = { sheet, r: r0, c: c0, score, hs };
        }
      }
    }
    // 短い値（"1" など）はどこにでもあるので、見出しが一致するか、十分に特徴的な値のときだけ採用する
    if (best && (best.hs > 0 || headerMax === 0 || signature >= 4)) {
      const same = best.sheet === home && best.r === orig.r1 && best.c === orig.c1;
      return at(best.sheet, best.r, best.c, same ? "ok" : "moved");
    }
  }

  if (!home) return orphan;

  // 3. 値は変わったが、行・列の見出しが残っていればその交点を指す
  if (headerMax > 0) {
    const lb = labels(home);
    let rows: number[] = [orig.r1];
    let cols: number[] = [orig.c1];
    let ok = true;
    if (anchor.rowHeader !== undefined) {
      rows = lb.rowFirst.flatMap((f, r) => (f && f.text === anchor.rowHeader ? [r] : []));
      ok &&= rows.length > 0;
    }
    if (anchor.colHeader !== undefined) {
      cols = lb.colFirst.flatMap((f, c) => (f && f.text === anchor.colHeader ? [c] : []));
      ok &&= cols.length > 0;
    }
    if (ok) {
      const r = nearest(rows, orig.r1);
      const c = nearest(cols, orig.c1);
      if (headerScore(home, r, c) === headerMax) {
        return at(home, r, c, "fuzzy");
      }
    }
  }

  // 4. 見出しがなくても、記録位置の値が半分以上同じなら一部が書き換わったものとみなす
  if (orig.r1 < home.rows.length && sameRatio(home, values, orig.r1, orig.c1) >= 0.5) {
    return at(home, orig.r1, orig.c1, "fuzzy");
  }

  return orphan;
}
