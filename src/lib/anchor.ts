import DiffMatchPatch from "diff-match-patch";

/** 資料上の位置（人間・Git 差分向けの参考情報。再アンカーには使わない） */
export interface AnchorLocation {
  /** Markdown: ソースの行範囲 */
  lineStart?: number;
  lineEnd?: number;
  /** Word: 段落の通し番号と直前の見出し */
  paragraph?: number;
  heading?: string;
  /** PowerPoint: スライド番号（表示用）と スライド ID（並べ替えても変わらない。再アンカーの手がかり） */
  slide?: number;
  slideId?: number;
  /** PDF: ページ番号（1 始まり） */
  page?: number;
}

/**
 * テキスト範囲アンカー。
 * 表示テキスト（レンダリング後のプレーンテキスト）上の位置と、前後の文脈を両方持つ。
 * 資料が変更されても、文脈を手がかりに位置を再特定できる。
 */
export interface TextAnchor extends AnchorLocation {
  type: "text";
  /** 選択されたテキスト */
  quote: string;
  /** 直前の文脈 */
  prefix: string;
  /** 直後の文脈 */
  suffix: string;
  /** 表示テキスト上の文字オフセット [start, end) */
  start: number;
  end: number;
  /** アンカーを確定したときの資料の SHA-256 */
  sourceSha256: string;
}

/**
 * ok: 記録位置にそのまま存在
 * moved: 引用文は同一だが位置がずれていた（自動で再アンカー）
 * fuzzy: 引用文自体が変更されていた（近い箇所を推定）
 * orphaned: 見つからない
 */
export type AnchorStatus = "ok" | "moved" | "fuzzy" | "orphaned";

export interface ResolvedAnchor {
  status: AnchorStatus;
  start: number;
  end: number;
}

export const CONTEXT_LENGTH = 32;

export function createAnchor(
  text: string,
  start: number,
  end: number,
  sourceSha256: string,
  loc?: AnchorLocation,
): TextAnchor {
  return {
    type: "text",
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: text.slice(end, end + CONTEXT_LENGTH),
    start,
    end,
    lineStart: loc?.lineStart,
    lineEnd: loc?.lineEnd,
    paragraph: loc?.paragraph,
    heading: loc?.heading,
    slide: loc?.slide,
    slideId: loc?.slideId,
    page: loc?.page,
    sourceSha256,
  };
}

/** 選択範囲の前後の空白を除いた範囲を返す */
export function trimRange(text: string, start: number, end: number): [number, number] {
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return [start, end];
}

function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

function contextScore(text: string, anchor: TextAnchor, start: number, end: number): number {
  const before = text.slice(Math.max(0, start - anchor.prefix.length), start);
  const after = text.slice(end, end + anchor.suffix.length);
  return commonSuffixLength(before, anchor.prefix) + commonPrefixLength(after, anchor.suffix);
}

function findAll(text: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let i = text.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = text.indexOf(needle, i + 1);
  }
  return out;
}

function fuzzyFind(text: string, pattern: string, loc: number): number {
  const dmp = new DiffMatchPatch();
  dmp.Match_Threshold = 0.35;
  dmp.Match_Distance = 5000;
  const p = pattern.slice(0, dmp.Match_MaxBits);
  return dmp.match_main(text, p, Math.max(0, Math.min(loc, text.length)));
}

/** テキスト上の範囲 [start, end) */
export interface Scope {
  start: number;
  end: number;
}

/**
 * 現在の表示テキスト上でアンカーの位置を特定する。
 * scope を渡すと、その範囲（PowerPoint では同じ ID のスライド）の中の候補を優先する。
 */
export function resolveAnchor(text: string, anchor: TextAnchor, scope?: Scope | null): ResolvedAnchor {
  const inScope = (s: number, e: number) => !!scope && s >= scope.start && e <= scope.end;
  const { quote } = anchor;
  if (!quote) return { status: "orphaned", start: 0, end: 0 };

  // 1. 記録位置にそのまま存在し、文脈も一致する
  if (text.slice(anchor.start, anchor.end) === quote) {
    const max = anchor.prefix.length + anchor.suffix.length;
    if (contextScore(text, anchor, anchor.start, anchor.end) === max) {
      return { status: "ok", start: anchor.start, end: anchor.end };
    }
  }

  // 2. 引用文の出現箇所から、文脈が最も一致し元の位置に近いものを選ぶ
  const hits = findAll(text, quote);
  if (hits.length > 0) {
    let best = hits[0];
    let bestScore = -Infinity;
    for (const h of hits) {
      const score =
        (inScope(h, h + quote.length) ? 1e9 : 0) +
        contextScore(text, anchor, h, h + quote.length) * 1000 -
        Math.abs(h - anchor.start);
      if (score > bestScore) {
        bestScore = score;
        best = h;
      }
    }
    const status = best === anchor.start ? "ok" : "moved";
    return { status, start: best, end: best + quote.length };
  }

  // 3. あいまい検索（引用文そのものが書き換わっている場合）
  //    スライドが移動していたら、移動先のスライドの先頭付近から探す
  const loc = scope && !inScope(anchor.start, anchor.start) ? scope.start : anchor.start;
  const head = fuzzyFind(text, quote, loc);
  if (head !== -1) {
    const tailPattern = quote.slice(-32);
    const tailLoc = head + quote.length - tailPattern.length;
    const tail = quote.length <= 32 ? head : fuzzyFind(text, tailPattern, tailLoc);
    if (tail !== -1 && tail >= head) {
      const end = Math.min(text.length, tail + Math.min(32, quote.length));
      const len = end - head;
      if (len >= quote.length * 0.5 && len <= quote.length * 1.5) {
        return { status: "fuzzy", start: head, end };
      }
    }
  }

  // 4. 引用文が消えていても、前後の文脈が残っていればその間を指す
  if (anchor.prefix.length >= 8 && anchor.suffix.length >= 8) {
    for (const p of findAll(text, anchor.prefix)) {
      const s = p + anchor.prefix.length;
      const e = text.indexOf(anchor.suffix, s);
      if (e > s && e - s <= Math.max(quote.length * 2, 64)) {
        return { status: "fuzzy", start: s, end: e };
      }
    }
  }

  return { status: "orphaned", start: 0, end: 0 };
}
