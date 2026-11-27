// @vitest-environment jsdom
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { containerText } from "./dom";
import { pptxToHtml } from "./pptx";

// PowerPoint で作った資料に近い形（テーマ・マスター・レイアウト・p:style の参照・グループ・画像・コネクタ）の .pptx を組み立てる

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rels = (items: [string, string, string][]) =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`)
    .join("")}</Relationships>`;
const xfrm = (x: number, y: number, cx: number, cy: number, extra = "") =>
  `<a:xfrm${extra}><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;
const nv = (tag: string, ph = "") => `<p:${tag}><p:cNvPr id="9" name="s"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:${tag}>`;
const txt = (t: string, rPr = "") => `<p:txBody><a:bodyPr/><a:p><a:r>${rPr ? `<a:rPr ${rPr}` : ""}${rPr ? "/>" : ""}<a:t>${t}</a:t></a:r></a:p></p:txBody>`;

const THEME = `<a:theme ${NS}><a:themeElements><a:clrScheme name="t">
  <a:dk1><a:srgbClr val="111111"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
  <a:dk2><a:srgbClr val="222222"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2>
  <a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme>
  <a:fmtScheme><a:lnStyleLst><a:ln w="6350"/><a:ln w="12700"/><a:ln w="19050"/></a:lnStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

const MASTER = `<p:sldMaster ${NS}><p:cSld>
  <p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg2"/></a:solidFill></p:bgPr></p:bg>
  <p:spTree>
    <p:sp>${nv("nvSpPr", '<p:ph type="title"/>')}<p:spPr>${xfrm(127000, 127000, 10000000, 1270000)}</p:spPr>${txt("")}</p:sp>
    <p:sp>${nv("nvSpPr")}<p:spPr>${xfrm(0, 6350000, 12192000, 508000)}<a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:spPr>${txt("社外秘")}</p:sp>
  </p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1"/>
  <p:txStyles><p:titleStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:titleStyle>
  <p:bodyStyle><a:lvl1pPr><a:defRPr sz="2800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle/></p:txStyles></p:sldMaster>`;

const LAYOUT = `<p:sldLayout ${NS}><p:cSld><p:spTree>
  <p:sp>${nv("nvSpPr", '<p:ph type="title"/>')}<p:spPr/>${txt("")}</p:sp>
</p:spTree></p:cSld></p:sldLayout>`;

/** 1×1 の PNG */
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGO4BwAA5wDmWQ1dkQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

const SLIDE = `<p:sld ${NS}><p:cSld><p:spTree>
  <p:sp>${nv("nvSpPr", '<p:ph type="title"/>')}<p:spPr/>${txt("構成")}</p:sp>
  <p:sp>${nv("nvSpPr")}<p:spPr>${xfrm(1270000, 2540000, 2540000, 1270000)}<a:prstGeom prst="roundRect"/></p:spPr>
    <p:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>
    ${txt("サーバー")}</p:sp>
  <p:grpSp><p:nvGrpSpPr><p:cNvPr id="20" name="g"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="6350000" y="2540000"/><a:ext cx="2540000" cy="1270000"/><a:chOff x="0" y="0"/><a:chExt cx="5080000" cy="2540000"/></a:xfrm></p:grpSpPr>
    <p:sp>${nv("nvSpPr")}<p:spPr>${xfrm(2540000, 0, 2540000, 2540000)}<a:solidFill><a:srgbClr val="00AA00"/></a:solidFill></p:spPr>${txt("DB", 'sz="1200" b="1"')}</p:sp>
  </p:grpSp>
  <p:cxnSp><p:nvCxnSpPr><p:cNvPr id="30" name="c"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>
    <p:spPr>${xfrm(3810000, 3175000, 2540000, 0)}<a:prstGeom prst="straightConnector1"/><a:ln w="25400"><a:solidFill><a:srgbClr val="333333"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>
  <p:pic><p:nvPicPr><p:cNvPr id="40" name="pic" descr="ロゴ"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
    <p:blipFill><a:blip r:embed="rImg"/><a:srcRect l="25000" r="25000"/></p:blipFill><p:spPr>${xfrm(0, 0, 1270000, 1270000)}</p:spPr></p:pic>
  <p:pic><p:nvPicPr><p:cNvPr id="41" name="emf" descr="古い図"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
    <p:blipFill><a:blip r:embed="rEmf"/></p:blipFill><p:spPr>${xfrm(0, 5080000, 1270000, 1270000)}</p:spPr></p:pic>
  <p:sp>${nv("nvSpPr")}<p:spPr>${xfrm(1270000, 5080000, 2540000, 0)}<a:prstGeom prst="line"/><a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></p:spPr>${txt("承認")}</p:sp>
  <p:grpSp><p:nvGrpSpPr><p:cNvPr id="50" name="g2"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm rot="5400000"><a:off x="8890000" y="5080000"/><a:ext cx="1270000" cy="1270000"/><a:chOff x="0" y="0"/><a:chExt cx="1270000" cy="1270000"/></a:xfrm></p:grpSpPr>
    <p:sp>${nv("nvSpPr")}<p:spPr>${xfrm(0, 0, 1270000, 635000)}<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></p:spPr></p:sp>
  </p:grpSp>
</p:spTree></p:cSld>
<p:clrMapOvr><a:overrideClrMapping bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2" accent1="accent1"/></p:clrMapOvr></p:sld>`;

