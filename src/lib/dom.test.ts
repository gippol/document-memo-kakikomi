// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { containerText, linesOfRange, offsetOf, rangeFromOffsets } from "./dom";

describe("dom helpers", () => {
  it("オフセット ⇔ Range が往復できる", () => {
    const root = document.createElement("div");
    root.innerHTML = '<h1 data-sl="1" data-el="1">仕様</h1>\n<p data-sl="3" data-el="4">これは<strong>重要</strong>な仕様です</p>';
    document.body.appendChild(root);
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
