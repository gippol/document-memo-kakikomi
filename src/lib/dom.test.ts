// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { containerText, linesOfRange, offsetOf, rangeFromOffsets, slideSpans, TextIndex } from "./dom";

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe("dom helpers", () => {
  it("オフセット ⇔ Range が往復できる", () => {
    const root = mount('<h1 data-sl="1" data-el="1">仕様</h1>\n<p data-sl="3" data-el="4">これは<strong>重要</strong>な仕様です</p>');
    const text = containerText(root);
    const start = text.indexOf("重要な仕様");
    const end = start + "重要な仕様".length;
    const r = rangeFromOffsets(root, start, end)!;
    expect(r.toString()).toBe("重要な仕様");
    expect(offsetOf(root, r.startContainer, r.startOffset)).toBe(start);
    expect(offsetOf(root, r.endContainer, r.endOffset)).toBe(end);
    expect(linesOfRange(r)).toEqual({ lineStart: 3, lineEnd: 4 });
  });
});

describe("TextIndex", () => {
  const HTML =
    '<section data-slide="1" data-slide-id="7"><h1>表紙</h1><p>あ<em>い</em>う</p></section>' +
    '<section data-slide="2" data-slide-id="9"><p></p><p>えお<b><i>か</i></b></p><ul><li>き</li><li>くけ</li></ul></section>';

  it("全文・Range・オフセットが従来の関数と同じ結果になる", () => {
    const root = mount(HTML);
    // 空のテキストノードも混ぜる
    root.querySelector("p")!.appendChild(document.createTextNode(""));
    const index = new TextIndex(root);
    const text = containerText(root);
    expect(index.text).toBe(text);

    for (let s = 0; s <= text.length; s++) {
      for (let e = s; e <= text.length; e++) {
        const slow = rangeFromOffsets(root, s, e);
        const fast = index.rangeAt(s, e);
        expect(fast?.toString(), `${s}-${e}`).toBe(slow?.toString());
        if (slow && fast) {
          expect([fast.startContainer, fast.startOffset, fast.endContainer, fast.endOffset]).toEqual([
            slow.startContainer,
            slow.startOffset,
            slow.endContainer,
            slow.endOffset,
          ]);
        }
      }
    }
    expect(index.rangeAt(text.length + 1, text.length + 2)).toBeNull();
  });

  it("要素の境界を含め、すべての位置で offsetOf が従来と同じ", () => {
    const root = mount(HTML);
    const index = new TextIndex(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
    let node: Node | null = root;
    while (node) {
      const max = node.nodeType === Node.TEXT_NODE ? (node as Text).data.length : node.childNodes.length;
      for (let o = 0; o <= max; o++) {
        expect(index.offsetOf(node, o), `${node.nodeName}:${o}`).toBe(offsetOf(root, node, o));
      }
      node = walker.nextNode();
    }
  });

  it("スライドの範囲を索引から求められる", () => {
    const root = mount(HTML);
    expect(slideSpans(root, new TextIndex(root))).toEqual(slideSpans(root));
  });

  it("大きな資料でもハイライトの Range 作成が全文走査より速い", () => {
    const para = "<p>これは性能確認用の段落です。<strong>強調</strong>と<em>斜体</em>を含みます。</p>";
    const root = mount(para.repeat(5000));
    const text = containerText(root);
    const spans = Array.from({ length: 500 }, (_, i) => {
      const s = Math.floor((text.length - 10) * (i / 500));
      return [s, s + 8] as const;
    });

    let t = performance.now();
    for (const [s, e] of spans) rangeFromOffsets(root, s, e);
    const slow = performance.now() - t;

    t = performance.now();
    const index = new TextIndex(root);
    for (const [s, e] of spans) index.rangeAt(s, e);
    const fast = performance.now() - t;

    console.log(`段落 5000・ハイライト 500 件: 従来 ${slow.toFixed(0)}ms, 索引 ${fast.toFixed(0)}ms`);
    expect(fast).toBeLessThan(slow);
  });
});