async function build(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("ppt/presentation.xml", `<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rS1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", rels([["rS1", "slide", "slides/slide1.xml"]]));
  zip.file("ppt/slides/slide1.xml", SLIDE);
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    rels([
      ["rL", "slideLayout", "../slideLayouts/slideLayout1.xml"],
      ["rImg", "image", "../media/image1.png"],
      ["rEmf", "image", "../media/image2.emf"],
    ]),
  );
  zip.file("ppt/slideLayouts/slideLayout1.xml", LAYOUT);
  zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", rels([["rM", "slideMaster", "../slideMasters/slideMaster1.xml"]]));
  zip.file("ppt/slideMasters/slideMaster1.xml", MASTER);
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", rels([["rT", "theme", "../theme/theme1.xml"]]));
  zip.file("ppt/theme/theme1.xml", THEME);
  zip.file("ppt/media/image1.png", PNG);
  zip.file("ppt/media/image2.emf", new Uint8Array([1, 2, 3]));
  return zip.generateAsync({ type: "arraybuffer" });
}

const vars = (el: Element | null | undefined) =>
  Object.fromEntries(
    (el?.getAttribute("style") ?? "")
      .split(";")
      .filter(Boolean)
      .map((kv) => [kv.slice(0, kv.indexOf(":")).trim(), kv.slice(kv.indexOf(":") + 1).trim()]),
  );

describe("pptxToHtml（図の表示）", async () => {
  const { html, text, warnings } = await pptxToHtml(await build());
  const body = document.createElement("div");
  body.innerHTML = html;
  const canvas = body.querySelector(".slide-canvas")!;
  const shapeOf = (t: string) => [...canvas.querySelectorAll(".sh")].find((s) => s.querySelector(".sh-tx")?.textContent === t)!;

  it("スライドの大きさ（pt）と背景（マスターの bg2。スライドの clrMapOvr で dk2 に読み替える）", () => {
    expect(vars(canvas)).toMatchObject({ "--sw": "960", "--shh": "540", "--bg": "#222222" });
  });

  it("DOM の文字は今までどおり（飾りの文字・画像は入らない）", () => {
    // 線の形の図形の文字（承認）も消さない
    expect(text).toBe("構成サーバーDB承認");
    expect(containerText(body)).toBe("構成サーバーDB承認");
  });

  it("マスターの飾りは文字を data-deco で持ち、いちばん下に重ねる", () => {
    const deco = canvas.querySelector(".sh-deco")!;
    expect(deco.querySelector("[data-deco]")?.getAttribute("data-deco")).toBe("社外秘");
    expect(vars(deco)["--fill"]).toBe("#4472c4");
    const zs = [...canvas.querySelectorAll<HTMLElement>(".sh, .sh-line")].map((e) => Number(vars(e)["--z"]));
    expect(Number(vars(deco)["--z"])).toBe(Math.min(...zs));
  });

  it("位置の無いタイトルはマスターの位置。書式はマスターの titleStyle（44pt・tx1・中央。tx1 は clrMapOvr で lt1）", () => {
    const title = shapeOf("構成");
    expect(vars(title)).toMatchObject({ "--x": "1.042", "--y": "1.852", "--w": "82.021" });
    const h2 = title.querySelector("h2")!;
    expect(vars(h2)).toMatchObject({ "--fs": "44", "--c": "#ffffff" });
    expect(h2.getAttribute("data-al")).toBe("ctr");
  });

  it("p:style の参照で、塗り（accent1）・枠線（テーマの 2 番目の太さ 1pt）・文字の色（lt1）", () => {
    const box = shapeOf("サーバー");
    expect(box.getAttribute("data-geo")).toBe("roundRect");
    expect(vars(box)).toMatchObject({ "--fill": "#4472c4", "--lw": "1", "--x": "10.417", "--y": "37.037" });
    expect(vars(box)["--ln"]).toMatch(/^#/);
    expect(vars(box.querySelector("p"))["--c"]).toBe("#ffffff");
  });

  it("グループの中の図形は、グループの拡大・移動を受けた位置になる", () => {
    const db = shapeOf("DB");
    // 子の座標 (2540000, 0) 大きさ 2540000 → グループで 1/2 に縮めて (6350000 + 1270000, 2540000)
    expect(vars(db)).toMatchObject({ "--x": "62.5", "--y": "37.037", "--w": "10.417", "--h": "18.519", "--fill": "#00aa00" });
    expect(vars(db.querySelector("span"))).toMatchObject({ "--fs": "12", "--fw": "700" });
  });

  it("コネクタは線分と矢印", () => {
    const line = canvas.querySelector(".sh-line")!;
    expect(vars(line)).toMatchObject({ "--lw": "2", "--c": "#333333" });
    const seg = line.querySelector(".sh-seg")!;
    expect(vars(seg)).toMatchObject({ "--x1": "300", "--y1": "250", "--len": "200", "--ang": "0deg" });
    expect(seg.getAttribute("data-tail")).toBe("tri");
  });

  it("画像は blob URL で、切り抜きを反映する。表示できない形式は目印だけ", async () => {
    const pics = [...canvas.querySelectorAll(".sh-pic")];
    const img = pics[0].querySelector("img")!;
    const { urls, viewKey } = await pptxToHtml(await build());
    expect(urls).toHaveLength(1);
    expect(img.getAttribute("src")).toMatch(/^blob:/);
    expect(img.hasAttribute("data-src")).toBe(false);
    // 表示内容の比較用のキーは、読み込み直しても（blob URL が変わっても）同じ
    expect(viewKey).not.toContain("blob:");
    expect(viewKey).toContain("zip:ppt/media/image1.png");
    expect(img.getAttribute("alt")).toBe("");
    expect(vars(img)).toMatchObject({ "--cl": "-50%", "--cw": "200%" });
    expect(pics[0].querySelector(".slide-img")?.getAttribute("data-label")).toBe("画像: ロゴ");
    expect(pics[1].querySelector("img")).toBeNull();
    expect(warnings).toEqual(["表示できない形式の画像（EMF など）1 個は目印だけを表示しています"]);
  });

  it("線の形の図形は、線と文字の枠を両方出す", () => {
    const tx = shapeOf("承認");
    expect(tx).toBeTruthy();
    expect(tx.previousElementSibling?.classList.contains("sh-line")).toBe(true);
  });

  it("回転したグループは、中の図形をまとめてグループの中心で回す", () => {
    const g = canvas.querySelector(".sh-grp")!;
    expect(vars(g)).toMatchObject({ "--rot": "90deg", "--ox": "78.125", "--oy": "83.333" });
    expect(vars(g.querySelector(".sh"))["--fill"]).toBe("#ff0000");
  });
});
