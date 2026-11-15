import { api } from "./api";
import { sha256Hex } from "./hash";
import type { HeadingOverrides } from "./docx";
import type { SheetBook } from "./sheet";

/**
 * 表示用に読み込んだ資料。
 * sha256 は「この版の資料に対するメモか」を判定するための値。
 * - Markdown: ファイルそのもののハッシュ
 * - Word: 本文テキストのハッシュ（Word は内容が同じでも保存のたびに ZIP の中身が変わるため。
 *   見出し設定の変更や書式だけの変更でもノートが「旧版」扱いにならない）
 * - Excel: シート名とセルの表示値のハッシュ（Word と同じ理由。書式だけの変更では旧版扱いにならない）
 * - PowerPoint: スライドの文字（発表者ノートを含む）のハッシュ（Word と同じ理由）
 */
export type LoadedDoc =
  | { kind: "markdown"; content: string; sha256: string }
  | { kind: "docx"; html: string; sha256: string; warnings: string[]; headingStyles: Record<string, number> }
  | { kind: "xlsx"; book: SheetBook; sha256: string; warnings: string[] }
  | { kind: "pptx"; html: string; sha256: string; warnings: string[]; slideCount: number };

/** テキストとして表示する資料（Markdown / Word / PowerPoint） */
export type TextDoc = Exclude<LoadedDoc, { kind: "xlsx" }>;

export interface LoadOptions {
  docxHeadings?: HeadingOverrides;
}

export type DocKind = LoadedDoc["kind"];

export function docKind(path: string): DocKind | null {
  if (/\.(md|markdown)$/i.test(path)) return "markdown";
  if (/\.docx$/i.test(path)) return "docx";
  if (/\.(xlsx|xlsm|xls)$/i.test(path)) return "xlsx";
  if (/\.pptx$/i.test(path)) return "pptx";
  return null;
}

async function loadOnce(root: string, path: string, opts: LoadOptions): Promise<LoadedDoc> {
  const kind = docKind(path);
  if (kind === "markdown") {
    const { content, sha256 } = await api.readDocument(root, path);
    return { kind, content, sha256 };
  }
  if (kind === "docx") {
    const bytes = await api.readDocumentBytes(root, path);
    // mammoth は大きいので Word を開くときだけ読み込む
    const { docxToHtml } = await import("./docx");
    let converted;
    try {
      converted = await docxToHtml(bytes, opts.docxHeadings);
    } catch (e) {
      throw new Error(`Word ファイルを解析できません（${e instanceof Error ? e.message : e}）`);
    }
    return {
      kind,
      html: converted.html,
      warnings: converted.warnings,
      headingStyles: converted.headingStyles,
      sha256: await sha256Hex(converted.text),
    };
  }
  if (kind === "xlsx") {
    const bytes = await api.readDocumentBytes(root, path);
    // SheetJS も大きいので Excel を開くときだけ読み込む
    const { xlsxToBook } = await import("./xlsx");
    let converted;
    try {
      converted = xlsxToBook(bytes);
    } catch (e) {
      throw new Error(`Excel ファイルを解析できません（${e instanceof Error ? e.message : e}）`);
    }
    return { kind, book: converted.book, warnings: converted.warnings, sha256: await sha256Hex(converted.text) };
  }
  if (kind === "pptx") {
    const bytes = await api.readDocumentBytes(root, path);
    const { pptxToHtml } = await import("./pptx");
    let converted;
    try {
      converted = await pptxToHtml(bytes);
    } catch (e) {
      throw new Error(`PowerPoint ファイルを解析できません（${e instanceof Error ? e.message : e}）`);
    }
    return {
      kind,
      html: converted.html,
      warnings: converted.warnings,
      slideCount: converted.slideCount,
      sha256: await sha256Hex(converted.text),
    };
  }
  throw new Error(`未対応の形式です: ${path}`);
}

/**
 * 資料を読み込む。Word などは保存中に一瞬ファイルが消えたりロックされたりするため、少し待って再試行する。
 */
export async function loadDocument(root: string, path: string, opts: LoadOptions = {}, retries = 3): Promise<LoadedDoc> {
  for (let i = 0; ; i++) {
    try {
      return await loadOnce(root, path, opts);
    } catch (e) {
      if (i >= retries) throw e;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}
