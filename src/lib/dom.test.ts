// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { containerText, headingElements, headingSpans, linesOfRange, locateInHtml, offsetOf, pageSpans, rangeFromOffsets, slideSpans, TextIndex } from "./dom";

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

  it("見出しの文言・レベル・位置（空の見出しは除く）", () => {
    const root = mount("<p>前文</p><h1> 1. 背景 </h1><p>本文</p><h2>1.1 経緯</h2><h3></h3>");
    const text = containerText(root);
    expect(headingSpans(root)).toEqual([
      { text: "1. 背景", level: 1, start: text.indexOf(" 1. 背景") },
      { text: "1.1 経緯", level: 2, start: text.indexOf("1.1 経緯") },
    ]);
    expect(headingSpans(root, new TextIndex(root))).toEqual(headingSpans(root));
    // 目次の項目番号から要素を引けるよう、headingElements は同じ並び
    expect(headingElements(root).map((h) => h.tagName)).toEqual(["H1", "H2"]);
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

  it("PDF: ページの範囲と、選んだ文字のページ番号", () => {
    const root = mount(
      '<section class="pdf-page" data-page="1"><img alt=""><div class="textLayer"><span>あい</span><br><span>う</span></div></section>' +
        '<section class="pdf-page" data-page="2"><img alt=""><div class="textLayer"><span>えお</span></div></section>',
    );
    const index = new TextIndex(root);
    expect(index.text).toBe("あいうえお");
    expect(pageSpans(root, index)).toEqual([
      { no: 1, start: 0, end: 3 },
      { no: 2, start: 3, end: 5 },
    ]);
    expect(pageSpans(root, index)).toEqual(pageSpans(root));
    expect(locateInHtml(root, index.rangeAt(3, 5)!)).toEqual({ page: 2 });
  });

  it("PDF: 構造・しおりから作った見出しを、直前の見出しとして記録する（しおりの見出しは題名を使う）", () => {
    const root = mount(
      '<section class="pdf-page" data-page="1"><div class="textLayer">' +
        '<span>前書き</span><h1 class="markedContent pdf-heading"><span>1. 進捗</span></h1><span>本文A</span></div></section>' +
        '<section class="pdf-page" data-page="2"><div class="textLayer">' +
        '<span>本文B</span><h2 class="markedContent pdf-heading" data-title="2. 課題と相談"><span>2. 課</span></h2><span>本文C</span></div></section>',
    );
    const index = new TextIndex(root);
    const at = (s: string) => locateInHtml(root, index.rangeAt(index.text.indexOf(s), index.text.indexOf(s) + s.length)!);
    expect(at("前書き")).toEqual({ page: 1, heading: undefined });
    expect(at("本文A")).toEqual({ page: 1, heading: "1. 進捗" });
    // ページをまたいでも直前の見出し
    expect(at("本文B")).toEqual({ page: 2, heading: "1. 進捗" });
    expect(at("本文C")).toEqual({ page: 2, heading: "2. 課題と相談" });
    expect(headingSpans(root, index).map((h) => [h.text, h.level])).toEqual([
      ["1. 進捗", 1],
      ["2. 課題と相談", 2],
    ]);
  });
});
