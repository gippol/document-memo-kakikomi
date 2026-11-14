import { api } from "./api";

/**
 * 表示用に読み込んだ資料。
 * sha256 は「この版の資料に対するメモか」を判定するための値。
 * - Markdown: ファイルそのもののハッシュ
 * - Word: 変換後 HTML のハッシュ（Word は内容が同じでも保存のたびに ZIP の中身が変わるため）
 */
export type LoadedDoc =
  | { kind: "markdown"; content: string; sha256: string }
  | { kind: "docx"; html: string; sha256: string; warnings: string[] };

export type DocKind = LoadedDoc["kind"];

export function docKind(path: string): DocKind | null {
  if (/\.(md|markdown)$/i.test(path)) return "markdown";
  if (/\.docx$/i.test(path)) return "docx";
  return null;
}

async function loadOnce(root: string, path: string): Promise<LoadedDoc> {
  const kind = docKind(path);
  if (kind === "markdown") {
    const { content, sha256 } = await api.readDocument(root, path);
    return { kind, content, sha256 };
  }
  if (kind === "docx") {
    const bytes = await api.readDocumentBytes(root, path);
    // mammoth は大きいので Word を開くときだけ読み込む
    const { docxToHtml, sha256Hex } = await import("./docx");
    let converted;
    try {
      converted = await docxToHtml(bytes);
    } catch (e) {
      throw new Error(`Word ファイルを解析できません（${e instanceof Error ? e.message : e}）`);
    }
    return { kind, html: converted.html, warnings: converted.warnings, sha256: await sha256Hex(converted.html) };
  }
  throw new Error(`未対応の形式です: ${path}`);
}

/**
 * 資料を読み込む。Word などは保存中に一瞬ファイルが消えたりロックされたりするため、少し待って再試行する。
 */
export async function loadDocument(root: string, path: string, retries = 3): Promise<LoadedDoc> {
  for (let i = 0; ; i++) {
    try {
      return await loadOnce(root, path);
    } catch (e) {
      if (i >= retries) throw e;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}
