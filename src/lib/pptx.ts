import DOMPurify from "dompurify";
import JSZip from "jszip";
import {
  colorOf,
  connectorPoints,
  customGeom,
  EMPTY_THEME,
  EMU_PER_PT,
  fillOf,
  kid,
  kids,
  levelStyle,
  lineOf,
  n3,
  num,
  parseTheme,
  path,
  presetGeom,
  rid,
  runStyleOf,
  styleRefColor,
  styleVars,
  type Box,
  type Fill,
  type Geom,
  type Line,
  type StyleSource,
  type TextStyle,
  type Theme,
} from "./pptxDraw";

/**
 * PowerPoint (.pptx) をスライドごとの HTML にする。
 *
 * 表示は 2 通りで、同じ HTML を CSS で切り替える（index.css）。
 * - 図（.pptx-layout）: 図形・画像・線を、スライド上の位置・大きさ・塗り・枠線・文字の書式どおりに並べる
 * - 文字（.pptx-cards）: 「スライドごとの文字のカード」。位置や書式の CSS 変数を使わず、文字・表・目印だけを上から並べる
 *
 * 文字（DOM のテキスト）の並びは、どちらでも「タイトル → 上から・左から」の読む順。見た目の重なり順は z-index で表す。
 * 位置・書式は CSS 変数と data 属性だけで持ち、DOM の文字には足さないので、アンカーや版の判定（sha256）は表示の仕方によらない。
 * マスター・レイアウトの飾りの図形の文字は、CSS（data-deco）で表示して DOM の文字には含めない。
 *
 * 出力:
 * <section class="slide" data-slide="3" data-slide-id="259" data-title="…" [data-hidden]>
 *   <div class="slide-canvas" style="--sw:720;--shh:405;--bg:#fff">
 *     <div class="sh" data-geo="rect" style="--x:5;--y:4;--w:90;--h:15;--z:3;…">   ← 位置は % 、長さは pt
 *       <div class="sh-tx"><h2 style="--fs:28">タイトル</h2></div>
 *     </div>
 *     <div class="sh sh-pic" style="…"><div class="slide-img" data-label="画像: 説明"></div><img class="pic" src="data:…" alt=""></div>
 *     <div class="sh-line" style="--z:5;--lw:2;--c:#333"><div class="sh-seg" style="--x1:…;--y1:…;--len:…;--ang:…" data-tail="tri"></div></div>
 *   </div>
 *   <aside class="slide-notes"><p>発表者ノート</p></aside>
 * </section>
 */
export interface PptxHtml {
  html: string;
  /** 本文テキスト（版の判定に使う） */
  text: string;
  warnings: string[];
  slideCount: number;
  /** 画像の blob URL。資料を閉じるときに revokePptxUrls で解放する */
  urls: string[];
  /** 表示内容の比較用（html の blob URL を zip の中の画像の名前に置き換えたもの。読み込むたびに変わらない） */
  viewKey: string;
}

export function revokePptxUrls(urls: string[]): void {
  for (const u of urls) URL.revokeObjectURL(u);
}

const BLOCK_SELECTOR = "p,h1,h2,h3,h4,h5,h6,li";
/** 本文として扱わないプレースホルダー（スライド番号・日付・フッターなど） */
const SKIP_PH = new Set(["sldNum", "dt", "ftr", "hdr", "sldImg"]);
const TITLE_PH = new Set(["title", "ctrTitle"]);
/** 箇条書きが既定になるプレースホルダー（type なしは「コンテンツ」） */
const BULLET_PH = new Set(["body", "obj", ""]);
/** マスターの bodyStyle の書式を使うプレースホルダー */
const BODY_STYLE_PH = new Set(["body", "obj", "", "subTitle"]);
/** 線として描く形 */
const LINE_PRST = /^(line|straightConnector1|bentConnector\d|curvedConnector\d)$/;
/** 既定のスライドの大きさ（4:3。presentation.xml に無いとき） */
const DEFAULT_SLIDE = { cx: 9144000, cy: 6858000 };
/** 画像として表示できる形式（EMF・WMF・TIFF などは目印だけ） */
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  svg: "image/svg+xml",
};

