// @vitest-environment jsdom
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createAnchor, resolveAnchor } from "./anchor";
import { containerText, locateInHtml, rangeFromOffsets, slideSpans } from "./dom";
import { pptxToHtml } from "./pptx";

// ---------- テスト用の最小 .pptx を組み立てる ----------

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

type P = string | { t: string; lvl?: number; bu?: "none" | "char" | "num" };

function para(p: P): string {
  const o = typeof p === "string" ? { t: p } : p;
  const bu = o.bu === "none" ? "<a:buNone/>" : o.bu === "char" ? '<a:buChar char="•"/>' : o.bu === "num" ? '<a:buAutoNum type="arabicPeriod"/>' : "";
  const pPr = o.lvl || bu ? `<a:pPr${o.lvl ? ` lvl="${o.lvl}"` : ""}>${bu}</a:pPr>` : "";
  return `<a:p>${pPr}<a:r><a:t>${o.t}</a:t></a:r></a:p>`;
}

function sp(paras: P[], opts: { ph?: string; idx?: string; y?: number; x?: number } = {}): string {
  const ph = opts.ph !== undefined || opts.idx ? `<p:ph${opts.ph ? ` type="${opts.ph}"` : ""}${opts.idx ? ` idx="${opts.idx}"` : ""}/>` : "";
  const xfrm = opts.y !== undefined ? `<a:xfrm><a:off x="${opts.x ?? 0}" y="${opts.y}"/><a:ext cx="100" cy="100"/></a:xfrm>` : "";
  return `<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr>${xfrm}</p:spPr><p:txBody><a:bodyPr/>${paras.map(para).join("")}</p:txBody></p:sp>`;
}

const pic = (descr: string, y = 5000) =>
  `<p:pic><p:nvPicPr><p:cNvPr id="3" name="pic" descr="${descr}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:spPr><a:xfrm><a:off x="0" y="${y}"/></a:xfrm></p:spPr></p:pic>`;

const table = (rows: string[][], y = 4000) =>
  `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="t"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="${y}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>${rows
    .map((r) => `<a:tr>${r.map((c) => `<a:tc><a:txBody>${para(c)}</a:txBody></a:tc>`).join("")}</a:tr>`)
    .join("")}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;

interface SlideSpec {
  /** sldId の id（並べ替えても変わらない） */
  id: number;
  shapes: string[];
  notes?: P[];
  hidden?: boolean;
}

const LAYOUT = `<p:sldLayout ${NS}><p:cSld><p:spTree>${sp([], { ph: "title", y: 100 })}${sp([], { idx: "1", y: 2000 })}</p:spTree></p:cSld></p:sldLayout>`;

async function buildPptx(slides: SlideSpec[]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const presRels: string[] = [];
  const ids: string[] = [];
  slides.forEach((s) => {
    const n = s.id; // ファイル名も id で決める（並べ替えても同じファイル名のまま）
    const slideRels = [`<Relationship Id="rL" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`];
    if (s.notes) {
      slideRels.push(`<Relationship Id="rN" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide${n}.xml"/>`);
      zip.file(
        `ppt/notesSlides/notesSlide${n}.xml`,
        `<p:notes ${NS}><p:cSld><p:spTree>${sp(["1"], { ph: "sldNum" })}${sp(s.notes, { ph: "body", idx: "1" })}</p:spTree></p:cSld></p:notes>`,
      );
    }
    zip.file(`ppt/slides/_rels/slide${n}.xml.rels`, `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slideRels.join("")}</Relationships>`);
    zip.file(`ppt/slides/slide${n}.xml`, `<p:sld ${NS}${s.hidden ? ' show="0"' : ""}><p:cSld><p:spTree>${s.shapes.join("")}</p:spTree></p:cSld></p:sld>`);
    presRels.push(`<Relationship Id="rId${n}" Type="${REL}/slide" Target="slides/slide${n}.xml"/>`);
    ids.push(`<p:sldId id="${s.id}" r:id="rId${n}"/>`);
  });
  zip.file("ppt/slideLayouts/slideLayout1.xml", LAYOUT);
  zip.file("ppt/_rels/presentation.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${presRels.join("")}</Relationships>`);
  zip.file("ppt/presentation.xml", `<p:presentation ${NS}><p:sldIdLst>${ids.join("")}</p:sldIdLst></p:presentation>`);
  return zip.generateAsync({ type: "arraybuffer" });
}

function render(html: string) {
  const body = document.createElement("div");
  body.innerHTML = html;
  document.body.replaceChildren(body);
  return { body, text: containerText(body), spans: slideSpans(body) };
}

// ---------- テスト ----------

