import type { AnchorLocation } from "./anchor";

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

/** 画面座標の位置にある文字のオフセット */
export function offsetFromPoint(root: Node, x: number, y: number): number | null {
  const caret = document.caretRangeFromPoint?.(x, y);
  if (!caret || !root.contains(caret.startContainer)) return null;
  return offsetOf(root, caret.startContainer, caret.startOffset);
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

/** Range の位置を「段落番号＋直前の見出し」で表す */
export function locateInHtml(root: Element, range: Range): AnchorLocation {
  const node = range.startContainer;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const block = el?.closest("[data-para]") as HTMLElement | null;
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