function parseXml(s: string): Element {
  return new DOMParser().parseFromString(s, "application/xml").documentElement;
}
function desc(el: Element, name: string): Element[] {
  return Array.from(el.getElementsByTagNameNS("*", name));
}
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** zip 内のパスを解決する（Target は rels のあるパーツからの相対パス） */
function resolvePart(from: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = from.split("/");
  parts.pop();
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

interface Rel {
  type: string;
  target: string;
}

class Package {
  private cache = new Map<string, Element | null>();
  private images = new Map<string, Promise<string | null>>();
  /** 作った blob URL と、その画像の zip の中の名前 */
  readonly urls: string[] = [];
  readonly urlTargets = new Map<string, string>();
  constructor(private zip: JSZip) {}

  async xml(part: string): Promise<Element | null> {
    if (!this.cache.has(part)) {
      const s = await this.zip.file(part)?.async("string");
      this.cache.set(part, s ? parseXml(s) : null);
    }
    return this.cache.get(part)!;
  }

  async rels(part: string): Promise<Map<string, Rel>> {
    const i = part.lastIndexOf("/");
    const relsPart = `${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`;
    const root = await this.xml(relsPart);
    const out = new Map<string, Rel>();
    for (const r of root ? kids(root, "Relationship") : []) {
      const id = r.getAttribute("Id");
      const target = r.getAttribute("Target");
      if (!id || !target || r.getAttribute("TargetMode") === "External") continue;
      out.set(id, { type: r.getAttribute("Type") ?? "", target: resolvePart(part, target) });
    }
    return out;
  }

  async relOfType(part: string, suffix: string): Promise<string | null> {
    for (const r of (await this.rels(part)).values()) if (r.type.endsWith(suffix)) return r.target;
    return null;
  }

  /**
   * パーツから r:embed で参照される画像の URL（表示できない形式・見つからなければ null）。
   * 同じ画像（マスターのロゴなど、全スライドに出るもの）は 1 つの blob URL を使い回し、HTML に画像のデータを繰り返し入れない。
   * blob URL を作れない環境（テストの jsdom）では data URL
   */
  async image(fromPart: string, rId: string): Promise<string | null> {
    const target = (await this.rels(fromPart)).get(rId)?.target;
    if (!target) return null;
    let p = this.images.get(target);
    if (!p) {
      const mime = IMAGE_MIME[target.split(".").pop()?.toLowerCase() ?? ""];
      const file = this.zip.file(target);
      if (!mime || !file) p = Promise.resolve(null);
      else if (typeof URL.createObjectURL !== "function") p = file.async("base64").then((b64) => `data:${mime};base64,${b64}`);
      else
        p = file.async("uint8array").then((bytes) => {
          const u = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
          this.urls.push(u);
          this.urlTargets.set(u, target);
          return u;
        });
      this.images.set(target, p);
    }
    return p;
  }
}

// ---------- 文字 ----------

interface Para {
  html: string;
  /** 改行を空白にしたプレーンテキスト */
  text: string;
  lvl: number;
  bullet: "ul" | "ol" | null;
  /** 段落の要素（p・li・h2）に付ける属性（書式の CSS 変数と揃え） */
  attrs: string;
}

function runs(p: Element, theme: Theme): { html: string; text: string } {
  let html = "";
  let text = "";
  for (const c of Array.from(p.children)) {
    if (c.localName === "r" || c.localName === "fld") {
      const t = kid(c, "t")?.textContent ?? "";
      const rPr = kid(c, "rPr");
      const vars = styleVars(runStyleOf(rPr, theme));
      const u = rPr?.getAttribute("u");
      const deco = u && u !== "none" ? " data-u" : "";
      html += vars || deco ? `<span style="${vars}"${deco}>${esc(t)}</span>` : esc(t);
      text += t;
    } else if (c.localName === "br") {
      html += "<br>";
      text += " ";
    }
  }
  return { html, text };
}

/** 段落の書式を求める手がかり（図形の lstStyle から presentation.xml まで、優先順） */
type Sources = StyleSource[];

function paraAttrs(pPr: Element | undefined, lvl: number, sources: Sources, theme: Theme): string {
  const s = sources.length ? levelStyle(sources, lvl, theme) : {};
  const algn = pPr?.getAttribute("algn") ?? s.algn;
  const vars = styleVars(s);
  return (vars ? ` style="${vars}"` : "") + (algn && algn !== "l" ? ` data-al="${esc(algn)}"` : "");
}

function paragraphs(txBody: Element | undefined, defaultBullet: boolean, theme: Theme, sources: Sources = []): Para[] {
  const out: Para[] = [];
  for (const p of kids(txBody, "p")) {
    const { html, text } = runs(p, theme);
    if (!text.trim()) continue;
    const pPr = kid(p, "pPr");
    const lvl = Math.min(Number(pPr?.getAttribute("lvl") ?? 0) || 0, 8);
    let bullet: Para["bullet"] = defaultBullet ? "ul" : null;
    if (kid(pPr, "buNone")) bullet = null;
    else if (kid(pPr, "buAutoNum")) bullet = "ol";
    else if (kid(pPr, "buChar") || kid(pPr, "buBlip")) bullet = "ul";
    out.push({ html, text, lvl, bullet, attrs: paraAttrs(pPr, lvl, sources, theme) });
  }
  return out;
}

/** 箇条書きの段落を入れ子のリストに、それ以外を段落にする */
function parasHtml(paras: Para[]): string {
  let out = "";
  const stack: string[] = [];
  const closeAll = () => {
    while (stack.length) out += `</li></${stack.pop()}>`;
  };
  for (const p of paras) {
    if (!p.bullet) {
      closeAll();
      out += `<p${p.attrs}>${p.html}</p>`;
      continue;
    }
    const lvl = Math.min(p.lvl, stack.length);
    if (lvl === stack.length) {
      out += `<${p.bullet}>`;
      stack.push(p.bullet);
    } else {
      while (stack.length > lvl + 1) out += `</li></${stack.pop()}>`;
      out += "</li>";
    }
    out += `<li${p.attrs}>${p.html}`;
  }
  closeAll();
  return out;
}

function tableHtml(tbl: Element, theme: Theme): string {
  let out = "<table><tbody>";
  for (const tr of kids(tbl, "tr")) {
    out += "<tr>";
    for (const tc of kids(tr, "tc")) {
      if (tc.getAttribute("hMerge") === "1" || tc.getAttribute("vMerge") === "1") continue;
      const span = (a: string, n: string) => (Number(tc.getAttribute(a)) > 1 ? ` ${n}="${Number(tc.getAttribute(a))}"` : "");
      const text = kids(kid(tc, "txBody"), "p")
        .map((p) => runs(p, theme))
        .filter((r) => r.text.trim())
        .map((r) => r.html)
        .join("<br>");
      const fill = fillOf(kid(tc, "tcPr"), theme);
      const style = fill && fill.css !== "none" ? ` style="--cf:${esc(fill.css)}"` : "";
      out += `<td${span("gridSpan", "colspan")}${span("rowSpan", "rowspan")}${style}>${text}</td>`;
    }
    out += "</tr>";
  }
  return out + "</tbody></table>";
}

// ---------- 図形 ----------

interface Ph {
  type: string;
  idx: string | null;
}
interface Pos {
  x: number;
  y: number;
}
interface Block {
  pos: Pos | null;
  title: boolean;
  html: string;
  text: string;
}
/** 子の座標 → スライドの座標（EMU）。グループの中の図形は、グループの拡大・移動を受ける */
interface Xf {
  ox: number;
  oy: number;
  sx: number;
  sy: number;
}
const IDENTITY: Xf = { ox: 0, oy: 0, sx: 1, sy: 1 };

function placeholder(el: Element): Ph | null {
  const nv = Array.from(el.children).find((c) => c.localName.startsWith("nv"));
  const ph = path(nv, "nvPr", "ph");
  return ph ? { type: ph.getAttribute("type") ?? "", idx: ph.getAttribute("idx") } : null;
}

function xfrmOf(el: Element | undefined): Element | undefined {
  return path(el, "spPr", "xfrm") ?? path(el, "grpSpPr", "xfrm") ?? kid(el, "xfrm");
}

function offsetOf(el: Element): Pos | null {
  const off = kid(xfrmOf(el), "off");
  if (!off) return null;
  return { x: Number(off.getAttribute("x")) || 0, y: Number(off.getAttribute("y")) || 0 };
}

/** レイアウト・マスターで、スライドのプレースホルダーに対応するもの */
function findPh(ph: Ph, roots: (Element | null)[]): Element | undefined {
  const sameType = (a: string, b: string) => a === b || (TITLE_PH.has(a) && TITLE_PH.has(b));
  for (const root of roots) {
    if (!root) continue;
    const shapes = desc(root, "sp");
    const hit =
      (ph.idx !== null && shapes.find((s) => placeholder(s)?.idx === ph.idx)) ||
      shapes.find((s) => {
        const p = placeholder(s);
        return p && sameType(p.type, ph.type || "body");
      });
    if (hit) return hit;
  }
  return undefined;
}

/** スライドで位置が省略されたプレースホルダーは、レイアウト → マスターの同じプレースホルダーの位置を使う */
function phPosition(ph: Ph, layouts: (Element | null)[]): Pos | null {
  for (const root of layouts) {
    const hit = findPh(ph, [root]);
    const pos = hit && offsetOf(hit);
    if (pos) return pos;
  }
  return null;
}

interface Ctx {
  pkg: Package;
  /** r:embed を解決するパーツ（スライド。飾りのときはレイアウト・マスター） */
  part: string;
  layout: Element | null;
  master: Element | null;
  pres: Element;
  theme: Theme;
  counts: Record<string, number>;
  xf: Xf;
  /** 重なり順（spTree の順に増やす） */
  z: { n: number };
  /** スライドの大きさ（pt） */
  sw: number;
  sh: number;
  /** マスター・レイアウトの飾り（文字は DOM に入れず、プレースホルダーは出さない） */
  deco: boolean;
}

/** 図形の位置と大きさ（スライド上の pt）。プレースホルダーで省略されていればレイアウト・マスターのもの */
function boxOf(ctx: Ctx, el: Element, ph: Ph | null): Box | null {
  let xfrm = xfrmOf(el);
  if ((!kid(xfrm, "off") || !kid(xfrm, "ext")) && ph) {
    for (const root of [ctx.layout, ctx.master]) {
      const x = xfrmOf(findPh(ph, [root]));
      if (kid(x, "off") && kid(x, "ext")) {
        xfrm = x;
        break;
      }
    }
  }
  const off = kid(xfrm, "off");
  const ext = kid(xfrm, "ext");
  if (!off || !ext) return null;
  const { ox, oy, sx, sy } = ctx.xf;
  return {
    x: (ox + (num(off, "x") ?? 0) * sx) / EMU_PER_PT,
    y: (oy + (num(off, "y") ?? 0) * sy) / EMU_PER_PT,
    w: ((num(ext, "cx") ?? 0) * sx) / EMU_PER_PT,
    h: ((num(ext, "cy") ?? 0) * sy) / EMU_PER_PT,
    rot: (num(xfrm, "rot") ?? 0) / 60000,
    flipH: xfrm?.getAttribute("flipH") === "1",
    flipV: xfrm?.getAttribute("flipV") === "1",
  };
}

/** 位置・大きさ（スライドに対する %）と重なり順・回転の CSS 変数 */
function boxVars(ctx: Ctx, b: Box): string {
  return (
    `--x:${n3((b.x / ctx.sw) * 100)};--y:${n3((b.y / ctx.sh) * 100)};--w:${n3((b.w / ctx.sw) * 100)};--h:${n3((b.h / ctx.sh) * 100)};` +
    `--z:${++ctx.z.n};` +
    (b.rot ? `--rot:${n3(b.rot)}deg;` : "")
  );
}

function marker(label: string): string {
  return `<div class="slide-img" data-label="${esc(label)}"></div>`;
}

function adjOf(prstGeom: Element | undefined): number | null {
  const gd = kids(kid(prstGeom, "avLst"), "gd")[0];
  const m = gd?.getAttribute("fmla")?.match(/^val (-?\d+)/);
  return m ? Number(m[1]) : null;
}

/** 線（直線・コネクタ）。折れ点ごとの線分を、回転した細い要素で描く */
function lineHtml(ctx: Ctx, pts: [number, number][], ln: Line): string {
  let segs = "";
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    const head = i === 0 && ln.head ? ` data-head="${ln.head}"` : "";
    const tail = i === pts.length - 2 && ln.tail ? ` data-tail="${ln.tail}"` : "";
    segs += `<div class="sh-seg" style="--x1:${n3(x1)};--y1:${n3(y1)};--len:${n3(len)};--ang:${n3(ang)}deg"${head}${tail}></div>`;
  }
  return `<div class="sh-line" style="--z:${++ctx.z.n};--lw:${n3(ln.width)};--c:${esc(ln.color)}"${ln.dash ? " data-dash" : ""}>${segs}</div>`;
}

