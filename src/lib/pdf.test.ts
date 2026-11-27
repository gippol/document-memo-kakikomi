// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createPageImages, normalizePdfText, pagesToHtml, parseTextCache, textWarnings, type PdfCache } from "./pdf";

describe("pdf", () => {
  it("ページごとに section を作り、画像（src は後から入れる）と文字の層を入れる", () => {
    const html = pagesToHtml([
      { no: 1, width: 595, height: 842, textLayerHtml: '<div class="textLayer"><span>あ</span></div>' },
      { no: 2, width: 842, height: 595, textLayerHtml: '<div class="textLayer"></div>' },
    ]);
    const root = document.createElement("div");
    root.innerHTML = html;
    const pages = root.querySelectorAll<HTMLElement>("section.pdf-page");
    expect([...pages].map((p) => p.dataset.page)).toEqual(["1", "2"]);
    expect(pages[1].style.getPropertyValue("--page-w")).toBe("842");
    expect(pages[0].querySelector("img.pdf-img")?.hasAttribute("src")).toBe(false);
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

describe("parseTextCache", () => {
  const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).buffer as ArrayBuffer;

  it("保存した文字の層を読み戻す", () => {
    const parts = { html: "<section></section>", text: "あ", warnings: ["w"], pageCount: 1 };
    expect(parseTextCache(enc(parts))).toEqual(parts);
  });

  it("無い・壊れている・形が違うときは null", () => {
    expect(parseTextCache(null)).toBeNull();
    expect(parseTextCache(new ArrayBuffer(0))).toBeNull();
    expect(parseTextCache(new TextEncoder().encode("{broken").buffer as ArrayBuffer)).toBeNull();
    expect(parseTextCache(enc({ html: "x", text: "y", warnings: [1], pageCount: 1 }))).toBeNull();
    expect(parseTextCache(enc({ html: "x", text: "y", warnings: [] }))).toBeNull();
  });
});

describe("createPageImages", () => {
  /** jsdom には URL.createObjectURL が無いので、作った URL を数えるだけの代わり */
  function fakeUrls() {
    let n = 0;
    const revoked: string[] = [];
    return { revoked, api: { createObjectURL: () => `blob:${++n}`, revokeObjectURL: (u: string) => void revoked.push(u) } };
  }
  function memCache(init: Record<string, ArrayBuffer> = {}) {
    const store = new Map(Object.entries(init));
    const cache: PdfCache = {
      get: vi.fn(async (name: string) => store.get(name) ?? null),
      put: vi.fn(async (name: string, data: Blob) => void store.set(name, await data.arrayBuffer())),
    };
    return { store, cache };
  }
  const png = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

  it("キャッシュに無ければ描いて保存し、同じページは 1 度だけ描く", async () => {
    const render = vi.fn(async () => png());
    const { store, cache } = memCache();
    const urls = fakeUrls();
    const images = createPageImages({ render, cache, urls: urls.api });
    const [a, b] = await Promise.all([images.url(2), images.url(2)]);
    expect(a).toBe(b);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(2);
    await vi.waitFor(() => expect(store.has("p2.png")).toBe(true));
  });

  it("キャッシュにあれば描かない", async () => {
    const render = vi.fn(async () => png());
    const { cache } = memCache({ "p1.png": new Uint8Array([9]).buffer });
    const images = createPageImages({ render, cache, urls: fakeUrls().api });
    await images.url(1);
    expect(render).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("キャッシュが読めなくても描いて表示する", async () => {
    const render = vi.fn(async () => png());
    const cache: PdfCache = { get: async () => Promise.reject(new Error("io")), put: async () => Promise.reject(new Error("io")) };
    const images = createPageImages({ render, cache, urls: fakeUrls().api });
    await expect(images.url(1)).resolves.toMatch(/^blob:/);
  });

  it("描けなかったページは、次に求められたときにやり直す", async () => {
    const render = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue(png());
    const images = createPageImages({ render, urls: fakeUrls().api });
    await expect(images.url(1)).rejects.toThrow("x");
    await expect(images.url(1)).resolves.toMatch(/^blob:/);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("dispose で作った URL を解放し、pdf.js の文書を閉じる。閉じた後に描き終えたページは捨てる", async () => {
    let finish!: (b: Blob) => void;
    const render = vi.fn().mockResolvedValueOnce(png()).mockReturnValueOnce(new Promise<Blob>((r) => (finish = r)));
    const closeDoc = vi.fn();
    const urls = fakeUrls();
    const images = createPageImages({ render, dispose: closeDoc, urls: urls.api });
    const first = await images.url(1);
    const late = images.url(2);
    images.dispose();
    images.dispose();
    expect(urls.revoked).toEqual([first]);
    expect(closeDoc).toHaveBeenCalledTimes(1);
    finish(png());
    await expect(late).rejects.toThrow();
  });
});
