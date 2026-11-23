import { getDocument, GlobalWorkerOptions, normalizeUnicode, TextLayer, type PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/**
 * PDF を「ページ画像＋透明な文字の層」の HTML にする（pdf.js）。
 * 見た目はページ画像で再現し、文字の選択・ハイライト・アンカーは文字の層で行う。
 * 文字の入っていない PDF（スキャン画像）は表示できるが、文字は選べない。
 *
 * 出力:
 * <section class="pdf-page" data-page="3" style="--page-w:595;--page-h:842">
 *   <img class="pdf-img" src="blob:…" alt="">
 *   <div class="textLayer">…<span>文字</span>…</div>
 * </section>
 */
export interface PdfHtml {
  html: string;
  /** 本文テキスト（版の判定に使う。表示テキストと同じく文字の層の文字をつなげたもの） */
  text: string;
  warnings: string[];
  pageCount: number;
  /** ページ画像の blob URL。資料を閉じるときに revokePdfUrls で解放する */
  urls: string[];
}

/** pdf.js の補助データ（vite.config.ts の pdfjsAssets で dist/pdfjs/ に置く） */
const ASSET_BASE = `${import.meta.env.BASE_URL}pdfjs/`;
/** ページ画像の解像度（1 = 72dpi。拡大表示でもにじまないよう 2 倍の 144dpi 相当で描く） */
const RENDER_SCALE = 2;

GlobalWorkerOptions.workerSrc = workerUrl;

export interface PageParts {
  no: number;
  /** ページの大きさ（PDF の pt） */
  width: number;
  height: number;
  imgUrl: string;
  /** 文字の層の HTML（pdf.js TextLayer の出力。<div class="textLayer"> ごと） */
  textLayerHtml: string;
}

/** ページごとの部品から、表示する HTML を組み立てる */
export function pagesToHtml(pages: PageParts[]): string {
  return pages
    .map(
      (p) =>
        `<section class="pdf-page" data-page="${p.no}" style="--page-w:${p.width};--page-h:${p.height}">` +
        `<img class="pdf-img" src="${p.imgUrl}" alt="" draggable="false">` +
        p.textLayerHtml +
        `</section>`,
    )
    .join("");
}

/** 文字の無いページについての警告 */
export function textWarnings(pageTexts: string[]): string[] {
  const empty = pageTexts.flatMap((t, i) => (t.trim() ? [] : [i + 1]));
  if (empty.length === 0) return [];
  if (empty.length === pageTexts.length) return ["文字の入っていない PDF です（スキャン画像など）。表示はできますが、文字を選んでノートを付けることはできません（全体メモは付けられます）"];
  const list = empty.length > 10 ? `${empty.slice(0, 10).join(", ")} ほか` : empty.join(", ");
  return [`文字の無いページがあります（p.${list}）。そのページでは文字を選べません`];
}

/** 康熙部首・CJK 部首補助（U+2E80〜U+2FDF） */
const RADICALS = /[⺀-⿟]+/gu;

/**
 * 取り出した文字を普通の文字に直す。
 * フォントによっては「月」「日」が康熙部首（⽉⽇）として取り出され、検索や議事録の引用で別の文字になってしまう。
 * pdf.js のビューアーが検索・コピーで行う正規化（合字など）に、部首の NFKC を加えたもの。字形は同じなので文字の位置はずれない。
 */
export function normalizePdfText(s: string): string {
  return (normalizeUnicode(s) as string).replace(RADICALS, (m) => m.normalize("NFKC"));
}

async function renderImage(page: PDFPageProxy): Promise<string> {
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  // 不透明な canvas（pdf.js の既定）だと WebView2 が文字をサブピクセル（ClearType）で描き、縮小表示で数字が青っぽくにじむ。
  // 透明ありの canvas を渡してグレーのアンチエイリアスで描かせる（背景は pdf.js が白で塗る）
  const canvasContext = canvas.getContext("2d", { alpha: true });
  if (!canvasContext) throw new Error("canvas を使えません");
  // canvas を渡すと pdf.js は canvasContext を使わず自分で不透明の context を作るので、null にする
  await page.render({ canvas: null, canvasContext, viewport }).promise;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("ページを画像にできません");
  return URL.createObjectURL(blob);
}

async function renderTextLayer(page: PDFPageProxy): Promise<{ html: string; text: string }> {
  // 文字の位置はページに対する割合（%）で出るので、表示倍率は CSS（--total-scale-factor）で変えられる
  const container = document.createElement("div");
  container.className = "textLayer";
  const layer = new TextLayer({
    textContentSource: await page.getTextContent(),
    container,
    viewport: page.getViewport({ scale: 1 }),
  });
  await layer.render();
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    const norm = normalizePdfText(t.data);
    if (norm !== t.data) t.data = norm;
  }
  // pdf.js は文字の大きさの補正値（--min-font-size）を container に書くので、container ごと使う
  return { html: container.outerHTML, text: container.textContent ?? "" };
}

export async function pdfToHtml(data: ArrayBuffer): Promise<PdfHtml> {
  const task = getDocument({
    data: new Uint8Array(data),
    // 日本語など、フォントを埋め込んでいない PDF の文字の対応表
    cMapUrl: `${ASSET_BASE}cmaps/`,
    cMapPacked: true,
    // JBIG2・JPEG 2000 の画像と ICC プロファイル
    wasmUrl: `${ASSET_BASE}wasm/`,
    iccUrl: `${ASSET_BASE}iccs/`,
    // 埋め込みの無い標準フォントは同梱せず OS のフォントで代用する（フォントのライセンスを増やさないため）
    useSystemFonts: true,
  });
  const pdf = await task.promise;
  const urls: string[] = [];
  try {
    const pages: PageParts[] = [];
    const texts: string[] = [];
    for (let no = 1; no <= pdf.numPages; no++) {
      const page = await pdf.getPage(no);
      const [imgUrl, layer] = await Promise.all([renderImage(page), renderTextLayer(page)]);
      urls.push(imgUrl);
      const [x0, y0, x1, y1] = page.view;
      const rotated = page.rotate % 180 !== 0;
      pages.push({
        no,
        width: rotated ? y1 - y0 : x1 - x0,
        height: rotated ? x1 - x0 : y1 - y0,
        imgUrl,
        textLayerHtml: layer.html,
      });
      texts.push(layer.text);
      page.cleanup();
    }
    return { html: pagesToHtml(pages), text: texts.join(""), warnings: textWarnings(texts), pageCount: pdf.numPages, urls };
  } catch (e) {
    revokePdfUrls(urls);
    throw e;
  } finally {
    void task.destroy();
  }
}

export function revokePdfUrls(urls: string[]): void {
  for (const u of urls) URL.revokeObjectURL(u);
}
