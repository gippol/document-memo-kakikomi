import {
  getDocument,
  GlobalWorkerOptions,
  normalizeUnicode,
  TextLayer,
  version,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/**
 * PDF を「ページ画像＋透明な文字の層」の HTML にする（pdf.js）。
 * 見た目はページ画像で再現し、文字の選択・ハイライト・アンカーは文字の層で行う。
 * 文字の入っていない PDF（スキャン画像）は表示できるが、文字は選べない。
 *
 * 文字の層はアンカーに要るので、開くときに全ページ作る。ページ画像は 1 ページ数百 ms かかるので、
 * 表示するページだけ Viewer が images.url() で求める。どちらもキャッシュ（PdfCache）があれば使う。
 *
 * 出力（img の src は Viewer が後から入れる）:
 * <section class="pdf-page" data-page="3" style="--page-w:595;--page-h:842">
 *   <img class="pdf-img" alt="">
 *   <div class="textLayer">…<span>文字</span>…</div>
 * </section>
 */
export interface PdfHtml extends PdfText {
  images: PageImages;
}

/** 文字の層まで（キャッシュに保存する部分） */
export interface PdfText {
  html: string;
  /** 本文テキスト（版の判定に使う。表示テキストと同じく文字の層の文字をつなげたもの） */
  text: string;
  warnings: string[];
  pageCount: number;
}

/** ページ画像。資料を閉じるときに dispose で pdf.js の文書と blob URL を解放する */
export interface PageImages {
  /** ページ画像の blob URL（1 始まりのページ番号）。同じページは 1 度だけ描く */
  url(no: number): Promise<string>;
  dispose(): void;
}

/** 描いた結果の保存先（1 つの PDF の 1 つの版につき 1 つ）。失敗しても資料は開けるよう、呼ぶ側で無視する */
export interface PdfCache {
  /** 無ければ null */
  get(name: string): Promise<ArrayBuffer | null>;
  put(name: string, data: Blob): Promise<void>;
}

/** pdf.js の補助データ（vite.config.ts の pdfjsAssets で dist/pdfjs/ に置く） */
const ASSET_BASE = `${import.meta.env.BASE_URL}pdfjs/`;
/** ページ画像の解像度（1 = 72dpi。拡大表示でもにじまないよう 2 倍の 144dpi 相当で描く） */
const RENDER_SCALE = 2;
/** キャッシュの形式。文字の層の HTML・文字の正規化・ページ画像の描き方を変えたら上げる */
const CACHE_FORMAT = 1;
const TEXT_CACHE = "text.json";

GlobalWorkerOptions.workerSrc = workerUrl;

/** キャッシュのキーに混ぜる値。pdf.js の版や描き方が変わったら、前のキャッシュを使わない */
export function pdfCacheSeed(): string {
  return `pdfjs ${version} / format ${CACHE_FORMAT} / scale ${RENDER_SCALE}`;
}

export interface PageParts {
  no: number;
  /** ページの大きさ（PDF の pt） */
  width: number;
  height: number;
  /** 文字の層の HTML（pdf.js TextLayer の出力。<div class="textLayer"> ごと） */
  textLayerHtml: string;
}

/** ページごとの部品から、表示する HTML を組み立てる */
export function pagesToHtml(pages: PageParts[]): string {
  return pages
    .map(
      (p) =>
        `<section class="pdf-page" data-page="${p.no}" style="--page-w:${p.width};--page-h:${p.height}">` +
        `<img class="pdf-img" alt="" draggable="false">` +
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

async function renderImage(page: PDFPageProxy): Promise<Blob> {
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
  // PNG のまま（WebP は変換の速さがほぼ同じで、JPEG は文字がにじむ）
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("ページを画像にできません");
  return blob;
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

async function buildText(pdf: PDFDocumentProxy): Promise<PdfText> {
  const pages: PageParts[] = [];
  const texts: string[] = [];
  for (let no = 1; no <= pdf.numPages; no++) {
    const page = await pdf.getPage(no);
    const layer = await renderTextLayer(page);
    const [x0, y0, x1, y1] = page.view;
    const rotated = page.rotate % 180 !== 0;
    pages.push({
      no,
      width: rotated ? y1 - y0 : x1 - x0,
      height: rotated ? x1 - x0 : y1 - y0,
      textLayerHtml: layer.html,
    });
    texts.push(layer.text);
    page.cleanup();
  }
  return { html: pagesToHtml(pages), text: texts.join(""), warnings: textWarnings(texts), pageCount: pdf.numPages };
}

/**
 * PDF を開く。文字の層はキャッシュにあればそれを使い、無ければ作って保存する。
 * pdf.js の文書は、文字の層を作るときか、キャッシュに無いページを描くときに初めて開く。
 */
export async function pdfToHtml(data: ArrayBuffer, cache: PdfCache | null = null): Promise<PdfHtml> {
  let task: PDFDocumentLoadingTask | null = null;
  let disposed = false;
  const open = () => {
    if (task) return task.promise;
    const t = (task = getDocument({
      data: new Uint8Array(data),
      // 日本語など、フォントを埋め込んでいない PDF の文字の対応表
      cMapUrl: `${ASSET_BASE}cmaps/`,
      cMapPacked: true,
      // JBIG2・JPEG 2000 の画像と ICC プロファイル
      wasmUrl: `${ASSET_BASE}wasm/`,
      iccUrl: `${ASSET_BASE}iccs/`,
      // 埋め込みの無い標準フォントは同梱せず OS のフォントで代用する（フォントのライセンスを増やさないため）
      useSystemFonts: true,
    }));
    // 開けなかったら、次に描くときに開き直す（一度の失敗でずっと描けなくならないように）
    t.promise.catch(() => {
      if (task === t && !disposed) task = null;
    });
    return t.promise;
  };
  const destroy = () => {
    disposed = true;
    void task?.destroy();
  };

  let parts = cache ? parseTextCache(await cache.get(TEXT_CACHE).catch(() => null)) : null;
  if (!parts) {
    try {
      parts = await buildText(await open());
    } catch (e) {
      destroy();
      throw e;
    }
    void cache?.put(TEXT_CACHE, new Blob([JSON.stringify(parts)], { type: "application/json" })).catch(() => {});
  }
  const images = createPageImages({
    cache,
    async render(no) {
      const page = await (await open()).getPage(no);
      try {
        return await renderImage(page);
      } finally {
        page.cleanup();
      }
    },
    dispose: destroy,
  });
  return { ...parts, images };
}

/** キャッシュの文字の層を読む。形が違えば（壊れている・古い）null */
export function parseTextCache(data: ArrayBuffer | null): PdfText | null {
  if (!data || data.byteLength === 0) return null;
  try {
    const v = JSON.parse(new TextDecoder().decode(data)) as Partial<PdfText>;
    if (
      typeof v.html === "string" &&
      typeof v.text === "string" &&
      typeof v.pageCount === "number" &&
      Array.isArray(v.warnings) &&
      v.warnings.every((w) => typeof w === "string")
    ) {
      return { html: v.html, text: v.text, warnings: v.warnings, pageCount: v.pageCount };
    }
  } catch {
    /* 壊れたキャッシュは使わない */
  }
  return null;
}

type UrlApi = Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;

/**
 * ページ画像を キャッシュ → 描画 の順に用意し、描いたものはキャッシュに保存する。
 * 同じページを同時に求められても 1 度だけ描く。失敗したページは、次に求められたときにやり直す。
 */
export function createPageImages(opts: {
  render(no: number): Promise<Blob>;
  cache?: PdfCache | null;
  dispose?(): void;
  urls?: UrlApi;
}): PageImages {
  const urls = opts.urls ?? URL;
  const made = new Map<number, Promise<string>>();
  const created: string[] = [];
  let disposed = false;

  const load = async (no: number): Promise<string> => {
    const name = `p${no}.png`;
    const hit = await opts.cache?.get(name).catch(() => null);
    let blob: Blob;
    if (hit && hit.byteLength > 0) {
      blob = new Blob([hit], { type: "image/png" });
    } else {
      blob = await opts.render(no);
      if (!disposed) void opts.cache?.put(name, blob).catch(() => {});
    }
    if (disposed) throw new Error("PDF は閉じられました");
    const u = urls.createObjectURL(blob);
    created.push(u);
    return u;
  };

  return {
    url(no) {
      let p = made.get(no);
      if (!p) {
        p = load(no);
        made.set(no, p);
        p.catch(() => made.delete(no));
      }
      return p;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const u of created) urls.revokeObjectURL(u);
      opts.dispose?.();
    },
  };
}
