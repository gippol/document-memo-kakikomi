import type { AnchorLocation, Scope } from "./anchor";
import type { HeadingSpan } from "./place";

/** 表示 DOM ⇔ テキストオフセットの変換ヘルパー */

/** コンテナ内のプレーンテキスト（テキストノードの連結）。アンカーの基準テキスト */
export function containerText(root: Node): string {
  const r = document.createRange();
  r.selectNodeContents(root);
  return r.toString();
}

/** コンテナ先頭から (node, offset) までの文字数 */
export function offsetOf(root: Node, node: Node, offset: number): number {
  const r = document.createRange();
  r.setStart(root, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}

/** テキストオフセット範囲から DOM Range を作る */
export function rangeFromOffsets(root: Node, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let startNode: Text | null = null;
  let startOff = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = node as Text;
    const len = t.data.length;
    if (!startNode && start < pos + len) {
      startNode = t;
      startOff = start - pos;
    }
    if (startNode && end <= pos + len) {
      const r = document.createRange();
      r.setStart(startNode, startOff);
      r.setEnd(t, end - pos);
      return r;
    }
    pos += len;
  }
  return null;
}

/**
 * コンテナ内のテキストノードと、それぞれの開始オフセットの表。
 * 描画のたびに 1 回作れば、オフセット ⇔ DOM 位置の変換を全文を走査せずに（二分探索で）行える。
 * 結果は containerText / offsetOf / rangeFromOffsets と同じ。DOM のテキストが変わったら作り直すこと。
 */
export class TextIndex {
  /** アンカーの基準テキスト（containerText と同じ） */
  readonly text: string;
  private readonly nodes: Text[] = [];
  /** nodes[i] の終了オフセット（単調非減少） */
  private readonly ends: number[] = [];
  private readonly indexOf = new Map<Node, number>();

  constructor(private readonly root: Node) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    let pos = 0;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const t = node as Text;
      this.indexOf.set(t, this.nodes.length);
      this.nodes.push(t);
      parts.push(t.data);
      pos += t.data.length;
      this.ends.push(pos);
    }
    this.text = parts.join("");
  }

  private start(i: number): number {
    return i === 0 ? 0 : this.ends[i - 1];
  }

  /** ends[i] が pred を満たす最初の i（無ければ nodes.length） */
  private firstEnd(pred: (end: number) => boolean, lo = 0): number {
    let hi = this.nodes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pred(this.ends[mid])) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  /** テキストオフセット範囲 [start, end) の DOM Range（rangeFromOffsets と同じ） */
  rangeAt(start: number, end: number): Range | null {
    const si = this.firstEnd((e) => e > start);
    if (si >= this.nodes.length) return null;
    const ei = this.firstEnd((e) => e >= end, si);
    if (ei >= this.nodes.length) return null;
    const r = document.createRange();
    r.setStart(this.nodes[si], start - this.start(si));
    r.setEnd(this.nodes[ei], end - this.start(ei));
    return r;
  }

  /** コンテナ先頭から (node, offset) までの文字数（offsetOf と同じ） */
  offsetOf(node: Node, offset: number): number {
    const i = this.indexOf.get(node);
    if (i !== undefined) return this.start(i) + offset;
    // 要素の境界（例: 段落ごと選択したとき）: 境界より後ろにある最初のテキストノードの開始位置
    const at = document.createRange();
    at.setStart(node, offset);
    let lo = 0;
    let hi = this.nodes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (at.comparePoint(this.nodes[mid], 0) >= 0) hi = mid;
      else lo = mid + 1;
    }
    return lo < this.nodes.length ? this.start(lo) : this.text.length;
  }

  /** 画面座標の位置にある文字のオフセット */
  offsetFromPoint(x: number, y: number): number | null {
    const caret = document.caretRangeFromPoint?.(x, y);
    if (!caret || !this.root.contains(caret.startContainer)) return null;
    return this.offsetOf(caret.startContainer, caret.startOffset);
  }
}

