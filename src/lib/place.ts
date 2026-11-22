/**
 * 「全体メモ」: 資料の文言を選ばずに、資料全体・スライド・シート・見出しの節に付けるノートのアンカー。
 * 会議の脱線や資料にない口頭の補足を、資料のどのあたりの話かだけ残す。
 */

/** doc: 資料全体 / slide: PowerPoint のスライド / sheet: Excel のシート / heading: Word・Markdown の見出しの節 */
export type PlaceScope = "doc" | "slide" | "sheet" | "heading";

export const PLACE_SCOPES: PlaceScope[] = ["doc", "slide", "sheet", "heading"];

export interface PlaceAnchor {
  type: "place";
  scope: PlaceScope;
  /** slide: スライド番号（表示用）と スライド ID（並べ替えても変わらない。位置の特定に使う） */
  slide?: number;
  slideId?: number;
  /** sheet: シート名 */
  sheet?: string;
  /** heading: 見出しの文言（位置の特定に使う）。slide ではスライドのタイトル */
  heading?: string;
  /** 一覧・議事録に出す付け先の名前（資料全体は空） */
  quote: string;
  /** ノートを付けたときの資料の SHA-256（参考情報。全体メモは資料が更新されても位置がずれない） */
  sourceSha256: string;
}

/** 全体メモを付けられる場所（ノート追加時の選択肢） */
export interface PlaceOption {
  scope: PlaceScope;
  slide?: number;
  slideId?: number;
  sheet?: string;
  heading?: string;
}

/** 表示テキスト上の見出しの位置（Word・Markdown） */
export interface HeadingSpan {
  text: string;
  level: number;
  start: number;
}

/** 位置を特定するときの、今の資料の構造 */
export interface PlaceContext {
  slides: { no: number; id: number; title: string; start: number }[];
  headings: HeadingSpan[];
  /** Excel のシート名（並び順） */
  sheets: string[];
}

export function placeLabel(p: PlaceOption): string {
  switch (p.scope) {
    case "doc":
      return "資料全体";
    case "slide":
      return `スライド ${p.slide ?? "?"}${p.heading ? ` ${p.heading}` : ""}`;
    case "sheet":
      return `シート ${p.sheet ?? ""}`;
    case "heading":
      return `§ ${p.heading ?? ""}`;
  }
}

export function createPlaceAnchor(p: PlaceOption, sourceSha256: string): PlaceAnchor {
  const a: PlaceAnchor = { type: "place", scope: p.scope, quote: "", sourceSha256 };
  if (p.scope === "slide") Object.assign(a, { slide: p.slide, slideId: p.slideId, heading: p.heading, quote: p.heading ?? "" });
  if (p.scope === "sheet") Object.assign(a, { sheet: p.sheet, quote: p.sheet ?? "" });
  if (p.scope === "heading") Object.assign(a, { heading: p.heading, quote: p.heading ?? "" });
  return a;
}

export type PlaceTarget = { kind: "point"; start: number } | { kind: "sheet"; sheet: string };

export interface ResolvedPlace {
  found: boolean;
  /** 現在の資料での付け先（スライド番号・タイトルは今の資料のもの） */
  place: PlaceOption;
  /** ジャンプ先（資料全体は無し） */
  target: PlaceTarget | null;
  /** 位置順に並べるときのキー（同じ場所の、文言に付けたノートより前に来るよう少し手前にする） */
  sortKey: number;
}

/** 全体メモの付け先を今の資料で探す */
export function resolvePlace(a: PlaceAnchor, ctx: PlaceContext): ResolvedPlace {
  const lost: ResolvedPlace = { found: false, place: a, target: null, sortKey: Infinity };
  switch (a.scope) {
    case "doc":
      return { found: true, place: a, target: null, sortKey: -1 };
    case "slide": {
      const s = ctx.slides.find((x) => x.id === a.slideId);
      if (!s) return lost;
      return {
        found: true,
        place: { scope: "slide", slide: s.no, slideId: s.id, heading: s.title || undefined },
        target: { kind: "point", start: s.start },
        sortKey: s.start - 0.5,
      };
    }
    case "sheet": {
      const idx = ctx.sheets.indexOf(a.sheet ?? "");
      if (idx < 0) return lost;
      return { found: true, place: a, target: { kind: "sheet", sheet: ctx.sheets[idx] }, sortKey: idx * 1e8 - 0.5 };
    }
    case "heading": {
      const h = ctx.headings.find((x) => x.text === a.heading);
      if (!h) return lost;
      return { found: true, place: a, target: { kind: "point", start: h.start }, sortKey: h.start - 0.5 };
    }
  }
}

/** 全体メモの付け先の選択肢。資料全体と、いま見ている場所（スライド・シート・見出しの節。分からなければ無し） */
export function placeOptions(here: PlaceOption | null): PlaceOption[] {
  return here && here.scope !== "doc" ? [{ scope: "doc" }, here] : [{ scope: "doc" }];
}