interface Look {
  vars: string;
  attrs: string;
  inner: string;
  visible: boolean;
}

/** 図形の形・塗り・枠線 */
async function shapeLook(ctx: Ctx, el: Element, box: Box): Promise<Look> {
  const spPr = kid(el, "spPr");
  const style = kid(el, "style");
  let fill: Fill | null = fillOf(spPr, ctx.theme);
  if (!fill) {
    const c = styleRefColor(style, "fillRef", ctx.theme);
    if (c) fill = { css: c, solid: c };
  }
  const ln = lineOf(spPr, style, ctx.theme);
  const prstGeom = kid(spPr, "prstGeom");
  const ext = kid(xfrmOf(el), "ext");
  const geom: Geom =
    customGeom(kid(spPr, "custGeom"), num(ext, "cx") ?? undefined, num(ext, "cy") ?? undefined) ??
    presetGeom(prstGeom?.getAttribute("prst"), adjOf(prstGeom), box.w, box.h);
  let vars = "";
  let attrs = ` data-geo="${geom.kind}"`;
  let inner = "";
  const image = fill?.imageRid ? await ctx.pkg.image(ctx.part, fill.imageRid) : null;
  if (image) vars += `--img:url(&quot;${image}&quot;);`;
  if (geom.kind === "path") {
    const sf = fill && fill.solid !== "none" ? fill.solid : "none";
    const flip = (box.flipH ? " data-fh" : "") + (box.flipV ? " data-fv" : "");
    inner = `<svg class="sh-geo" viewBox="0 0 1 1" preserveAspectRatio="none"${flip}><path d="${esc(geom.d)}" style="--sf:${esc(sf)}${ln ? `;--ln:${esc(ln.color)};--lw:${n3(ln.width)}` : ""}"${ln?.dash ? " data-dash" : ""}></path></svg>`;
  } else {
    if (fill && fill.css !== "none") vars += `--fill:${esc(fill.css)};`;
    if (ln) vars += `--ln:${esc(ln.color)};--lw:${n3(ln.width)};`;
    if (ln?.dash) attrs += " data-dash";
    if (geom.kind === "roundRect") vars += `--rad:${n3(geom.radius)};`;
  }
  const visible = !!image || !!ln || (!!fill && fill.css !== "none");
  return { vars, attrs, inner, visible };
}

