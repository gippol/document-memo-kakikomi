// アプリに同梱する JavaScript ライブラリのライセンス表示 THIRD_PARTY_LICENSES.md を作る。
// 依存を追加・更新したら `node scripts/make-third-party-licenses.mjs` で作り直す。
// 対象: npm の本番依存（dependencies とその依存）と、pdf.js の補助データ（vite.config.ts の pdfjsAssets で同梱するもの）。
// Rust のクレート（Tauri など）は対象外。
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.|-|_|$)/i;

/** npm の本番依存のパッケージのディレクトリ（重複なし） */
function prodPackageDirs() {
  const out = execSync("npm ls --omit=dev --all --parseable", { cwd: root, encoding: "utf8" });
  return [...new Set(out.split(/\r?\n/).filter(Boolean))].filter((d) => path.resolve(d) !== root);
}

function licenseTexts(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => LICENSE_FILE.test(f) && fs.statSync(path.join(dir, f)).isFile())
    .sort()
    .map((f) => ({ file: f, text: fs.readFileSync(path.join(dir, f), "utf8").trim() }));
}

function licenseOf(pkg) {
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(" OR ");
  return "UNKNOWN";
}

/** Node.js で動かすときだけ使う依存（pdfjs-dist の @napi-rs/canvas）。アプリには入らない */
const NODE_ONLY = /^@napi-rs\//;

const packages = prodPackageDirs()
  .map((dir) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return { name: pkg.name, version: pkg.version, license: licenseOf(pkg), homepage: pkg.homepage, texts: licenseTexts(dir) };
  })
  .filter((p) => !NODE_ONLY.test(p.name))
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

// 同じ名前・版が別の場所に入っていることがあるので 1 つにまとめる
const unique = packages.filter((p, i) => i === 0 || p.name !== packages[i - 1].name || p.version !== packages[i - 1].version);

/** pdf.js の補助データ（cmaps・wasm・iccs）に付いているライセンス。quickjs は同梱しない */
const PDFJS_ASSETS = [
  ["cmaps/LICENSE", "Adobe CMaps（cmaps/）"],
  ["iccs/LICENSE", "ICC プロファイル（iccs/）"],
  ["wasm/LICENSE_JBIG2", "JBIG2 デコーダ / PDFium（wasm/jbig2）"],
  ["wasm/LICENSE_PDFJS_JBIG2", "JBIG2 デコーダの wasm ビルド（wasm/jbig2）"],
  ["wasm/LICENSE_OPENJPEG", "OpenJPEG（wasm/openjpeg）"],
  ["wasm/LICENSE_PDFJS_OPENJPEG", "OpenJPEG の wasm ビルド（wasm/openjpeg）"],
  ["wasm/LICENSE_QCMS", "qcms（wasm/qcms_bg）"],
  ["wasm/LICENSE_PDFJS_QCMS", "qcms の wasm ビルド（wasm/qcms_bg）"],
];
const pdfjsDir = path.join(root, "node_modules", "pdfjs-dist");

const fence = (text) => {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const f = "`".repeat(longest + 1);
  return `${f}text\n${text}\n${f}`;
};

const lines = [
  "# Third-party licenses",
  "",
  "このアプリに同梱しているライブラリとデータのライセンスです。`node scripts/make-third-party-licenses.mjs` で作っています（手で書き換えないでください）。",
  "",
  "## 一覧",
  "",
  "| パッケージ | 版 | ライセンス |",
  "| --- | --- | --- |",
  ...unique.map((p) => `| ${p.name} | ${p.version} | ${p.license} |`),
  "| pdfjs-dist の補助データ | — | 下記「pdf.js の補助データ」 |",
  "",
  "## ライセンス本文",
  "",
];
for (const p of unique) {
  lines.push(`### ${p.name}@${p.version}`, "", `ライセンス: ${p.license}${p.homepage ? ` ・ ${p.homepage}` : ""}`, "");
  if (p.texts.length === 0) lines.push("（パッケージにライセンス文のファイルがありません。上記のライセンスの標準の条文に従います）", "");
  for (const t of p.texts) lines.push(`${t.file}:`, "", fence(t.text), "");
}
lines.push("## pdf.js の補助データ", "", "pdfjs-dist に含まれ、PDF の表示のためにアプリへ同梱しているデータです。", "");
for (const [rel, label] of PDFJS_ASSETS) {
  lines.push(`### ${label}`, "", fence(fs.readFileSync(path.join(pdfjsDir, rel), "utf8").trim()), "");
}

fs.writeFileSync(path.join(root, "THIRD_PARTY_LICENSES.md"), lines.join("\n"));
console.log(`THIRD_PARTY_LICENSES.md: ${unique.length} packages`);
const unknown = unique.filter((p) => p.license === "UNKNOWN" || p.texts.length === 0);
if (unknown.length) console.log("ライセンス文が見つからないもの:", unknown.map((p) => `${p.name}@${p.version} (${p.license})`).join(", "));
