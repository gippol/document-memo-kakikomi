import DOMPurify from "dompurify";
import mammoth from "mammoth";

export interface DocxHtml {
  html: string;
  /** 変換できなかった要素などの警告（表示用） */
  warnings: string[];
}

/** mammoth が標準では変換しない Word 組み込みスタイルの対応表 */
const STYLE_MAP = [
  "p[style-name='Title'] => h1.doc-title:fresh",
  "p[style-name='Subtitle'] => p.doc-subtitle:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
];

const BLOCK_SELECTOR = "p,h1,h2,h3,h4,h5,h6,li";

/**
 * .docx を表示用 HTML に変換する。
 * - mammoth で構造（見出し・段落・リスト・表・画像）だけを HTML 化
 * - DOMPurify で無害化
 * - 段落ごとに data-para（文書内の通し番号）を付与
 */
export async function docxToHtml(data: ArrayBuffer): Promise<DocxHtml> {
  const result = await mammoth.convertToHtml({ arrayBuffer: data, buffer: data }, { styleMap: STYLE_MAP });
  const clean = DOMPurify.sanitize(result.value);
  return {
    html: numberBlocks(clean),
    warnings: result.messages.filter((m) => m.type === "warning").map((m) => m.message),
  };
}

export function numberBlocks(html: string): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  let i = 0;
  tpl.content.querySelectorAll(BLOCK_SELECTOR).forEach((el) => el.setAttribute("data-para", String(++i)));
  return tpl.innerHTML;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