/** 文字の枠の設定（余白・縦位置・折り返し・縦書き・自動縮小）。プレースホルダーはレイアウト・マスターから受け継ぐ */
function bodyAttrs(bodyPrs: (Element | undefined)[]): { vars: string; attrs: string } {
  const pick = (name: string) => {
    for (const b of bodyPrs) {
      const v = b?.getAttribute(name);
      if (v !== null && v !== undefined) return v;
    }
    return null;
  };
  const ins = (name: string, def: number) => n3((Number(pick(name) ?? def) || 0) / EMU_PER_PT);
  let vars = `--il:${ins("lIns", 91440)};--it:${ins("tIns", 45720)};--ir:${ins("rIns", 91440)};--ib:${ins("bIns", 45720)};`;
  const scale = num(bodyPrs.map((b) => kid(b, "normAutofit")).find(Boolean), "fontScale");
  if (scale) vars += `--fsc:${n3(scale / 100000)};`;
  let attrs = "";
  const anchor = pick("anchor");
  if (anchor && anchor !== "t") attrs += ` data-va="${esc(anchor)}"`;
  if (pick("wrap") === "none") attrs += " data-nowrap";
  const vert = pick("vert");
  if (vert && vert !== "horz") attrs += " data-vert";
  return { vars, attrs };
}

