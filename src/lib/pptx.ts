import DOMPurify from "dompurify";
import JSZip from "jszip";

/**
 * PowerPoint (.pptx) を「スライドごとの文字のカード」として HTML にする。
 * 図形の配置・色・アニメーションは再現せず、文字・表・発表者ノートだけを取り出す。
 *
 * 出力:
 * <section class="slide" data-slide="3" data-slide-id="259" data-title="…" [data-hidden]>
 *   <h2>タイトル</h2> <p>…</p> <ul><li>…</li></ul> <table>…</table>
 *   <div class="slide-img" data-label="画像: 説明"></div>   ← 目印（文字は CSS で表示。アンカーの文字には含めない）
 *   <aside class="slide-notes"><p>発表者ノート</p></aside>
 * </section>
 */
export interface PptxHtml {
  html: string;
  /** 本文テキスト（版の判定に使う） */
  text: string;
  warnings: string[];
  slideCount: number;
}

const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const BLOCK_SELECTOR = "p,h1,h2,h3,h4,h5,h6,li";
/** 本文として扱わないプレースホルダー（スライド番号・日付・フッターなど） */
const SKIP_PH = new Set(["sldNum", "dt", "ftr", "hdr", "sldImg"]);
const TITLE_PH = new Set(["title", "ctrTitle"]);
/** 箇条書きが既定になるプレースホルダー（type なしは「コンテンツ」） */
const BULLET_PH = new Set(["body", "obj", ""]);

// ---------- XML ヘルパー ----------

function kids(el: Element | null | undefined, name: string): Element[] {
  return el ? Array.from(el.children).filter((c) => c.localName === name) : [];
}
function kid(el: Element | null | undefined, name: string): Element | undefined {
  return el ? Array.from(el.children).find((c) => c.localName === name) : undefined;
}
function path(el: Element | null | undefined, ...names: string[]): Element | undefined {
  let cur: Element | undefined = el ?? undefined;
  for (const n of names) cur = kid(cur, n);
  return cur;
}
function desc(el: Element, name: string): Element[] {
  return Array.from(el.getElementsByTagNameNS("*", name));
}
function rid(el: Element | undefined, local: string): string | null {
  if (!el) return null;
  return el.getAttributeNS(R_NS, local) ?? el.getAttribute(`r:${local}`);
}
function parseXml(s: string): Element {
  return new DOMParser().parseFromString(s, "application/xml").documentElement;
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
}

// ---------- 文字 ----------

interface Para {
  html: string;
  /** 改行を空白にしたプレーンテキスト */
  text: string;
  lvl: number;
  bullet: "ul" | "ol" | null;
}

function runs(p: Element): { html: string; text: string } {
  let html = "";
  let text = "";
  for (const c of Array.from(p.children)) {
    if (c.localName === "r" || c.localName === "fld") {
      const t = kid(c, "t")?.textContent ?? "";
      html += esc(t);
      text += t;
    } else if (c.localName === "br") {
      html += "<br>";
      text += " ";
    }
  }
  return { html, text };
}

function paragraphs(txBody: Element | undefined, defaultBullet: boolean): Para[] {
  const out: Para[] = [];
  for (const p of kids(txBody, "p")) {
    const { html, text } = runs(p);
    if (!text.trim()) continue;
    const pPr = kid(p, "pPr");
    const lvl = Math.min(Number(pPr?.getAttribute("lvl") ?? 0) || 0, 8);
    let bullet: Para["bullet"] = defaultBullet ? "ul" : null;
    if (kid(pPr, "buNone")) bullet = null;
    else if (kid(pPr, "buAutoNum")) bullet = "ol";
    else if (kid(pPr, "buChar") || kid(pPr, "buBlip")) bullet = "ul";
    out.push({ html, text, lvl, bullet });
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
      out += `<p>${p.html}</p>`;
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
    out += `<li>${p.html}`;
  }
  closeAll();
  return out;
}

