// samples/週次報告.pdf を作る（Microsoft Edge のヘッドレス印刷で HTML を PDF にする。Windows 用）。
// 使い方: node scripts/make-sample-pdf.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "samples", "週次報告.pdf");

const EDGE = [
  process.env.EDGE_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => p && fs.existsSync(p));
if (!EDGE) {
  console.error("Microsoft Edge が見つかりません（EDGE_PATH で場所を指定できます）");
  process.exit(1);
}

const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>週次報告</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: "Yu Gothic", "Meiryo", sans-serif; font-size: 11pt; line-height: 1.7; color: #222; }
  h1 { font-size: 20pt; border-bottom: 2px solid #335; padding-bottom: 4px; }
  h2 { font-size: 14pt; color: #335; margin-top: 1.4em; }
  table { border-collapse: collapse; width: 100%; margin: 0.6em 0; }
  th, td { border: 1px solid #999; padding: 4px 8px; text-align: left; }
  th { background: #e8ecf4; }
  .page2 { break-before: page; }
  .note { font-size: 9pt; color: #666; }
</style></head>
<body>
  <h1>週次報告（11月第4週）</h1>
  <p>作成: 企画チーム ／ 対象期間: 11月17日〜11月21日</p>

  <h2>1. 今週の進捗</h2>
  <ul>
    <li>新しい申込フォームの試作を終え、社内の 5 名に試してもらった。</li>
    <li>入力にかかる時間は平均 3 分 20 秒から 2 分 10 秒に短くなった。</li>
    <li>スマートフォンで日付の入力欄が小さいという意見が 3 件あった。</li>
  </ul>

  <h2>2. 指標</h2>
  <table>
    <tr><th>項目</th><th>先週</th><th>今週</th><th>目標</th></tr>
    <tr><td>申込数</td><td>128</td><td>141</td><td>150</td></tr>
    <tr><td>途中離脱率</td><td>34%</td><td>27%</td><td>20%</td></tr>
    <tr><td>問い合わせ件数</td><td>22</td><td>19</td><td>15</td></tr>
  </table>

  <svg width="420" height="150" viewBox="0 0 420 150" role="img">
    <rect x="0" y="0" width="420" height="150" fill="#f7f8fb" stroke="#ccd"/>
    <text x="12" y="22" font-size="12" fill="#335">途中離脱率の推移</text>
    <polyline points="40,40 120,62 200,78 280,96 360,112" fill="none" stroke="#e8a33d" stroke-width="3"/>
    <g font-size="10" fill="#666">
      <text x="30" y="140">10/27</text><text x="110" y="140">11/3</text><text x="190" y="140">11/10</text>
      <text x="270" y="140">11/17</text><text x="350" y="140">11/24</text>
    </g>
  </svg>
  <p class="note">※ 途中離脱率は、フォームを開いた人のうち送信しなかった人の割合。</p>

  <div class="page2">
    <h2>3. 課題と相談したいこと</h2>
    <ol>
      <li>日付の入力欄をカレンダー選択にするか、手入力のまま大きくするか決めたい。</li>
      <li>確認メールの文面を、問い合わせの多い「キャンセル方法」がわかる内容にしたい。</li>
      <li>12 月の公開に向けて、法務の確認をいつまでに依頼するか決めたい。</li>
    </ol>

    <h2>4. 来週の予定</h2>
    <table>
      <tr><th>作業</th><th>担当</th><th>期限</th></tr>
      <tr><td>日付入力の改善案を 2 つ作る</td><td>佐藤</td><td>11/26</td></tr>
      <tr><td>確認メールの文面を見直す</td><td>鈴木</td><td>11/27</td></tr>
      <tr><td>公開前チェックリストを作る</td><td>田中</td><td>11/28</td></tr>
    </table>
    <p>次回の定例は 12 月 1 日（月）10:00 から。</p>
  </div>
</body></html>`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sample-pdf-"));
const src = path.join(dir, "weekly.html");
fs.writeFileSync(src, html);
execFileSync(EDGE, [
  "--headless",
  "--disable-gpu",
  "--no-pdf-header-footer",
  `--user-data-dir=${path.join(dir, "profile")}`,
  `--print-to-pdf=${out}`,
  `file:///${src.replaceAll("\\", "/")}`,
]);
fs.rmSync(dir, { recursive: true, force: true });
console.log(`wrote ${path.relative(root, out)}`);