/** 段落の書式の手がかり（優先順） */
function textSources(ctx: Ctx, el: Element, ph: Ph | null): { sources: Sources; bodyPrs: (Element | undefined)[] } {
  const own = kid(kid(el, "txBody"), "lstStyle");
  const ownBody = kid(kid(el, "txBody"), "bodyPr");
  const defaults = kid(ctx.pres, "defaultTextStyle");
  if (!ph) {
    const fontColor = styleRefColor(kid(el, "style"), "fontRef", ctx.theme);
    const fontRef: TextStyle | undefined = fontColor ? { color: fontColor } : undefined;
    return { sources: [own, fontRef, defaults], bodyPrs: [ownBody] };
  }
  const lay = findPh(ph, [ctx.layout]);
  const mas = findPh(ph, [ctx.master]);
  const which = TITLE_PH.has(ph.type) ? "titleStyle" : BODY_STYLE_PH.has(ph.type) ? "bodyStyle" : "otherStyle";
  const txStyle = kid(path(ctx.master ?? undefined, "txStyles"), which);
  const lst = (s: Element | undefined) => kid(kid(s, "txBody"), "lstStyle");
  const body = (s: Element | undefined) => kid(kid(s, "txBody"), "bodyPr");
  return { sources: [own, lst(lay), lst(mas), txStyle, defaults], bodyPrs: [ownBody, body(lay), body(mas)] };
}

async function smartArtHtml(ctx: Ctx, frame: Element): Promise<string | null> {
  const relIds = desc(frame, "relIds")[0];
  const dm = rid(relIds, "dm");
  const target = dm && (await ctx.pkg.rels(ctx.part)).get(dm)?.target;
  const data = target ? await ctx.pkg.xml(target) : null;
  if (!data) return null;
  const items: Para[] = [];
  for (const pt of desc(data, "pt")) {
    const type = pt.getAttribute("type");
    if (type && type !== "node") continue;
    for (const p of paragraphs(kid(pt, "t"), true, ctx.theme)) items.push({ ...p, bullet: "ul" });
  }
  return items.length ? parasHtml(items) : null;
}

/** 位置のある箱で包む（位置が分からなければ包まない。図の表示では流れに沿って置かれる） */
function wrap(ctx: Ctx, box: Box | null, cls: string, body: string, vars = "", attrs = ""): string {
  if (!box) return `<div class="${cls}" data-nopos>${body}</div>`;
  return `<div class="${cls}" style="${boxVars(ctx, box)}${vars}"${attrs}>${body}</div>`;
}