function tableHtml(tbl: Element): string {
  let out = "<table><tbody>";
  for (const tr of kids(tbl, "tr")) {
    out += "<tr>";
    for (const tc of kids(tr, "tc")) {
      if (tc.getAttribute("hMerge") === "1" || tc.getAttribute("vMerge") === "1") continue;
      const span = (a: string, n: string) => (Number(tc.getAttribute(a)) > 1 ? ` ${n}="${Number(tc.getAttribute(a))}"` : "");
      const text = kids(kid(tc, "txBody"), "p")
        .map(runs)
        .filter((r) => r.text.trim())
        .map((r) => r.html)
        .join("<br>");
      out += `<td${span("gridSpan", "colspan")}${span("rowSpan", "rowspan")}>${text}</td>`;
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

function placeholder(el: Element): Ph | null {
  const nv = Array.from(el.children).find((c) => c.localName.startsWith("nv"));
  const ph = path(nv, "nvPr", "ph");
  return ph ? { type: ph.getAttribute("type") ?? "", idx: ph.getAttribute("idx") } : null;
}

function offsetOf(el: Element): Pos | null {
  const xfrm = path(el, "spPr", "xfrm") ?? path(el, "grpSpPr", "xfrm") ?? kid(el, "xfrm");
  const off = kid(xfrm, "off");
  if (!off) return null;
  return { x: Number(off.getAttribute("x")) || 0, y: Number(off.getAttribute("y")) || 0 };
}

/** スライドで位置が省略されたプレースホルダーは、レイアウト → マスターの同じプレースホルダーの位置を使う */
function phPosition(ph: Ph, layouts: Element[]): Pos | null {
  const sameType = (a: string, b: string) => a === b || (TITLE_PH.has(a) && TITLE_PH.has(b));
  for (const root of layouts) {
    const shapes = desc(root, "sp");
    const hit =
      (ph.idx !== null && shapes.find((s) => placeholder(s)?.idx === ph.idx)) ||
      shapes.find((s) => {
        const p = placeholder(s);
        return p && sameType(p.type, ph.type || "body");
      });
    const pos = hit && offsetOf(hit);
    if (pos) return pos;
  }
  return null;
}

interface Ctx {
  pkg: Package;
  slidePart: string;
  layouts: Element[];
  counts: Record<string, number>;
}

function marker(label: string): string {
  return `<div class="slide-img" data-label="${esc(label)}"></div>`;
}

async function smartArtHtml(ctx: Ctx, frame: Element): Promise<string | null> {
  const relIds = desc(frame, "relIds")[0];
  const dm = rid(relIds, "dm");
  const target = dm && (await ctx.pkg.rels(ctx.slidePart)).get(dm)?.target;
  const data = target ? await ctx.pkg.xml(target) : null;
  if (!data) return null;
  const items: Para[] = [];
  for (const pt of desc(data, "pt")) {
    const type = pt.getAttribute("type");
    if (type && type !== "node") continue;
    for (const p of paragraphs(kid(pt, "t"), true)) items.push({ ...p, bullet: "ul" });
  }
  return items.length ? parasHtml(items) : null;
}

async function shapeBlocks(ctx: Ctx, el: Element): Promise<Block[]> {
  const pos = offsetOf(el);
  switch (el.localName) {
    case "sp": {
      const ph = placeholder(el);
      if (ph && SKIP_PH.has(ph.type)) return [];
      const title = !!ph && TITLE_PH.has(ph.type);
      const paras = paragraphs(kid(el, "txBody"), !!ph && BULLET_PH.has(ph.type));
      if (!paras.length) return [];
      const html = title
        ? `<h2>${paras.map((p) => p.html).join("<br>")}</h2>`
        : parasHtml(paras);
      const text = paras.map((p) => p.text).join(" ");
      return [{ pos: pos ?? (ph ? phPosition(ph, ctx.layouts) : null), title, html, text }];
    }
    case "grpSp": {
      // グループの中は中で位置順に並べ、グループの位置にまとめて置く
      const inner = await childBlocks(ctx, el);
      return inner.length ? [{ pos, title: false, html: inner.map((b) => b.html).join(""), text: "" }] : [];
    }
    case "pic": {
      const descr = path(el, "nvPicPr", "cNvPr")?.getAttribute("descr")?.trim();
      const media = path(el, "nvPicPr", "nvPr");
      const isMovie = !!(kid(media, "videoFile") || kid(media, "audioFile") || desc(el, "media").length);
      ctx.counts[isMovie ? "media" : "image"] = (ctx.counts[isMovie ? "media" : "image"] ?? 0) + 1;
      const label = isMovie ? "動画・音声" : "画像";
      return [{ pos, title: false, html: marker(descr ? `${label}: ${descr}` : label), text: "" }];
    }
    case "graphicFrame": {
      const data = path(el, "graphic", "graphicData");
      const uri = data?.getAttribute("uri") ?? "";
      const tbl = kid(data, "tbl");
      if (tbl) return [{ pos, title: false, html: tableHtml(tbl), text: "" }];
      if (uri.endsWith("/diagram")) {
        const html = await smartArtHtml(ctx, el);
        if (html) return [{ pos, title: false, html, text: "" }];
        ctx.counts.smartart = (ctx.counts.smartart ?? 0) + 1;
        return [{ pos, title: false, html: marker("SmartArt"), text: "" }];
      }
      if (uri.includes("chart")) {
        ctx.counts.chart = (ctx.counts.chart ?? 0) + 1;
        return [{ pos, title: false, html: marker("グラフ"), text: "" }];
      }
      ctx.counts.other = (ctx.counts.other ?? 0) + 1;
      return [{ pos, title: false, html: marker("埋め込みオブジェクト"), text: "" }];
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

/** タイトルを先頭に、残りは上から・左からの順に並べる（保存順は重なり順で、読む順とは限らない） */
async function childBlocks(ctx: Ctx, tree: Element): Promise<Block[]> {
  const blocks: Block[] = [];
  for (const c of Array.from(tree.children)) blocks.push(...(await shapeBlocks(ctx, c)));
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
    out += parasHtml(paragraphs(kid(sp, "txBody"), false));
  }
  return out ? `<aside class="slide-notes">${out}</aside>` : "";
}

// ---------- 全体 ----------

export async function pptxToHtml(data: ArrayBuffer): Promise<PptxHtml> {
  const zip = await JSZip.loadAsync(data);
  const pkg = new Package(zip);
  const presPart = "ppt/presentation.xml";
  const pres = await pkg.xml(presPart);
  if (!pres) throw new Error("presentation.xml がありません");
  const presRels = await pkg.rels(presPart);

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
    const layouts = (await Promise.all([layoutPart, masterPart].map((p) => (p ? pkg.xml(p) : null)))).filter(
      (x): x is Element => !!x,
    );
    const tree = path(slide, "cSld", "spTree");
    const blocks = tree ? await childBlocks({ pkg, slidePart: target, layouts, counts }, tree) : [];
    const title = blocks.find((b) => b.title)?.text.trim() ?? "";
    const hidden = slide.getAttribute("show") === "0";
    const attrs =
      `data-slide="${no}" data-slide-id="${esc(sldId.getAttribute("id") ?? "")}" data-title="${esc(title.slice(0, 80))}"` +
      (hidden ? " data-hidden" : "");
    html += `<section class="slide" ${attrs}>${blocks.map((b) => b.html).join("")}${await notesHtml(pkg, target)}</section>`;
  }

  if (counts.chart) warnings.push(`グラフ ${counts.chart} 個は目印だけを表示しています`);
  if (counts.smartart) warnings.push(`SmartArt ${counts.smartart} 個は文字を取り出せませんでした`);
  if (counts.media) warnings.push(`動画・音声 ${counts.media} 個は目印だけを表示しています`);
  if (counts.other) warnings.push(`埋め込みオブジェクト ${counts.other} 個は目印だけを表示しています`);

  const tpl = document.createElement("template");
  tpl.innerHTML = DOMPurify.sanitize(html, { ADD_TAGS: ["section", "aside"], ADD_ATTR: ["data-hidden"] });
  let i = 0;
  tpl.content.querySelectorAll(BLOCK_SELECTOR).forEach((el) => el.setAttribute("data-para", String(++i)));
  return { html: tpl.innerHTML, text: tpl.content.textContent ?? "", warnings, slideCount: no };
}
