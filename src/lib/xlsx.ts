import * as XLSX from "xlsx";
import type { CellRange, Sheet, SheetBook } from "./sheet";

/** 表示の上限（これを超える部分は省略する） */
export const MAX_ROWS = 3000;
export const MAX_COLS = 200;
export const MAX_CELLS = 150_000;

export interface XlsxResult {
  book: SheetBook;
  /** 版の判定に使う、シート名とセルの表示値 */
  text: string;
  warnings: string[];
}

/** 日付の組み込み書式（言語で表示が変わるもの）を日本語版 Excel の表示に合わせる */
const LOCALE_FORMATS: Record<string, string> = {
  "m/d/yy": "yyyy/m/d",
  "m/d/yy h:mm": "yyyy/m/d h:mm",
};

/**
 * Excel ファイル（.xlsx / .xlsm / .xls）を表示用のシートに変換する。
 * セルの値は Excel の表示形式（桁区切り・日付など）を適用した文字列。数式は保存時の計算結果を使う。
 */
export function xlsxToBook(data: ArrayBuffer): XlsxResult {
  const wb = XLSX.read(new Uint8Array(data), { type: "array", dense: true, cellStyles: true, cellNF: true, cellHTML: false, cellFormula: false });
  const warnings: string[] = [];
  const sheets: Sheet[] = [];

  wb.SheetNames.forEach((name, i) => {
    if (wb.Workbook?.Sheets?.[i]?.Hidden) {
      warnings.push(`非表示のシート「${name}」は表示していません`);
      return;
    }
    const ws = wb.Sheets[name];
    const dense = (ws["!data"] ?? []) as (XLSX.CellObject | undefined)[][];

    // 値のある最後の行・列まで（!ref は実際より広いことがある）
    let lastR = -1;
    let lastC = -1;
    dense.forEach((row, r) =>
      row?.forEach((cell, c) => {
        if (cell && fmt(cell) !== "") {
          lastR = Math.max(lastR, r);
          lastC = Math.max(lastC, c);
        }
      }),
    );
    const merges: CellRange[] = (ws["!merges"] ?? []).map((m) => ({ r1: m.s.r, c1: m.s.c, r2: m.e.r, c2: m.e.c }));
    for (const m of merges) {
      lastR = Math.max(lastR, m.r2);
      lastC = Math.max(lastC, m.c2);
    }

    let nRows = lastR + 1;
    let nCols = lastC + 1;
    let truncated = false;
    if (nCols > MAX_COLS) {
      nCols = MAX_COLS;
      truncated = true;
    }
    const rowLimit = Math.min(MAX_ROWS, Math.floor(MAX_CELLS / Math.max(nCols, 1)));
    if (nRows > rowLimit) {
      nRows = rowLimit;
      truncated = true;
    }
    if (truncated) warnings.push(`シート「${name}」は大きいため、${nRows} 行 × ${nCols} 列までを表示しています`);

    const rows: string[][] = [];
    const types: string[] = [];
    for (let r = 0; r < nRows; r++) {
      const src = dense[r] ?? [];
      const row: string[] = new Array(nCols);
      let t = "";
      for (let c = 0; c < nCols; c++) {
        const cell = src[c];
        row[c] = cell ? fmt(cell) : "";
        t += cell && (cell.t === "n" || cell.t === "d" || cell.t === "b" || cell.t === "e") ? (cell.t === "d" ? "n" : cell.t) : " ";
      }
      rows.push(row);
      types.push(t);
    }

    const cols = ws["!cols"] ?? [];
    const colWidths = Array.from({ length: nCols }, (_, c) => {
      const ci = cols[c];
      // 非表示の列も、ノートを付けられるよう通常の幅で表示する
      if (!ci || ci.hidden) return undefined;
      return ci.wch ?? (ci.wpx !== undefined ? ci.wpx / 7 : ci.width);
    });

    sheets.push({
      name,
      rows,
      types,
      merges: merges.filter((m) => m.r1 < nRows && m.c1 < nCols).map((m) => ({ ...m, r2: Math.min(m.r2, nRows - 1), c2: Math.min(m.c2, nCols - 1) })),
      colWidths,
      truncated,
    });
  });

  const text = JSON.stringify(sheets.map((s) => [s.name, s.rows]));
  return { book: { sheets }, text, warnings };
}

function fmt(cell: XLSX.CellObject): string {
  const local = cell.t === "n" && typeof cell.z === "string" ? LOCALE_FORMATS[cell.z] : undefined;
  if (local) {
    try {
      return XLSX.SSF.format(local, cell.v as number);
    } catch {
      /* 既定の表示にする */
    }
  }
  if (cell.w !== undefined) return cell.w;
  if (cell.v === undefined || cell.v === null) return "";
  try {
    return XLSX.utils.format_cell(cell);
  } catch {
    return String(cell.v);
  }
}
