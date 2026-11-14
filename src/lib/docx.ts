import DOMPurify from "dompurify";
import JSZip from "jszip";
import mammoth from "mammoth";

export interface DocxHtml {
  html: string;
  /** 本文テキスト（版の判定に使う） */
  text: string;
  /** 変換できなかった要素などの警告（表示用） */
  warnings: string[];
  /** 見出しとして扱ったスタイル（スタイル名 → レベル） */
  headingStyles: Record<string, number>;
}

/**
 * 見出しスタイルの指定。スタイル名 → 見出しレベル (1〜6)。
 * 0 を指定すると、自動判定で見出しになったスタイルを普通の段落に戻す。
 */
export type HeadingOverrides = Record<string, number>;

/** mammoth が標準では変換しない Word 組み込みスタイルの対応表 */
const BASE_STYLE_MAP = [
  "p[style-name='Title'] => h1.doc-title:fresh",
  "p[style-name='Subtitle'] => p.doc-subtitle:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
];

const BLOCK_SELECTOR = "p,h1,h2,h3,h4,h5,h6,li";
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function wVal(el: Element | undefined | null): string | null {
  if (!el) return null;
  return el.getAttributeNS(W_NS, "val") ?? el.getAttribute("w:val");
}

function child(el: Element, localName: string): Element | undefined {
  return Array.from(el.children).find((c) => c.localName === localName);
}

/**
 * styles.xml からアウトラインレベルを持つ段落スタイルを探し、見出しレベルを返す。
 * 基準スタイル（basedOn）から引き継いだアウトラインレベルも考慮する。
 * Word 組み込みの「見出し 1〜9」は mammoth が標準で変換するので除く。
 */
export function detectHeadingStyles(stylesXml: string): Record<string, number> {
  const xml = new DOMParser().parseFromString(stylesXml, "application/xml");
  const styles = new Map<string, { name: string; basedOn: string | null; outline: number | null }>();
  for (const s of Array.from(xml.getElementsByTagNameNS(W_NS, "style"))) {
    if ((s.getAttributeNS(W_NS, "type") ?? s.getAttribute("w:type")) !== "paragraph") continue;
    const id = s.getAttributeNS(W_NS, "styleId") ?? s.getAttribute("w:styleId");
    const name = wVal(child(s, "name"));
    if (!id || !name) continue;
    const pPr = child(s, "pPr");
    const lvl = wVal(pPr && child(pPr, "outlineLvl"));
    styles.set(id, { name, basedOn: wVal(child(s, "basedOn")), outline: lvl === null ? null : Number(lvl) });
  }

  const outlineOf = (id: string): number | null => {
    const seen = new Set<string>();
    let cur: string | null = id;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const st = styles.get(cur);
      if (!st) return null;
      if (st.outline !== null) return st.outline;
      cur = st.basedOn;
    }
    return null;
  };

  const out: Record<string, number> = {};
  for (const [id, st] of styles) {
    if (/^heading [1-9]$/i.test(st.name)) continue;
    const lvl = outlineOf(id);
    // outlineLvl は 0 始まり。9 は「本文」
    if (lvl !== null && Number.isInteger(lvl) && lvl >= 0 && lvl <= 8) out[st.name] = Math.min(lvl + 1, 6);
  }
  return out;
}

/** mammoth の style-name は単引用符で囲むので、扱えない文字を含む名前は除外する */
function styleRule(name: string, level: number): string | null {
  if (/['\\\n]/.test(name)) return null;
  return level === 0 ? `p[style-name='${name}'] => p:fresh` : `p[style-name='${name}'] => h${level}:fresh`;
}

async function readStylesXml(data: ArrayBuffer): Promise<string | null> {
  try {
    const zip = await JSZip.loadAsync(data);
    return (await zip.file("word/styles.xml")?.async("string")) ?? null;
  } catch {
    return null;
  }
}

/**
 * .docx を表示用 HTML に変換する。
 * - 見出しスタイルを自動判定（アウトラインレベル）＋ 設定ファイルの指定で上書き
 * - mammoth で構造（見出し・段落・リスト・表・画像）だけを HTML 化
 * - DOMPurify で無害化
 * - 段落ごとに data-para（文書内の通し番号）を付与
 */
export async function docxToHtml(data: ArrayBuffer, overrides: HeadingOverrides = {}): Promise<DocxHtml> {
  const stylesXml = await readStylesXml(data);
  const merged: Record<string, number> = { ...(stylesXml ? detectHeadingStyles(stylesXml) : {}), ...overrides };
  const headingRules = Object.entries(merged)
    .map(([name, lvl]) => styleRule(name, lvl))
    .filter((r): r is string => r !== null);

  const result = await mammoth.convertToHtml(
    { arrayBuffer: data, buffer: data },
    { styleMap: [...headingRules, ...BASE_STYLE_MAP] },
  );
  const tpl = document.createElement("template");
  tpl.innerHTML = DOMPurify.sanitize(result.value);
  let i = 0;
  tpl.content.querySelectorAll(BLOCK_SELECTOR).forEach((el) => el.setAttribute("data-para", String(++i)));

  return {
    html: tpl.innerHTML,
    text: tpl.content.textContent ?? "",
    warnings: result.messages.filter((m) => m.type === "warning").map((m) => m.message),
    headingStyles: Object.fromEntries(Object.entries(merged).filter(([, l]) => l > 0)),
  };
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