async function shapeBlocks(ctx: Ctx, el: Element): Promise<Block[]> {
  const pos = offsetOf(el);
  switch (el.localName) {
    case "sp": {
      const ph = placeholder(el);
      if (ph && (SKIP_PH.has(ph.type) || ctx.deco)) return [];
      const box = boxOf(ctx, el, ph);
      const prst = path(el, "spPr", "prstGeom")?.getAttribute("prst");
      const { sources, bodyPrs } = textSources(ctx, el, ph);
      const title = !ctx.deco && !!ph && TITLE_PH.has(ph.type);
      const paras = paragraphs(kid(el, "txBody"), !!ph && BULLET_PH.has(ph.type), ctx.theme, sources);
      const body = bodyAttrs(bodyPrs);
      // 線の形の図形は線として描く。文字があれば（まれ）線と同じ場所に文字の枠を重ねる（文字は消さない）
      if (box && prst && LINE_PRST.test(prst)) {
        const ln = lineOf(kid(el, "spPr"), kid(el, "style"), ctx.theme);
        const line = ln ? lineHtml(ctx, connectorPoints(prst, box, adjOf(path(el, "spPr", "prstGeom"))), ln) : "";
        if (!paras.length || ctx.deco) return line ? [{ pos, title: false, html: line, text: "" }] : [];
        const tx = wrap(ctx, box, "sh", `<div class="sh-tx" style="${body.vars}"${body.attrs}>${parasHtml(paras)}</div>`);
        return [{ pos, title, html: line + tx, text: paras.map((p) => p.text).join(" ") }];
      }
      const look = box ? await shapeLook(ctx, el, box) : null;
      if (ctx.deco) {
        // 飾りの文字は DOM の文字に入れず、CSS で表示する
        const text = paras.map((p) => p.text).join("\n");
        if (!box || (!look?.visible && !text)) return [];
        // 書式は最初の段落（と、その最初の文字の範囲）のものを全体に使う
        const p0 = kids(kid(el, "txBody"), "p").find((p) => p.textContent?.trim());
        const first = paras[0] ? { ...levelStyle(sources, paras[0].lvl, ctx.theme), ...runStyleOf(path(p0, "r", "rPr"), ctx.theme) } : {};
        const algn = p0 && (kid(p0, "pPr")?.getAttribute("algn") ?? (paras[0] ? levelStyle(sources, paras[0].lvl, ctx.theme).algn : undefined));
        const al = algn && algn !== "l" ? ` data-al="${esc(algn)}"` : "";
        const tx = text ? `<div class="sh-tx" style="${body.vars}${styleVars(first)}"${body.attrs}${al} data-deco="${esc(text)}"></div>` : "";
        return [{ pos, title: false, html: wrap(ctx, box, "sh sh-deco", look!.inner + tx, look!.vars, look!.attrs), text: "" }];
      }
      if (!paras.length) {
        // 文字の無い図形（飾り・矢印など）は形だけ
        if (!box || !look?.visible) return [];
        return [{ pos, title: false, html: wrap(ctx, box, "sh", look.inner, look.vars, look.attrs), text: "" }];
      }
      const textHtml = title ? `<h2${paras[0].attrs}>${paras.map((p) => p.html).join("<br>")}</h2>` : parasHtml(paras);
      const html = wrap(
        ctx,
        box,
        "sh",
        `${look?.inner ?? ""}<div class="sh-tx" style="${body.vars}"${body.attrs}>${textHtml}</div>`,
        look?.vars,
        look?.attrs,
      );
      const text = paras.map((p) => p.text).join(" ");
      return [{ pos: pos ?? (ph ? phPosition(ph, [ctx.layout, ctx.master]) : null), title, html, text }];
    }
    case "cxnSp": {
      const box = boxOf(ctx, el, null);
      const ln = lineOf(kid(el, "spPr"), kid(el, "style"), ctx.theme);
      if (!box || !ln) return [];
      const g = path(el, "spPr", "prstGeom");
      return [{ pos, title: false, html: lineHtml(ctx, connectorPoints(g?.getAttribute("prst"), box, adjOf(g)), ln), text: "" }];
    }
    case "grpSp": {
      // グループの中は中で位置順に並べ、グループの位置にまとめて置く。中の図形の座標はグループの拡大・移動を受ける
      const xfrm = xfrmOf(el);
      const [off, ext, chOff, chExt] = ["off", "ext", "chOff", "chExt"].map((n) => kid(xfrm, n));
      const gsx = num(chExt, "cx") ? (num(ext, "cx") ?? 0) / num(chExt, "cx")! : 1;
      const gsy = num(chExt, "cy") ? (num(ext, "cy") ?? 0) / num(chExt, "cy")! : 1;
      const { ox, oy, sx, sy } = ctx.xf;
      const xf: Xf = {
        ox: ox + ((num(off, "x") ?? 0) - (num(chOff, "x") ?? 0) * gsx) * sx,
        oy: oy + ((num(off, "y") ?? 0) - (num(chOff, "y") ?? 0) * gsy) * sy,
        sx: sx * gsx,
        sy: sy * gsy,
      };
      // 回転したグループは、中の図形をまとめてグループの中心で回す（重なり順はグループの位置で決める）
      const rot = (num(xfrm, "rot") ?? 0) / 60000;
      const z = rot ? ++ctx.z.n : 0;
      const inner = await childBlocks({ ...ctx, xf }, el, !ctx.deco);
      if (!inner.length) return [];
      let html = inner.map((b) => b.html).join("");
      const gbox = boxOf(ctx, el, null);
      if (rot && gbox) {
        const ox = ((gbox.x + gbox.w / 2) / ctx.sw) * 100;
        const oy = ((gbox.y + gbox.h / 2) / ctx.sh) * 100;
        html = `<div class="sh-grp" style="--z:${z};--ox:${n3(ox)};--oy:${n3(oy)};--rot:${n3(rot)}deg">${html}</div>`;
      }
      return [{ pos, title: false, html, text: "" }];
    }
    case "pic": {
      const ph = placeholder(el);
      const box = boxOf(ctx, el, ph);
      const descr = path(el, "nvPicPr", "cNvPr")?.getAttribute("descr")?.trim();
      const media = path(el, "nvPicPr", "nvPr");
      const isMovie = !!(kid(media, "videoFile") || kid(media, "audioFile") || desc(el, "media").length);
      const r = rid(path(el, "blipFill", "blip"), "embed");
      const url = r ? await ctx.pkg.image(ctx.part, r) : null;
      const src = rect(path(el, "blipFill", "srcRect"));
      // src は無害化（DOMPurify は blob: を消す）の後で data-src から入れる
      const img = url ? `<img class="pic" data-src="${esc(url)}" alt="" draggable="false"${src ? ` style="${src}"` : ""}>` : "";
      if (ctx.deco) return box && img ? [{ pos, title: false, html: wrap(ctx, box, "sh sh-pic sh-deco", img), text: "" }] : [];
      ctx.counts[isMovie ? "media" : "image"] = (ctx.counts[isMovie ? "media" : "image"] ?? 0) + 1;
      if (r && !url && !isMovie) ctx.counts.unsupportedImage = (ctx.counts.unsupportedImage ?? 0) + 1;
      const label = isMovie ? "動画・音声" : "画像";
      // 動画・音声は表紙の画像の上に目印を重ねる（再生はできないので）
      return [{ pos, title: false, html: wrap(ctx, box, isMovie ? "sh sh-pic sh-media" : "sh sh-pic", marker(descr ? `${label}: ${descr}` : label) + img), text: "" }];
    }
    case "graphicFrame": {
      if (ctx.deco) return [];
      const box = boxOf(ctx, el, null);
      const data = path(el, "graphic", "graphicData");
      const uri = data?.getAttribute("uri") ?? "";
      const tbl = kid(data, "tbl");
      if (tbl) return [{ pos, title: false, html: wrap(ctx, box, "sh sh-tbl", tableHtml(tbl, ctx.theme)), text: "" }];
      if (uri.endsWith("/diagram")) {
        const html = await smartArtHtml(ctx, el);
        if (html) return [{ pos, title: false, html: wrap(ctx, box, "sh sh-smart", html), text: "" }];
        ctx.counts.smartart = (ctx.counts.smartart ?? 0) + 1;
        return [{ pos, title: false, html: wrap(ctx, box, "sh sh-mark", marker("SmartArt")), text: "" }];
      }
      if (uri.includes("chart")) {
        ctx.counts.chart = (ctx.counts.chart ?? 0) + 1;
        return [{ pos, title: false, html: wrap(ctx, box, "sh sh-mark", marker("グラフ")), text: "" }];
      }
      ctx.counts.other = (ctx.counts.other ?? 0) + 1;
      return [{ pos, title: false, html: wrap(ctx, box, "sh sh-mark", marker("埋め込みオブジェクト")), text: "" }];
    }
    case "AlternateContent": {
      // 新しい機能の図形は Choice、古い PowerPoint 向けの代替が Fallback に入る
      const branch = kid(el, "Choice") ?? kid(el, "Fallback");
      const out: Block[] = [];
      for (const c of Array.from(branch?.children ?? [])) out.push(...(await shapeBlocks(ctx, c)));
      return out;
    }
    default:
      return [];
  }
}

