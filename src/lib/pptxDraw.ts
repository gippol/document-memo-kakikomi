/**
 * PowerPoint の見た目（色・塗り・線・図形の形・文字の書式）を、表示用の CSS の値にする。
 * pptx.ts がスライドの図形を位置どおりに並べるときに使う。
 *
 * 単位: PowerPoint の長さは EMU（1pt = 12700 EMU）。文字の大きさは 1/100 pt。
 * 表示側（index.css の .pptx-layout）は pt を CSS 変数 --pt（スライドの幅に合わせて伸び縮みする長さ）に掛けて使う。
 */

export const EMU_PER_PT = 12700;

// ---------- XML ヘルパー ----------

export function kids(el: Element | null | undefined, name: string): Element[] {
  return el ? Array.from(el.children).filter((c) => c.localName === name) : [];
}
export function kid(el: Element | null | undefined, name: string): Element | undefined {
  return el ? Array.from(el.children).find((c) => c.localName === name) : undefined;
}
export function path(el: Element | null | undefined, ...names: string[]): Element | undefined {
  let cur: Element | undefined = el ?? undefined;
  for (const n of names) cur = kid(cur, n);
  return cur;
}
export function num(el: Element | undefined, attr: string): number | null {
  const v = el?.getAttribute(attr);
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
/** CSS の数値（長い小数を出さない） */
export function n3(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

// ---------- 色 ----------

/** テーマの色（dk1・lt1・accent1 など → "RRGGBB"）と、スライドでの呼び名の対応（bg1 → lt1 など） */
export interface Theme {
  colors: Record<string, string>;
  map: Record<string, string>;
  /** 線のスタイル（lnStyleLst）の太さ（pt）。p:style の lnRef の idx（1 始まり）で選ぶ */
  lineWidths: number[];
}

export const EMPTY_THEME: Theme = { colors: {}, map: {}, lineWidths: [] };

const DEFAULT_MAP: Record<string, string> = { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" };

/** a:theme と p:clrMap（マスター）から、色の対応表を作る */
export function parseTheme(theme: Element | null, clrMap: Element | undefined): Theme {
  const colors: Record<string, string> = {};
  const scheme = theme ? Array.from(theme.getElementsByTagNameNS("*", "clrScheme"))[0] : undefined;
  for (const c of Array.from(scheme?.children ?? [])) {
    const v = kid(c, "srgbClr")?.getAttribute("val") ?? kid(c, "sysClr")?.getAttribute("lastClr");
    if (v && /^[0-9a-f]{6}$/i.test(v)) colors[c.localName] = v;
  }
  const map: Record<string, string> = { ...DEFAULT_MAP };
  for (const a of Array.from(clrMap?.attributes ?? [])) map[a.name] = a.value;
  const lnStyles = theme ? Array.from(theme.getElementsByTagNameNS("*", "lnStyleLst"))[0] : undefined;
  const lineWidths = kids(lnStyles, "ln").map((ln) => (num(ln, "w") ?? 9525) / EMU_PER_PT);
  return { colors, map, lineWidths };
}

const PRESET: Record<string, string> = {
  black: "000000",
  white: "FFFFFF",
  red: "FF0000",
  green: "008000",
  blue: "0000FF",
  yellow: "FFFF00",
  gray: "808080",
  grey: "808080",
  orange: "FFA500",
  darkGray: "A9A9A9",
  lightGray: "D3D3D3",
  darkBlue: "00008B",
  darkRed: "8B0000",
  darkGreen: "006400",
};

const COLOR_TAGS = ["srgbClr", "schemeClr", "sysClr", "prstClr", "scrgbClr", "hslClr"];

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * 色を表す要素（a:solidFill・a:fillRef など、色の子要素を持つもの）から CSS の色を作る。
 * テーマの色（schemeClr）と、明るさなどの調整（lumMod・lumOff・tint・shade・alpha など）に対応する
 */
export function colorOf(holder: Element | undefined, theme: Theme): string | null {
  const c = holder && Array.from(holder.children).find((x) => COLOR_TAGS.includes(x.localName));
  if (!c) return null;
  const val = c.getAttribute("val") ?? "";
  let rgb: [number, number, number] | null = null;
  const hex = (h: string | null | undefined) =>
    h && /^[0-9a-f]{6}$/i.test(h) ? ([0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number]) : null;
  switch (c.localName) {
    case "srgbClr":
      rgb = hex(val);
      break;
    case "sysClr":
      rgb = hex(c.getAttribute("lastClr")) ?? hex(val === "window" ? "FFFFFF" : "000000");
      break;
    case "prstClr":
      rgb = hex(PRESET[val]);
      break;
    case "schemeClr":
      rgb = hex(theme.colors[theme.map[val] ?? val]);
      break;
    case "scrgbClr":
      rgb = (["r", "g", "b"] as const).map((k) => clamp01((num(c, k) ?? 0) / 100000)) as [number, number, number];
      break;
    case "hslClr":
      rgb = hslToRgb(((num(c, "hue") ?? 0) / 60000 / 360) % 1, clamp01((num(c, "sat") ?? 0) / 100000), clamp01((num(c, "lum") ?? 0) / 100000));
      break;
  }
  if (!rgb) return null;
  let alpha = 1;
  for (const m of Array.from(c.children)) {
    const v = (num(m, "val") ?? 0) / 100000;
    switch (m.localName) {
      case "lumMod":
      case "lumOff":
      case "satMod": {
        const [h, s, l] = rgbToHsl(...rgb);
        rgb =
          m.localName === "lumMod"
            ? hslToRgb(h, s, clamp01(l * v))
            : m.localName === "lumOff"
              ? hslToRgb(h, s, clamp01(l + v))
              : hslToRgb(h, clamp01(s * v), l);
        break;
      }
      case "tint":
        rgb = rgb.map((x) => x * v + (1 - v)) as [number, number, number];
        break;
      case "shade":
        rgb = rgb.map((x) => x * v) as [number, number, number];
        break;
      case "alpha":
        alpha = clamp01(v);
        break;
    }
  }
  const [r, g, b] = rgb.map((x) => Math.round(clamp01(x) * 255));
  if (alpha < 1) return `rgba(${r},${g},${b},${n3(alpha)})`;
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

// ---------- 塗り・線 ----------

export interface Fill {
  /** CSS の background の値（色・グラデーション）。塗りなしは "none" */
  css: string;
  /** SVG の図形に使う単色（グラデーションは最初の色） */
  solid: string;
  /** 画像の塗り（a:blipFill）の r:embed */
  imageRid?: string;
}

const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export function rid(el: Element | undefined, local: string): string | null {
  if (!el) return null;
  return el.getAttributeNS(R_NS, local) || el.getAttribute(`r:${local}`);
}

/** 塗りの要素（spPr・bgPr など、solidFill などを子に持つもの）から塗りを求める。塗りの指定が無ければ null */
export function fillOf(holder: Element | undefined, theme: Theme): Fill | null {
  if (!holder) return null;
  if (kid(holder, "noFill")) return { css: "none", solid: "none" };
  const solid = kid(holder, "solidFill");
  if (solid) {
    const c = colorOf(solid, theme);
    return c ? { css: c, solid: c } : null;
  }
  const grad = kid(holder, "gradFill");
  if (grad) {
    const stops = kids(kid(grad, "gsLst"), "gs")
      .map((gs) => ({ pos: (num(gs, "pos") ?? 0) / 1000, color: colorOf(gs, theme) }))
      .filter((s): s is { pos: number; color: string } => !!s.color)
      .sort((a, b) => a.pos - b.pos);
    if (stops.length === 0) return null;
    // PowerPoint の角度は右向きが 0 度で時計回り。CSS は上向きが 0 度
    const ang = ((num(kid(grad, "lin"), "ang") ?? 0) / 60000 + 90) % 360;
    const css =
      stops.length === 1 ? stops[0].color : `linear-gradient(${n3(ang)}deg, ${stops.map((s) => `${s.color} ${n3(s.pos)}%`).join(", ")})`;
    return { css, solid: stops[0].color };
  }
  const patt = kid(holder, "pattFill");
  if (patt) {
    const c = colorOf(kid(patt, "fgClr"), theme);
    return c ? { css: c, solid: c } : null;
  }
  const blip = kid(holder, "blipFill");
  if (blip) {
    const r = rid(kid(blip, "blip"), "embed");
    return r ? { css: "none", solid: "none", imageRid: r } : null;
  }
  return null;
}

/** p:style の参照（fillRef・lnRef・fontRef）の色。idx が 0 は「なし」 */
export function styleRefColor(style: Element | undefined, ref: "fillRef" | "lnRef" | "fontRef", theme: Theme): string | null {
  const el = kid(style, ref);
  if (!el) return null;
  if (ref !== "fontRef" && (num(el, "idx") ?? 0) === 0) return null;
  return colorOf(el, theme);
}

export type LineEnd = "tri" | "oval" | null;

export interface Line {
  color: string;
  /** 線の太さ（pt） */
  width: number;
  dash: boolean;
  head: LineEnd;
  tail: LineEnd;
}

function lineEnd(el: Element | undefined): LineEnd {
  const t = el?.getAttribute("type");
  if (!t || t === "none") return null;
  return t === "oval" || t === "diamond" ? "oval" : "tri";
}

/** 枠線（spPr の a:ln。無ければ p:style の lnRef）。線なしは null */
export function lineOf(spPr: Element | undefined, style: Element | undefined, theme: Theme): Line | null {
  const ln = kid(spPr, "ln");
  if (kid(ln, "noFill")) return null;
  const refIdx = num(kid(style, "lnRef"), "idx") ?? 0;
  const color = colorOf(kid(ln, "solidFill"), theme) ?? fillOf(ln, theme)?.solid ?? styleRefColor(style, "lnRef", theme);
  if (!color || color === "none") return null;
  // 太さの指定が無ければテーマの線のスタイル（Office 2013 以降の既定は 0.5pt・1pt・1.5pt）
  const width = (num(ln, "w") ?? 0) / EMU_PER_PT || theme.lineWidths[refIdx - 1] || 0.75;
  const dash = kid(ln, "prstDash")?.getAttribute("val");
  return { color, width, dash: !!dash && dash !== "solid", head: lineEnd(kid(ln, "headEnd")), tail: lineEnd(kid(ln, "tailEnd")) };
}

// ---------- 図形の形 ----------

/** CSS で描く形（四角・角丸・楕円）か、SVG のパス（0〜1 の正方形の中の座標） */
export type Geom = { kind: "rect" } | { kind: "roundRect"; radius: number } | { kind: "ellipse" } | { kind: "path"; d: string };

const poly = (...pts: [number, number][]) => ({ kind: "path" as const, d: `M${pts.map(([x, y]) => `${n3(x)} ${n3(y)}`).join(" L")} Z` });

function regular(n: number, rot = -Math.PI / 2): Geom {
  return poly(...Array.from({ length: n }, (_, i) => [0.5 + 0.5 * Math.cos(rot + (2 * Math.PI * i) / n), 0.5 + 0.5 * Math.sin(rot + (2 * Math.PI * i) / n)] as [number, number]));
}

function star(n: number, inner: number): Geom {
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? 0.5 : 0.5 * inner;
    const a = -Math.PI / 2 + (Math.PI * i) / n;
    pts.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]);
  }
  return poly(...pts);
}

/**
 * 既定の形（a:prstGeom の prst）。よく使うものだけ形を作り、ほかは四角にする。
 * w・h は図形の大きさ（角丸の半径を、短い辺に対する割合で求めるのに使う）
 */
export function presetGeom(prst: string | null | undefined, adj: number | null, w: number, h: number): Geom {
  const a = (def: number) => (adj ?? def) / 100000;
  switch (prst ?? "rect") {
    case "roundRect":
    case "flowChartAlternateProcess":
      return { kind: "roundRect", radius: a(16667) * Math.min(w, h) };
    case "flowChartTerminator":
      return { kind: "roundRect", radius: Math.min(w, h) / 2 };
    case "ellipse":
    case "flowChartConnector":
    case "cloud":
    case "flowChartOnlineStorage":
      return { kind: "ellipse" };
    case "triangle":
    case "flowChartExtract":
      return poly([a(50000), 0], [1, 1], [0, 1]);
    case "rtTriangle":
      return poly([0, 0], [1, 1], [0, 1]);
    case "diamond":
    case "flowChartDecision":
      return poly([0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]);
    case "parallelogram":
    case "flowChartInputOutput": {
      const k = Math.min(a(25000) * (h / Math.max(w, 1)), 0.9);
      return poly([k, 0], [1, 0], [1 - k, 1], [0, 1]);
    }
    case "trapezoid": {
      const k = Math.min(a(25000) * (h / Math.max(w, 1)), 0.5);
      return poly([k, 0], [1 - k, 0], [1, 1], [0, 1]);
    }
    case "pentagon":
      return regular(5);
    case "hexagon":
      return poly([0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]);
    case "octagon":
      return poly([0.3, 0], [0.7, 0], [1, 0.3], [1, 0.7], [0.7, 1], [0.3, 1], [0, 0.7], [0, 0.3]);
    case "star5":
      return star(5, 0.4);
    case "homePlate": {
      const k = 1 - Math.min(a(50000) * (h / Math.max(w, 1)), 1);
      return poly([0, 0], [k, 0], [1, 0.5], [k, 1], [0, 1]);
    }
    case "chevron": {
      const k = Math.min(a(50000) * (h / Math.max(w, 1)), 1);
      return poly([0, 0], [1 - k, 0], [1, 0.5], [1 - k, 1], [0, 1], [k, 0.5]);
    }
    case "rightArrow":
      return poly([0, 0.25], [0.65, 0.25], [0.65, 0], [1, 0.5], [0.65, 1], [0.65, 0.75], [0, 0.75]);
    case "leftArrow":
      return poly([1, 0.25], [0.35, 0.25], [0.35, 0], [0, 0.5], [0.35, 1], [0.35, 0.75], [1, 0.75]);
    case "upArrow":
      return poly([0.25, 1], [0.25, 0.35], [0, 0.35], [0.5, 0], [1, 0.35], [0.75, 0.35], [0.75, 1]);
    case "downArrow":
      return poly([0.25, 0], [0.25, 0.65], [0, 0.65], [0.5, 1], [1, 0.65], [0.75, 0.65], [0.75, 0]);
    case "leftRightArrow":
      return poly([0, 0.5], [0.2, 0], [0.2, 0.25], [0.8, 0.25], [0.8, 0], [1, 0.5], [0.8, 1], [0.8, 0.75], [0.2, 0.75], [0.2, 1]);
    case "plus":
    case "mathPlus":
      return poly([0.35, 0], [0.65, 0], [0.65, 0.35], [1, 0.35], [1, 0.65], [0.65, 0.65], [0.65, 1], [0.35, 1], [0.35, 0.65], [0, 0.65], [0, 0.35], [0.35, 0.35]);
    case "flowChartDocument":
      return { kind: "path", d: "M0 0 L1 0 L1 0.83 C0.75 0.7 0.5 1.05 0 0.92 Z" };
    case "can":
    case "flowChartMagneticDisk":
      return { kind: "path", d: "M0 0.12 C0 -0.04 1 -0.04 1 0.12 L1 0.88 C1 1.04 0 1.04 0 0.88 Z M0 0.12 C0 0.28 1 0.28 1 0.12" };
    default:
      return { kind: "rect" };
  }
}

/** 自由図形（a:custGeom）を SVG のパスにする（各パスの w・h で 0〜1 に正規化する）。描けなければ null */
/** 自由図形。パスに大きさ（w・h）が無ければ、座標は図形の大きさ（EMU。extW・extH）に対するもの */
export function customGeom(custGeom: Element | undefined, extW?: number, extH?: number): Geom | null {
  const paths = kids(kid(custGeom, "pathLst"), "path");
  let d = "";
  for (const p of paths) {
    const w = num(p, "w") || extW || 1;
    const h = num(p, "h") || extH || 1;
    const pt = (el: Element) => `${n3((num(el, "x") ?? 0) / w)} ${n3((num(el, "y") ?? 0) / h)}`;
    for (const c of Array.from(p.children)) {
      const pts = kids(c, "pt");
      switch (c.localName) {
        case "moveTo":
          if (pts[0]) d += `M${pt(pts[0])} `;
          break;
        case "lnTo":
          if (pts[0]) d += `L${pt(pts[0])} `;
          break;
        case "cubicBezTo":
          if (pts.length === 3) d += `C${pts.map(pt).join(" ")} `;
          break;
        case "quadBezTo":
          if (pts.length === 2) d += `Q${pts.map(pt).join(" ")} `;
          break;
        case "close":
          d += "Z ";
          break;
      }
    }
  }
  return d ? { kind: "path", d: d.trim() } : null;
}

// ---------- 線（コネクタ） ----------

export interface Box {
  /** スライド上の位置と大きさ（pt） */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 回転（度、時計回り） */
  rot: number;
  flipH: boolean;
  flipV: boolean;
}

/**
 * 線・コネクタの折れ点（スライド上の pt）。直線は始点と終点、カギ線（bentConnector）は角を通る。
 * 反転（flipH・flipV）で始点と終点が入れ替わり、回転は図形の中心を軸に回す
 */
export function connectorPoints(prst: string | null | undefined, box: Box, adj: number | null): [number, number][] {
  const k = (adj ?? 50000) / 100000;
  let local: [number, number][];
  if (prst === "bentConnector2") local = [[0, 0], [1, 0], [1, 1]];
  else if (prst === "bentConnector3") local = [[0, 0], [k, 0], [k, 1], [1, 1]];
  else local = [[0, 0], [1, 1]];
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rad = (box.rot * Math.PI) / 180;
  return local.map(([u, v]) => {
    const x = box.x + (box.flipH ? 1 - u : u) * box.w;
    const y = box.y + (box.flipV ? 1 - v : v) * box.h;
    if (!rad) return [x, y];
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * Math.cos(rad) - dy * Math.sin(rad), cy + dx * Math.sin(rad) + dy * Math.cos(rad)];
  });
}

