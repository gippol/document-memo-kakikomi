// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { colorOf, connectorPoints, customGeom, fillOf, levelStyle, lineOf, parseTheme, presetGeom, type Theme } from "./pptxDraw";

const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const xml = (s: string) => new DOMParser().parseFromString(`<x ${A}>${s}</x>`, "application/xml").documentElement;

const theme: Theme = parseTheme(
  xml(
    `<a:clrScheme><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme>` +
      `<a:lnStyleLst><a:ln w="6350"/><a:ln w="12700"/><a:ln w="19050"/></a:lnStyleLst>`,
  ),
  xml("").ownerDocument.createElement("clrMap"),
);

describe("colorOf", () => {
  it("RGB・テーマの色（bg1・tx1 の読み替え）・システムの色", () => {
    expect(colorOf(xml('<a:srgbClr val="FF8800"/>'), theme)).toBe("#ff8800");
    expect(colorOf(xml('<a:schemeClr val="accent1"/>'), theme)).toBe("#4472c4");
    expect(colorOf(xml('<a:schemeClr val="tx1"/>'), theme)).toBe("#000000");
    expect(colorOf(xml('<a:schemeClr val="bg1"/>'), theme)).toBe("#ffffff");
    expect(colorOf(xml('<a:sysClr val="window" lastClr="F0F0F0"/>'), theme)).toBe("#f0f0f0");
    expect(colorOf(xml('<a:prstClr val="red"/>'), theme)).toBe("#ff0000");
  });

  it("明るさ・透明度の調整", () => {
    // 白を 50% の明るさに → 灰色
    expect(colorOf(xml('<a:srgbClr val="FFFFFF"><a:lumMod val="50000"/></a:srgbClr>'), theme)).toBe("#808080");
    // 黒を 25% 明るく
    expect(colorOf(xml('<a:srgbClr val="000000"><a:lumOff val="25000"/></a:srgbClr>'), theme)).toBe("#404040");
    expect(colorOf(xml('<a:srgbClr val="000000"><a:tint val="50000"/></a:srgbClr>'), theme)).toBe("#808080");
    expect(colorOf(xml('<a:srgbClr val="FFFFFF"><a:shade val="50000"/></a:srgbClr>'), theme)).toBe("#808080");
    expect(colorOf(xml('<a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr>'), theme)).toBe("rgba(255,0,0,0.5)");
  });

  it("色が無い・テーマに無い色は null", () => {
    expect(colorOf(xml(""), theme)).toBeNull();
    expect(colorOf(xml('<a:schemeClr val="accent6"/>'), theme)).toBeNull();
  });
});

describe("fillOf / lineOf", () => {
  it("単色・塗りなし・グラデーション・画像", () => {
    expect(fillOf(xml('<a:solidFill><a:srgbClr val="112233"/></a:solidFill>'), theme)).toEqual({ css: "#112233", solid: "#112233" });
    expect(fillOf(xml("<a:noFill/>"), theme)?.css).toBe("none");
    const g = fillOf(
      xml('<a:gradFill><a:gsLst><a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill>'),
      theme,
    );
    // 下向き（PowerPoint の 90 度）は CSS の 180deg。色は位置の順
    expect(g).toEqual({ css: "linear-gradient(180deg, #ff0000 0%, #0000ff 100%)", solid: "#ff0000" });
    expect(fillOf(xml(""), theme)).toBeNull();
  });

  it("線: 太さ・破線・矢印。指定が無ければ p:style の lnRef の色と太さ", () => {
    const ln = lineOf(
      xml('<a:ln w="25400"><a:solidFill><a:srgbClr val="333333"/></a:solidFill><a:prstDash val="dash"/><a:tailEnd type="triangle"/><a:headEnd type="oval"/></a:ln>'),
      undefined,
      theme,
    );
    expect(ln).toEqual({ color: "#333333", width: 2, dash: true, head: "oval", tail: "tri" });
    const style = xml('<a:lnRef idx="2"><a:schemeClr val="accent1"/></a:lnRef>');
    // 太さはテーマの 2 番目の線（1pt）
    expect(lineOf(xml(""), style, theme)).toMatchObject({ color: "#4472c4", width: 1 });
    expect(lineOf(xml("<a:ln><a:noFill/></a:ln>"), style, theme)).toBeNull();
    expect(lineOf(xml(""), undefined, theme)).toBeNull();
  });
});