function lineAttr(node: Node, attr: "sl" | "el"): number | undefined {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const hit = el?.closest(`[data-${attr}]`) as HTMLElement | null;
  const v = hit?.dataset[attr];
  return v ? Number(v) : undefined;
}

/** Range が元 Markdown のどの行にあたるか */
export function linesOfRange(range: Range): { lineStart?: number; lineEnd?: number } {
  return {
    lineStart: lineAttr(range.startContainer, "sl"),
    lineEnd: lineAttr(range.endContainer, "el") ?? lineAttr(range.endContainer, "sl"),
  };
}

/** PowerPoint のスライドがテキスト上で占める範囲 */
export interface SlideSpan extends Scope {
  /** スライド番号（1 始まり） */
  no: number;
  id: number;
  title: string;
  hidden: boolean;
}

export function slideSpans(root: Element, index: Pick<TextIndex, "offsetOf"> = { offsetOf: (n, o) => offsetOf(root, n, o) }): SlideSpan[] {
  return Array.from(root.querySelectorAll<HTMLElement>("section[data-slide]")).map((s) => ({
    no: Number(s.dataset.slide),
    id: Number(s.dataset.slideId),
    title: s.dataset.title ?? "",
    hidden: s.hasAttribute("data-hidden"),
    start: index.offsetOf(s, 0),
    end: index.offsetOf(s, s.childNodes.length),
  }));
}

/** PDF のページがテキスト上で占める範囲 */
export interface PageSpan extends Scope {
  /** ページ番号（1 始まり） */
  no: number;
}

export function pageSpans(root: Element, index: Pick<TextIndex, "offsetOf"> = { offsetOf: (n, o) => offsetOf(root, n, o) }): PageSpan[] {
  return Array.from(root.querySelectorAll<HTMLElement>("section[data-page]")).map((s) => ({
    no: Number(s.dataset.page),
    start: index.offsetOf(s, 0),
    end: index.offsetOf(s, s.childNodes.length),
  }));
}

/** 見出し（h1〜h6）の文言と表示テキスト上の位置。文言は locateInHtml の heading と同じく 60 文字まで */
export function headingSpans(root: Element, index: Pick<TextIndex, "offsetOf"> = { offsetOf: (n, o) => offsetOf(root, n, o) }): HeadingSpan[] {
  return headingElements(root).map((h) => ({
    text: h.textContent!.trim().slice(0, 60),
    level: Number(h.tagName[1]),
    start: index.offsetOf(h, 0),
  }));
}

/** 文言のある見出しの要素（文書の順）。headingSpans と同じ並びなので、番号で対応が取れる */
export function headingElements(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")).filter((h) => h.textContent?.trim());
}

/** Range の位置を「段落番号＋直前の見出し」で表す（PowerPoint は「スライド番号＋そのタイトル」） */
export function locateInHtml(root: Element, range: Range): AnchorLocation {
  const node = range.startContainer;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const block = el?.closest("[data-para]") as HTMLElement | null;
  const slide = el?.closest("section[data-slide]") as HTMLElement | null;
  const page = el?.closest("section[data-page]") as HTMLElement | null;
  // PDF は見出しや段落の構造を持たないので、ページ番号だけで表す
  if (page) return { page: Number(page.dataset.page) };
  if (slide) {
    const title = slide.dataset.title || `スライド ${slide.dataset.slide}`;
    return {
      paragraph: block ? Number(block.dataset.para) : undefined,
      heading: (el?.closest(".slide-notes") ? `${title}（発表者ノート）` : title).slice(0, 60),
      slide: Number(slide.dataset.slide),
      slideId: Number(slide.dataset.slideId) || undefined,
    };
  }
  let heading: string | undefined;
  for (const h of root.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
    const precedes = h.contains(node) || h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING;
    if (!precedes) break;
    heading = h.textContent?.trim();
  }
  return {
    paragraph: block ? Number(block.dataset.para) : undefined,
    heading: heading ? heading.slice(0, 60) : undefined,
  };
}