// ---------- 文字の書式 ----------

export interface TextStyle {
  /** 文字の大きさ（pt） */
  sz?: number;
  color?: string;
  b?: boolean;
  i?: boolean;
  /** 段落の揃え（l・ctr・r・just） */
  algn?: string;
}

/** 文字の書式（a:rPr・a:defRPr）に書いてあるものだけを取り出す */
export function runStyleOf(rPr: Element | undefined, theme: Theme): TextStyle {
  const out: TextStyle = {};
  if (!rPr) return out;
  const sz = num(rPr, "sz");
  if (sz) out.sz = sz / 100;
  const b = rPr.getAttribute("b");
  if (b !== null) out.b = b === "1" || b === "true";
  const i = rPr.getAttribute("i");
  if (i !== null) out.i = i === "1" || i === "true";
  const c = colorOf(kid(rPr, "solidFill"), theme);
  if (c) out.color = c;
  return out;
}

/**
 * 段落のレベルごとの書式を、優先順に並べたリスト（図形の lstStyle → レイアウト・マスターの同じプレースホルダー →
 * マスターの txStyles → presentation.xml の defaultTextStyle）から求める。
 * リストの要素は、a:lvl1pPr〜a:lvl9pPr を子に持つ要素か、決まった書式
 */
export type StyleSource = Element | TextStyle | undefined;

export function levelStyle(sources: StyleSource[], lvl: number, theme: Theme): TextStyle {
  const out: TextStyle = {};
  const fill = (s: TextStyle) => {
    for (const k of ["sz", "color", "b", "i", "algn"] as const) if (out[k] === undefined && s[k] !== undefined) (out as Record<string, unknown>)[k] = s[k];
  };
  for (const src of sources) {
    if (!src) continue;
    if (!(src instanceof Element)) {
      fill(src);
      continue;
    }
    const p = kid(src, `lvl${lvl + 1}pPr`);
    if (!p) continue;
    fill(runStyleOf(kid(p, "defRPr"), theme));
    const algn = p.getAttribute("algn");
    if (algn && out.algn === undefined) out.algn = algn;
  }
  return out;
}

/** 書式を CSS 変数にする（表示側の .pptx-layout で使う） */
export function styleVars(s: TextStyle, scale = 1): string {
  let v = "";
  if (s.sz !== undefined) v += `--fs:${n3(s.sz * scale)};`;
  if (s.color) v += `--c:${s.color};`;
  if (s.b !== undefined) v += `--fw:${s.b ? 700 : 400};`;
  if (s.i !== undefined) v += `--fst:${s.i ? "italic" : "normal"};`;
  return v;
}