/** 画像の切り抜き（a:srcRect。1/1000 %）を、はみ出した分を隠す img の位置と大きさにする */
function rect(srcRect: Element | undefined): string {
  if (!srcRect) return "";
  const [l, t, r, b] = ["l", "t", "r", "b"].map((k) => (num(srcRect, k) ?? 0) / 100000);
  if (!l && !t && !r && !b) return "";
  const w = 1 - l - r;
  const h = 1 - t - b;
  if (w <= 0 || h <= 0) return "";
  return `--cl:${n3((-l / w) * 100)}%;--ct:${n3((-t / h) * 100)}%;--cw:${n3(100 / w)}%;--ch:${n3(100 / h)}%`;
}

/** タイトルを先頭に、残りは上から・左からの順に並べる（保存順は重なり順で、読む順とは限らない） */
async function childBlocks(ctx: Ctx, tree: Element, sort = true): Promise<Block[]> {
  const blocks: Block[] = [];
  for (const c of Array.from(tree.children)) blocks.push(...(await shapeBlocks(ctx, c)));
  if (!sort) return blocks;
  const order = blocks.map((b, i) => ({ b, i }));
  order.sort((a, b) => {
    if (a.b.title !== b.b.title) return a.b.title ? -1 : 1;
    if (a.b.pos && b.b.pos) return a.b.pos.y - b.b.pos.y || a.b.pos.x - b.b.pos.x || a.i - b.i;
    return a.i - b.i;
  });
  return order.map((o) => o.b);
}

async function notesHtml(pkg: Package, slidePart: string): Promise<string> {
  const part = await pkg.relOfType(slidePart, "/notesSlide");
  const root = part ? await pkg.xml(part) : null;
  if (!root) return "";
  let out = "";
  for (const sp of desc(root, "sp")) {
    const ph = placeholder(sp);
    if (ph?.type !== "body") continue;
    out += parasHtml(paragraphs(kid(sp, "txBody"), false, EMPTY_THEME));
  }
  return out ? `<aside class="slide-notes">${out}</aside>` : "";
}

/** 背景（スライド → レイアウト → マスターの順に、最初に指定のあるもの）。CSS の background の値 */
async function background(pkg: Package, parts: { part: string; root: Element | null }[], theme: Theme): Promise<string> {
  for (const { part, root } of parts) {
    const bg = path(root ?? undefined, "cSld", "bg");
    if (!bg) continue;
    const bgPr = kid(bg, "bgPr");
    const fill = fillOf(bgPr, theme);
    if (fill?.imageRid) {
      const url = await pkg.image(part, fill.imageRid);
      if (url) return `url(&quot;${url}&quot;) center / 100% 100%`;
    }
    if (fill && fill.css !== "none") return esc(fill.css);
    const ref = colorOf(kid(bg, "bgRef"), theme);
    if (ref) return ref;
  }
  return "#fff";
}

/** マスター・レイアウトの飾りの図形（プレースホルダー以外）。重なり順はスライドの図形より下 */
async function decoHtml(ctx: Ctx, part: string | null, root: Element | null): Promise<string> {
  const tree = path(root ?? undefined, "cSld", "spTree");
  if (!part || !tree) return "";
  const blocks = await childBlocks({ ...ctx, part, deco: true, xf: IDENTITY }, tree, false);
  return blocks.map((b) => b.html).join("");
}

// ---------- 全体 ----------