describe("pptxToHtml", () => {
  it("スライドを順番どおりにカードにし、タイトル・箇条書き・表・画像・発表者ノートを出す", async () => {
    const data = await buildPptx([
      {
        id: 256,
        shapes: [
          // 保存順（重なり順）はばらばらでも、タイトル → 上から順に並ぶ
          pic("売上の推移"),
          table([["項目", "金額"], ["人件費", "1200"]]),
          sp([{ t: "採用が遅れている" }, { t: "エンジニア 2 名", lvl: 1 }, { t: "外注費が増えている" }], { idx: "1" }),
          sp(["今期の課題"], { ph: "title" }),
        ],
        notes: ["ここは口頭で補足する"],
      },
      { id: 257, shapes: [sp(["予備資料"], { ph: "title" })], hidden: true },
    ]);
    const { html, slideCount, warnings } = await pptxToHtml(data);
    expect(slideCount).toBe(2);
    expect(warnings).toEqual([]);
    const { body, spans } = render(html);

    const s1 = body.querySelector('section[data-slide="1"]')!;
    expect(s1.getAttribute("data-slide-id")).toBe("256");
    expect(s1.getAttribute("data-title")).toBe("今期の課題");
    // 読む順（DOM の順）: 位置の箱の中身を順に見る。発表者ノートはスライドの外
    const canvas = s1.querySelector(".slide-canvas")!;
    expect([...canvas.children].map((c) => c.querySelector("h2,ul,table,.slide-img")?.tagName.toLowerCase())).toEqual(["h2", "ul", "table", "div"]);
    expect([...s1.children].map((c) => c.className)).toEqual(["slide-canvas", "slide-notes"]);
    expect(s1.querySelector("ul > li > ul > li")?.textContent).toBe("エンジニア 2 名");
    expect(s1.querySelector(".slide-img")?.getAttribute("data-label")).toBe("画像: 売上の推移");
    expect(s1.querySelector(".slide-notes")?.textContent).toBe("ここは口頭で補足する");
    // スライド番号のプレースホルダーは出さない
    expect(s1.querySelector(".slide-notes")?.textContent).not.toContain("1ここ");

    expect(spans.map((s) => [s.no, s.id, s.title, s.hidden])).toEqual([
      [1, 256, "今期の課題", false],
      [2, 257, "予備資料", true],
    ]);
  });

  it("位置が省略されたプレースホルダーはレイアウトの位置で並べる", async () => {
    const data = await buildPptx([
      {
        id: 256,
        // 本文プレースホルダー（レイアウトでは y=2000）と、y=1000 のテキストボックス
        shapes: [sp(["本文"], { idx: "1" }), sp(["補足のテキストボックス"], { y: 1000 }), sp(["タイトル"], { ph: "title" })],
      },
    ]);
    const { body } = render((await pptxToHtml(data)).html);
    expect([...body.querySelectorAll("h2,p,li")].map((e) => e.textContent)).toEqual(["タイトル", "補足のテキストボックス", "本文"]);
    // テキストボックスは箇条書きにしない、本文プレースホルダーは箇条書き
    expect(body.querySelector("li")?.textContent).toBe("本文");
  });

  it("スライドの順番が変わると版の判定用テキストも変わる", async () => {
    const a = { id: 256, shapes: [sp(["A"], { ph: "title" })] };
    const b = { id: 257, shapes: [sp(["B"], { ph: "title" })] };
    expect((await pptxToHtml(await buildPptx([a, b]))).text).toBe("AB");
    expect((await pptxToHtml(await buildPptx([b, a]))).text).toBe("BA");
  });
});

describe("スライドを手がかりにした再アンカー", () => {
  const slideA: SlideSpec = { id: 256, shapes: [sp(["前提"], { ph: "title" }), sp(["日程は要確認です"], { idx: "1" })] };
  const slideB: SlideSpec = {
    id: 257,
    shapes: [sp(["予算"], { ph: "title" }), sp(["日程は要確認です"], { idx: "1" })],
    notes: ["金額は来週確定"],
  };

  it("位置にスライド番号・ID・タイトルを記録する（発表者ノートはそれとわかる見出し）", async () => {
    const { body, text } = render((await pptxToHtml(await buildPptx([slideA, slideB]))).html);
    const at = text.lastIndexOf("要確認");
    const loc = locateInHtml(body, rangeFromOffsets(body, at, at + 3)!);
    expect(loc).toMatchObject({ slide: 2, slideId: 257, heading: "予算" });
    const n = text.indexOf("来週確定");
    expect(locateInHtml(body, rangeFromOffsets(body, n, n + 4)!)).toMatchObject({ slide: 2, heading: "予算（発表者ノート）" });
  });

  it("スライドを並べ替えても、同じ文言の別スライドではなく元のスライドを指す", async () => {
    const v1 = render((await pptxToHtml(await buildPptx([slideA, slideB]))).html);
    const at = v1.text.lastIndexOf("要確認"); // スライドB の方
    const anchor = createAnchor(v1.text, at, at + 3, "v1", locateInHtml(v1.body, rangeFromOffsets(v1.body, at, at + 3)!));

    // B を先頭へ移動し、さらに A の前に新しいスライドを挿入する
    const extra: SlideSpec = { id: 258, shapes: [sp(["追加"], { ph: "title" }), sp(["日程は要確認です"], { idx: "1" })] };
    const v2 = render((await pptxToHtml(await buildPptx([slideB, extra, slideA]))).html);
    const scope = v2.spans.find((s) => s.id === anchor.slideId);
    const r = resolveAnchor(v2.text, anchor, scope);
    expect(r.status).toBe("moved");
    const loc = locateInHtml(v2.body, rangeFromOffsets(v2.body, r.start, r.end)!);
    expect(loc).toMatchObject({ slide: 1, slideId: 257 });
  });

  it("元のスライドが消えたら、資料全体から探す", async () => {
    const v1 = render((await pptxToHtml(await buildPptx([slideA, slideB]))).html);
    const at = v1.text.indexOf("来週確定");
    const anchor = createAnchor(v1.text, at, at + 4, "v1", locateInHtml(v1.body, rangeFromOffsets(v1.body, at, at + 4)!));
    const moved: SlideSpec = { id: 300, shapes: [sp(["予算（改）"], { ph: "title" })], notes: ["金額は来週確定"] };
    const v2 = render((await pptxToHtml(await buildPptx([slideA, moved]))).html);
    const r = resolveAnchor(v2.text, anchor, v2.spans.find((s) => s.id === anchor.slideId));
    expect(r.status).not.toBe("orphaned");
    expect(v2.text.slice(r.start, r.end)).toBe("来週確定");
  });
});
