// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { normalizePdfText, pagesToHtml, textWarnings } from "./pdf";

describe("pdf", () => {
  it("ページごとに section を作り、画像と文字の層を入れる", () => {
    const html = pagesToHtml([
      { no: 1, width: 595, height: 842, imgUrl: "blob:a", textLayerHtml: '<div class="textLayer"><span>あ</span></div>' },
      { no: 2, width: 842, height: 595, imgUrl: "blob:b", textLayerHtml: '<div class="textLayer"></div>' },
    ]);
    const root = document.createElement("div");
    root.innerHTML = html;
    const pages = root.querySelectorAll<HTMLElement>("section.pdf-page");
    expect([...pages].map((p) => p.dataset.page)).toEqual(["1", "2"]);
    expect(pages[1].style.getPropertyValue("--page-w")).toBe("842");
    expect(pages[0].querySelector("img")?.getAttribute("src")).toBe("blob:a");
    // 画像の alt は空なので、アンカーの文字は文字の層だけ
    expect(root.textContent).toBe("あ");
  });

  it("文字の無いページを知らせる", () => {
    expect(textWarnings(["あ", "い"])).toEqual([]);
    expect(textWarnings(["あ", " ", "う", ""])[0]).toContain("p.2, 4");
    expect(textWarnings(["", ""])[0]).toContain("文字の入っていない PDF");
  });

  it("康熙部首・合字を普通の文字に直す", () => {
    expect(normalizePdfText("11⽉第4週 ⽇曜")).toBe("11月第4週 日曜");
    expect(normalizePdfText("ﬁle")).toBe("file");
    expect(normalizePdfText("月日・ｶﾅ")).toBe("月日・ｶﾅ");
  });
});