describe("図形の形", () => {
  it("角丸の半径は短い辺に対する割合。知らない形は四角", () => {
    expect(presetGeom("roundRect", null, 200, 100)).toEqual({ kind: "roundRect", radius: 16.667 });
    expect(presetGeom("roundRect", 50000, 200, 100)).toEqual({ kind: "roundRect", radius: 50 });
    expect(presetGeom("ellipse", null, 1, 1)).toEqual({ kind: "ellipse" });
    expect(presetGeom("diamond", null, 1, 1)).toEqual({ kind: "path", d: "M0.5 0 L1 0.5 L0.5 1 L0 0.5 Z" });
    expect(presetGeom("somethingNew", null, 1, 1)).toEqual({ kind: "rect" });
  });

  it("自由図形はパスの大きさで 0〜1 に直す", () => {
    const g = customGeom(
      xml(
        '<a:custGeom><a:pathLst><a:path w="200" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="200" y="50"/></a:lnTo><a:cubicBezTo><a:pt x="100" y="100"/><a:pt x="50" y="100"/><a:pt x="0" y="100"/></a:cubicBezTo><a:close/></a:path></a:pathLst></a:custGeom>',
      ).firstElementChild as Element,
    );
    expect(g).toEqual({ kind: "path", d: "M0 0 L1 0.5 C0.5 1 0.25 1 0 1 Z" });
    expect(customGeom(undefined)).toBeNull();
    // パスに大きさが無ければ図形の大きさ（EMU）で割る
    const g2 = customGeom(
      xml('<a:custGeom><a:pathLst><a:path><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="914400" y="457200"/></a:lnTo></a:path></a:pathLst></a:custGeom>')
        .firstElementChild as Element,
      914400,
      914400,
    );
    expect(g2).toEqual({ kind: "path", d: "M0 0 L1 0.5" });
  });
});

describe("connectorPoints", () => {
  const box = { x: 10, y: 20, w: 100, h: 50, rot: 0, flipH: false, flipV: false };

  it("直線は左上から右下。上下反転で左下から右上", () => {
    expect(connectorPoints("line", box, null)).toEqual([
      [10, 20],
      [110, 70],
    ]);
    expect(connectorPoints("straightConnector1", { ...box, flipV: true }, null)).toEqual([
      [10, 70],
      [110, 20],
    ]);
  });

  it("カギ線は真ん中（調整値）で折れる", () => {
    expect(connectorPoints("bentConnector3", box, 25000)).toEqual([
      [10, 20],
      [35, 20],
      [35, 70],
      [110, 70],
    ]);
  });

  it("回転は中心を軸にする", () => {
    const [[x1, y1], [x2, y2]] = connectorPoints("line", { x: 0, y: 0, w: 100, h: 0, rot: 90, flipH: false, flipV: false }, null);
    expect([x1, y1, x2, y2].map((v) => Math.round(v))).toEqual([50, -50, 50, 50]);
  });
});

describe("levelStyle", () => {
  it("優先順の最初にある指定を使い、無いものは後ろから補う", () => {
    const own = xml('<a:lvl1pPr algn="ctr"><a:defRPr sz="2000"/></a:lvl1pPr>');
    const master = xml('<a:lvl1pPr><a:defRPr sz="3200" b="1"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr><a:lvl2pPr><a:defRPr sz="2800"/></a:lvl2pPr>');
    expect(levelStyle([own, { color: "#ff0000" }, master], 0, theme)).toEqual({ sz: 20, algn: "ctr", color: "#ff0000", b: true });
    expect(levelStyle([own, undefined, master], 1, theme)).toEqual({ sz: 28 });
  });
});