export async function pptxToHtml(data: ArrayBuffer): Promise<PptxHtml> {
  const zip = await JSZip.loadAsync(data);
  const pkg = new Package(zip);
  const presPart = "ppt/presentation.xml";
  const pres = await pkg.xml(presPart);
  if (!pres) throw new Error("presentation.xml がありません");
  const presRels = await pkg.rels(presPart);
  const sldSz = kid(pres, "sldSz");
  const sw = (num(sldSz, "cx") || DEFAULT_SLIDE.cx) / EMU_PER_PT;
  const sh = (num(sldSz, "cy") || DEFAULT_SLIDE.cy) / EMU_PER_PT;

  const counts: Record<string, number> = {};
  const warnings: string[] = [];
  let html = "";
  let no = 0;
  for (const sldId of kids(kid(pres, "sldIdLst"), "sldId")) {
    const target = presRels.get(rid(sldId, "id") ?? "")?.target;
    const slide = target ? await pkg.xml(target) : null;
    if (!target || !slide) continue;
    no++;
    const layoutPart = await pkg.relOfType(target, "/slideLayout");
    const masterPart = layoutPart && (await pkg.relOfType(layoutPart, "/slideMaster"));
    const layout = layoutPart ? await pkg.xml(layoutPart) : null;
    const master = masterPart ? await pkg.xml(masterPart) : null;
    const themePart = masterPart && (await pkg.relOfType(masterPart, "/theme"));
    // 色の呼び名の対応（bg1 → lt1 など）は、スライド → レイアウトの上書き（clrMapOvr）があればそれ、無ければマスター
    const override = [slide, layout].map((r) => path(r ?? undefined, "clrMapOvr", "overrideClrMapping")).find(Boolean);
    const theme = parseTheme(themePart ? await pkg.xml(themePart) : null, override ?? kid(master ?? undefined, "clrMap"));

    const ctx: Ctx = { pkg, part: target, layout, master, pres, theme, counts, xf: IDENTITY, z: { n: 0 }, sw, sh, deco: false };
    // 飾りはスライドの図形より下に重ねるので先に作る
    let deco = "";
    if (slide.getAttribute("showMasterSp") !== "0") {
      if (layout?.getAttribute("showMasterSp") !== "0") deco += await decoHtml(ctx, masterPart, master);
      deco += await decoHtml(ctx, layoutPart, layout);
    }
    const tree = path(slide, "cSld", "spTree");
    const blocks = tree ? await childBlocks(ctx, tree) : [];
    const bg = await background(
      pkg,
      [
        { part: target, root: slide },
        { part: layoutPart ?? "", root: layout },
        { part: masterPart ?? "", root: master },
      ],
      theme,
    );

    const title = blocks.find((b) => b.title)?.text.trim() ?? "";
    const hidden = slide.getAttribute("show") === "0";
    const attrs =
      `data-slide="${no}" data-slide-id="${esc(sldId.getAttribute("id") ?? "")}" data-title="${esc(title.slice(0, 80))}"` +
      (hidden ? " data-hidden" : "");
    const canvas = `<div class="slide-canvas" style="--sw:${n3(sw)};--shh:${n3(sh)};--bg:${bg}">${deco}${blocks.map((b) => b.html).join("")}</div>`;
    html += `<section class="slide" ${attrs}>${canvas}${await notesHtml(pkg, target)}</section>`;
  }

  if (counts.unsupportedImage) warnings.push(`表示できない形式の画像（EMF など）${counts.unsupportedImage} 個は目印だけを表示しています`);
  if (counts.chart) warnings.push(`グラフ ${counts.chart} 個は目印だけを表示しています`);
  if (counts.smartart) warnings.push(`SmartArt ${counts.smartart} 個は文字を取り出せませんでした`);
  if (counts.media) warnings.push(`動画・音声 ${counts.media} 個は目印だけを表示しています`);
  if (counts.other) warnings.push(`埋め込みオブジェクト ${counts.other} 個は目印だけを表示しています`);

  const tpl = document.createElement("template");
  tpl.innerHTML = DOMPurify.sanitize(html, { ADD_TAGS: ["section", "aside"], ADD_ATTR: ["data-hidden", "data-nopos", "data-nowrap", "data-vert", "data-dash", "data-u", "data-fh", "data-fv"] });
  let i = 0;
  tpl.content.querySelectorAll(BLOCK_SELECTOR).forEach((el) => el.setAttribute("data-para", String(++i)));
  // 画像の URL は、ここで作った blob URL か data URL だけ（無害化の後に入れる）
  const made = new Set(pkg.urls);
  tpl.content.querySelectorAll<HTMLImageElement>("img[data-src]").forEach((img) => {
    const u = img.getAttribute("data-src") ?? "";
    if (made.has(u) || u.startsWith("data:image/")) img.setAttribute("src", u);
    img.removeAttribute("data-src");
  });
  const out = tpl.innerHTML;
  let viewKey = out;
  for (const [u, t] of pkg.urlTargets) viewKey = viewKey.split(u).join(`zip:${t}`);
  return { html: out, text: tpl.content.textContent ?? "", warnings, slideCount: no, urls: pkg.urls, viewKey };
}
