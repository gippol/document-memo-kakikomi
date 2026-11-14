// サンプルの Excel 資料 (samples/予算とスケジュール.xlsx) を生成する: node scripts/make-sample-xlsx.mjs
import { writeFileSync } from "node:fs";
import * as XLSX from "xlsx";

const wb = XLSX.utils.book_new();

// 予算: 結合セルの表題・数値の書式・数式（計算結果つき）
const months = ["4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月", "1月", "2月", "3月"];
const items = [
  ["人件費", [1200, 1350, 1350, 1350, 1400, 1400, 1400, 1400, 1450, 1450, 1450, 1450], "5月から1名増員"],
  ["外注費", [800, 800, 600, 600, 600, 400, 400, 400, 400, 200, 200, 200], "段階的に内製化"],
  ["クラウド利用料", [150, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250], "利用者増に比例"],
  ["ライセンス", [90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90], ""],
  ["予備費", [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100], "全体の約5%"],
];
const budget = XLSX.utils.aoa_to_sheet([
  ["2026年度 システム開発 予算案（単位: 千円）"],
  [],
  ["項目", ...months, "合計", "備考"],
  ...items.map(([name, vals, memo]) => [name, ...vals, null, memo]),
  ["合計"],
]);
const fmtNum = "#,##0";
const lastItemRow = 3 + items.length; // 0 始まりの行番号で合計行
for (let i = 0; i < items.length; i++) {
  const r = 3 + i;
  const sum = items[i][1].reduce((a, b) => a + b, 0);
  budget[XLSX.utils.encode_cell({ r, c: 13 })] = { t: "n", v: sum, f: `SUM(B${r + 1}:M${r + 1})`, z: fmtNum };
  for (let c = 1; c <= 12; c++) budget[XLSX.utils.encode_cell({ r, c })].z = fmtNum;
}
for (let c = 1; c <= 13; c++) {
  const v = items.reduce((a, it) => a + (c <= 12 ? it[1][c - 1] : it[1].reduce((x, y) => x + y, 0)), 0);
  const col = XLSX.utils.encode_col(c);
  budget[XLSX.utils.encode_cell({ r: lastItemRow, c })] = { t: "n", v, f: `SUM(${col}4:${col}${lastItemRow})`, z: fmtNum };
}
budget["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastItemRow, c: 14 } });
budget["!merges"] = [XLSX.utils.decode_range("A1:O1")];
budget["!cols"] = [{ wch: 16 }, ...months.map(() => ({ wch: 7 })), { wch: 9 }, { wch: 22 }];
XLSX.utils.book_append_sheet(wb, budget, "予算");

// スケジュール: 日付・長い文章
const d = (s) => new Date(`${s}T00:00:00Z`);
const schedule = XLSX.utils.aoa_to_sheet(
  [
    ["No.", "タスク", "担当", "開始", "終了", "状態", "メモ"],
    [1, "要件定義", "佐藤", d("2026-04-01"), d("2026-04-30"), "完了", "会議資料へのメモを Git で管理したいという要望が中心"],
    [2, "基本設計", "鈴木", d("2026-05-01"), d("2026-06-15"), "完了", ""],
    [3, "Markdown 対応", "高橋", d("2026-06-16"), d("2026-07-31"), "完了", ""],
    [4, "Word 対応", "高橋", d("2026-08-01"), d("2026-09-15"), "進行中", "独自の見出しスタイルは設定ファイルで指定できるようにする"],
    [5, "Excel 対応", "田中", d("2026-09-16"), d("2026-10-31"), "未着手", "セル範囲にノートを付ける。行の挿入に追従すること"],
    [6, "PowerPoint 対応", "未定", d("2026-11-01"), d("2026-12-15"), "未着手", ""],
  ],
  { cellDates: true },
);
schedule["!cols"] = [{ wch: 5 }, { wch: 18 }, { wch: 8 }, { wch: 11 }, { wch: 11 }, { wch: 8 }, { wch: 40 }];
XLSX.utils.book_append_sheet(wb, schedule, "スケジュール");

writeFileSync(new URL("../samples/予算とスケジュール.xlsx", import.meta.url), XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
console.log("samples/予算とスケジュール.xlsx を作成しました");
