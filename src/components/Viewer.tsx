import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { memo, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { trimRange, type AnchorLocation } from "../lib/anchor";
import type { TextDoc } from "../lib/document";
import { headingElements, headingSpans, linesOfRange, locateInHtml, pageSpans, slideSpans, TextIndex, type PageSpan, type SlideSpan } from "../lib/dom";
import { NOTE_KINDS, type NoteKind } from "../lib/noteMeta";
import type { HeadingSpan, PlaceOption } from "../lib/place";
import { LS_KEYS, lsGet, lsSet } from "../lib/storage";
import { lastAtOrAbove, notesPerEntry, tocEntries, type TocEntry } from "../lib/toc";

export interface HighlightSpec {
  id: string;
  start: number;
  end: number;
  stale: boolean;
  /** 種類ごとにマーカーの色を変える */
  kind: NoteKind;
}

/** ハイライトの名前（CSS の ::highlight(...)）。種類ごとの色の上に、古い印（波線）・選択中・書きかけを重ねる */
const KIND_HIGHLIGHTS = NOTE_KINDS.map((k) => `note-${k}`);
const HIGHLIGHT_NAMES = [...KIND_HIGHLIGHTS, "note-stale", "note-active", "note-pending"];

export interface TextSelection {
  start: number;
  end: number;
  quote: string;
}

export interface ViewerHandle {
  /** 範囲の位置情報（Markdown: 行 / Word: 段落・見出し） */
  locate(start: number, end: number): AnchorLocation;
  scrollToRange(start: number, end: number): void;
  /** いま見ている場所（PowerPoint: 表示中のスライド / PDF: 表示中のページ / Word・Markdown: 画面上部にかかる見出しの節）。全体メモの付け先に使う */
  currentPlace(): PlaceOption | null;
}

interface Props {
  ref: Ref<ViewerHandle>;
  doc: TextDoc;
  /** 資料の絶対パス（相対画像の解決に使う） */
  docAbsPath: string;
  highlights: HighlightSpec[];
  activeId: string | null;
  pending: { start: number; end: number } | null;
  /** slides は PowerPoint、pages は PDF のときだけ中身がある */
  onTextReady(text: string, slides: SlideSpan[], pages: PageSpan[], headings: HeadingSpan[]): void;
  onSelectionChange(sel: TextSelection | null): void;
  onAddNote(): void;
  onClickOffset(offset: number): void;
}

/** hast の要素に元 Markdown の行番号を data-sl / data-el として付与する */
function rehypeSourceLines() {
  type HNode = {
    type: string;
    properties?: Record<string, unknown>;
    position?: { start: { line: number }; end: { line: number } };
    children?: HNode[];
  };
  const walk = (n: HNode) => {
    if (n.type === "element" && n.position) {
      n.properties = { ...n.properties, dataSl: n.position.start.line, dataEl: n.position.end.line };
    }
    n.children?.forEach(walk);
  };
  return (tree: HNode) => walk(tree);
}

function resolveRelative(baseFile: string, src: string): string {
  const parts = baseFile.replace(/\\/g, "/").split("/");
  parts.pop();
  for (const seg of src.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(decodeURIComponent(seg));
  }
  return parts.join("/");
}

const Markdown = memo(function Markdown({ content, docAbsPath }: { content: string; docAbsPath: string }) {
  const components: Components = {
    // クリック処理は本文コンテナでまとめて行う
    a: ({ href, children, node: _node, ...rest }) => (
      <a {...rest} href={href} title={href}>
        {children}
      </a>
    ),
    img: ({ src, alt, node: _node, ...rest }) => {
      const s = typeof src === "string" ? src : "";
      // 外部の画像は読み込まない（資料を開いたことが外部に伝わるのを防ぐ）。クリックでブラウザで開く。
      // 目印の文字は CSS で表示し、アンカーの基準テキストには含めない
      if (/^https?:/i.test(s)) {
        return <a href={s} title={s} className="remote-img" data-label={`外部画像: ${alt || s}`} />;
      }
      const url = !s || /^data:/i.test(s) ? s : convertFileSrc(resolveRelative(docAbsPath, s));
      return <img {...rest} src={url} alt={alt} />;
    },
  };
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSourceLines]} components={components}>
      {content}
    </ReactMarkdown>
  );
});

function setHighlight(name: string, ranges: Range[], priority: number) {
  if (!("highlights" in CSS)) return;
  if (ranges.length === 0) {
    CSS.highlights.delete(name);
    return;
  }
  const h = new Highlight(...ranges);
  h.priority = priority;
  CSS.highlights.set(name, h);
}

export function Viewer(props: Props) {
  const { ref, doc, docAbsPath, highlights, activeId, pending } = props;
  const docKey = doc.kind === "markdown" ? doc.content : doc.html;
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [floatPos, setFloatPos] = useState<{ top: number; left: number } | null>(null);
  const [textVersion, setTextVersion] = useState(0);
  const [slides, setSlides] = useState<SlideSpan[]>([]);
  const [pages, setPages] = useState<PageSpan[]>([]);
  /** 一覧で示す「いまのスライド／ページ」の番号 */
  const [currentSlide, setCurrentSlide] = useState(1);
  /** Word・Markdown の見出しの目次と、いま読んでいる節（目次の項目番号） */
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [currentHeading, setCurrentHeading] = useState(0);
  const [tocOpen, setTocOpen] = useState(() => lsGet(LS_KEYS.tocOpen) !== "0");
  /** PowerPoint の表示: 図（位置・書式どおり）か、文字のカード。同じ HTML を CSS で切り替えるので、アンカーには影響しない */
  const [pptxView, setPptxView] = useState<"layout" | "cards">(() => (lsGet(LS_KEYS.pptxView) === "cards" ? "cards" : "layout"));
  /**
   * 目次から移動した見出し。利用者が自分でスクロールするまでは、これを「いまの節」にする
   * （資料の末尾の短い節は画面の上 1/3 まで来ないため）
   */
  const jumpedRef = useRef<number | null>(null);
  const tocNavRef = useRef<HTMLElement>(null);
  /** 描画した本文のテキスト索引（本文が変わるたびに作り直す） */
  const indexRef = useRef<TextIndex | null>(null);
  const cbRef = useRef(props);
  cbRef.current = props;

  useImperativeHandle(ref, () => ({
    locate(start, end) {
      const body = bodyRef.current;
      const r = indexRef.current?.rangeAt(start, end);
      if (!body || !r) return {};
      // Markdown も議事録で議題ごとにまとめられるよう、直前の見出しを記録する
      return doc.kind === "markdown" ? { ...linesOfRange(r), heading: locateInHtml(body, r).heading } : locateInHtml(body, r);
    },
    currentPlace() {
      if (slides.length > 0) {
        const s = slides.find((x) => x.no === currentSlide);
        return s ? { scope: "slide", slide: s.no, slideId: s.id, heading: s.title || undefined } : null;
      }
      if (pages.length > 0) return { scope: "page", page: currentSlide };
      // 目次で示している節と同じもの（見出しより前を見ているときは資料全体）
      const i = headingAtLine();
      return i >= 0 && toc[i] ? { scope: "heading", heading: toc[i].text } : null;
    },
    scrollToRange(start, end) {
      const sc = scrollRef.current;
      const r = indexRef.current?.rangeAt(start, end);
      if (!r || !sc) return;
      jumpedRef.current = null;
      const rect = r.getBoundingClientRect();
      const scRect = sc.getBoundingClientRect();
      sc.scrollTo({ top: sc.scrollTop + rect.top - scRect.top - sc.clientHeight / 3, behavior: "smooth" });
    },
  }));

  // 描画後のテキストをアンカー基準として親へ渡す
  useLayoutEffect(() => {
    if (!bodyRef.current) return;
    const index = new TextIndex(bodyRef.current);
    indexRef.current = index;
    const spans = slideSpans(bodyRef.current, index);
    const ps = pageSpans(bodyRef.current, index);
    setSlides(spans);
    setPages(ps);
    const hs = spans.length > 0 || ps.length > 0 ? [] : headingSpans(bodyRef.current, index);
    setToc(tocEntries(hs, index.text.length));
    setCurrentHeading(0);
    cbRef.current.onTextReady(index.text, spans, ps, hs);
    setTextVersion((v) => v + 1);
    setFloatPos(null);
  }, [docKey]);

  // PDF: ページの幅を表示欄の幅に合わせる（文字の層も CSS の --total-scale-factor で一緒に伸び縮みする）
  useEffect(() => {
    const sc = scrollRef.current;
    const body = bodyRef.current;
    if (doc.kind !== "pdf" || !sc || !body) return;
    const pageW = Math.max(
      0,
      ...Array.from(body.querySelectorAll<HTMLElement>("section[data-page]"), (s) => Number(s.style.getPropertyValue("--page-w")) || 0),
    );
    if (!pageW) return;
    const fit = () => {
      const pad = parseFloat(getComputedStyle(body).paddingLeft) + parseFloat(getComputedStyle(body).paddingRight);
      const scale = Math.min(2, Math.max(0.4, (sc.clientWidth - pad) / pageW));
      body.style.setProperty("--total-scale-factor", scale.toFixed(3));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(sc);
    return () => ro.disconnect();
  }, [doc.kind, docKey]);

  // PDF: ページ画像は、表示欄とその上下 1 画面分にあるページだけ描く（全ページ描くと大きい PDF で十数秒かかる）。
  // 一度に 1 ページずつ、表示欄の中心に近いページから描く。描く前のページは白い枠だけ（大きさは CSS で決まる）
  useEffect(() => {
    const sc = scrollRef.current;
    const body = bodyRef.current;
    if (doc.kind !== "pdf" || !sc || !body) return;
    const images = doc.images;
    const wanted = new Map<number, HTMLElement>();
    /** 描けなかった回数。表示欄の近くにあるうちは、少し待って 3 回までやり直す */
    const failures = new Map<number, number>();
    const near = new Set<number>();
    let busy = false;
    let stopped = false;
    const nearest = () => {
      const mid = sc.getBoundingClientRect().top + sc.clientHeight / 2;
      let best: [number, HTMLElement] | null = null;
      let bestD = Infinity;
      for (const [no, s] of wanted) {
        const r = s.getBoundingClientRect();
        const d = Math.abs((r.top + r.bottom) / 2 - mid);
        if (d < bestD) [best, bestD] = [[no, s], d];
      }
      return best;
    };
    const pump = async () => {
      if (busy) return;
      busy = true;
      try {
        for (let next = nearest(); next && !stopped; next = nearest()) {
          const [no, section] = next;
          wanted.delete(no);
          const img = section.querySelector<HTMLImageElement>("img.pdf-img");
          if (!img || img.getAttribute("src")) continue;
          try {
            const url = await images.url(no);
            if (!stopped) img.src = url;
          } catch (e) {
            if (stopped) break;
            console.warn(`p.${no} を描けません`, e);
            const n = (failures.get(no) ?? 0) + 1;
            failures.set(no, n);
            if (n < 3) {
              setTimeout(() => {
                if (stopped || !near.has(no)) return;
                wanted.set(no, section);
                void pump();
              }, 1000 * n);
            }
          }
        }
      } finally {
        busy = false;
      }
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const s = e.target as HTMLElement;
          const no = Number(s.dataset.page);
          if (e.isIntersecting) {
            near.add(no);
            wanted.set(no, s);
          } else {
            near.delete(no);
            wanted.delete(no);
          }
        }
        void pump();
      },
      { root: sc, rootMargin: "100% 0px" },
    );
    body.querySelectorAll<HTMLElement>("section[data-page]").forEach((s) => io.observe(s));
    return () => {
      stopped = true;
      io.disconnect();
    };
  }, [doc, docKey]);

  // ハイライト描画
  useEffect(() => {
    const index = indexRef.current;
    if (!index) return;
    const byKind = new Map<NoteKind, Range[]>(NOTE_KINDS.map((k) => [k, []]));
    const stale: Range[] = [];
    const active: Range[] = [];
    for (const h of highlights) {
      const r = index.rangeAt(h.start, h.end);
      if (!r) continue;
      if (h.id === activeId) {
        active.push(r);
        continue;
      }
      byKind.get(h.kind)?.push(r);
      if (h.stale) stale.push(r);
    }
    const pend = pending ? index.rangeAt(pending.start, pending.end) : null;
    for (const k of NOTE_KINDS) setHighlight(`note-${k}`, byKind.get(k)!, 1);
    setHighlight("note-stale", stale, 2);
    setHighlight("note-active", active, 3);
    setHighlight("note-pending", pend ? [pend] : [], 4);
  }, [highlights, activeId, pending, textVersion]);

  useEffect(
    () => () => {
      if ("highlights" in CSS) HIGHLIGHT_NAMES.forEach((n) => CSS.highlights.delete(n));
    },
    [],
  );

  // 選択範囲の監視
  useEffect(() => {
    const onChange = () => {
      const body = bodyRef.current;
      const index = indexRef.current;
      const sc = scrollRef.current;
      const sel = window.getSelection();
      if (!body || !index || !sc || !sel || sel.isCollapsed || sel.rangeCount === 0) {
        setFloatPos(null);
        cbRef.current.onSelectionChange(null);
        return;
      }
      const range = sel.getRangeAt(0);
      if (!body.contains(range.startContainer) || !body.contains(range.endContainer)) {
        setFloatPos(null);
        cbRef.current.onSelectionChange(null);
        return;
      }
      // 全文は描画時に作った索引のものを使う（選択が変わるたびに全文を作り直さない）
      const text = index.text;
      const [start, end] = trimRange(
        text,
        index.offsetOf(range.startContainer, range.startOffset),
        index.offsetOf(range.endContainer, range.endOffset),
      );
      if (start >= end) {
        setFloatPos(null);
        cbRef.current.onSelectionChange(null);
        return;
      }
      const rects = range.getClientRects();
      const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
      const scRect = sc.getBoundingClientRect();
      setFloatPos({
        top: last.bottom - scRect.top + sc.scrollTop + 6,
        left: Math.min(last.right - scRect.left + sc.scrollLeft, sc.clientWidth - 160),
      });
      cbRef.current.onSelectionChange({ start, end, quote: text.slice(start, end) });
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);

  // PowerPoint・PDF: スライド／ページの区切り（data-slide / data-page）
  const unitAttr = doc.kind === "pdf" ? "page" : "slide";

  // PowerPoint・PDF: 画面の上 1/3 にあるスライド／ページを「いまのスライド／ページ」として一覧で示す
  const onScroll = () => {
    const sc = scrollRef.current;
    const body = bodyRef.current;
    if (!sc || !body) return;
    const line = sc.getBoundingClientRect().top + sc.clientHeight / 3;
    if (toc.length > 0) {
      setCurrentHeading(Math.max(0, headingAtLine()));
      return;
    }
    if (slides.length === 0 && pages.length === 0) return;
    let cur = 1;
    for (const s of body.querySelectorAll<HTMLElement>(`section[data-${unitAttr}]`)) {
      if (s.getBoundingClientRect().top > line) break;
      cur = Number(s.dataset[unitAttr]);
    }
    setCurrentSlide(cur);
  };

  const goSlide = (no: number) => {
    const sc = scrollRef.current;
    const s = bodyRef.current?.querySelector(`section[data-${unitAttr}="${no}"]`);
    if (!sc || !s) return;
    sc.scrollTo({ top: sc.scrollTop + s.getBoundingClientRect().top - sc.getBoundingClientRect().top - 12 });
  };

  /** 画面の上 1/3 にかかる最後の見出し（目次の項目番号。目次から移動した直後はその見出し）。見出しより前なら -1 */
  const headingAtLine = (): number => {
    if (jumpedRef.current !== null) return jumpedRef.current;
    const sc = scrollRef.current;
    const body = bodyRef.current;
    if (!sc || !body) return -1;
    const line = sc.getBoundingClientRect().top + sc.clientHeight / 3;
    const hs = headingElements(body);
    return lastAtOrAbove(hs.length, (i) => hs[i].getBoundingClientRect().top, line);
  };

  const goHeading = (i: number) => {
    const sc = scrollRef.current;
    const h = bodyRef.current && headingElements(bodyRef.current)[i];
    if (!sc || !h) return;
    jumpedRef.current = i;
    setCurrentHeading(i);
    sc.scrollTo({ top: sc.scrollTop + h.getBoundingClientRect().top - sc.getBoundingClientRect().top - 12 });
  };
  /** 利用者が自分でスクロールし始めたら、位置から求めるのに戻す */
  const releaseJump = () => {
    jumpedRef.current = null;
  };

  const toggleToc = () => {
    lsSet(LS_KEYS.tocOpen, tocOpen ? "0" : "1");
    setTocOpen(!tocOpen);
  };

  // いまの節が目次の見えないところにあれば、目次をスクロールして見せる
  useEffect(() => {
    // scrollIntoView は外側の要素までスクロールすることがあるので、目次だけを動かす
    const nav = tocNavRef.current;
    const item = nav?.querySelector<HTMLElement>(`[data-toc="${currentHeading}"]`);
    if (!nav || !item) return;
    const n = nav.getBoundingClientRect();
    const r = item.getBoundingClientRect();
    const header = nav.firstElementChild?.getBoundingClientRect().height ?? 0;
    if (r.top < n.top + header) nav.scrollTop -= n.top + header - r.top;
    else if (r.bottom > n.bottom) nav.scrollTop += r.bottom - n.bottom;
  }, [currentHeading, tocOpen]);

  const notesPerHeading = useMemo(
    () => notesPerEntry(toc, highlights.map((h) => h.start)),
    [toc, highlights],
  );

  const notesPerSlide = useMemo(() => {
    const units: { no: number; start: number; end: number }[] = slides.length > 0 ? slides : pages;
    const m = new Map<number, number>();
    for (const h of highlights) {
      const s = units.find((sp) => h.start >= sp.start && h.start < sp.end);
      if (s) m.set(s.no, (m.get(s.no) ?? 0) + 1);
    }
    return m;
  }, [highlights, slides, pages]);

  const view = (
    <div
      ref={scrollRef}
      className="relative h-full min-w-0 flex-1 overflow-auto bg-paper"
      onScroll={onScroll}
      onWheel={releaseJump}
      onPointerDown={releaseJump}
      onKeyDown={releaseJump}
    >
      {doc.kind === "markdown" && doc.encoding !== "UTF-8" && (
        <p className="mx-auto max-w-[820px] px-12 pt-3 text-xs text-ink-dim">文字コード: {doc.encoding} として表示しています</p>
      )}
      {doc.kind === "pdf" && doc.warnings.length > 0 && (
        <ul className="mx-auto max-w-[820px] list-disc px-12 pt-3 pl-17 text-xs text-ink-dim">
          {doc.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {doc.kind === "pptx" && doc.warnings.length > 0 && (
        <details className="mx-auto max-w-[820px] px-12 pt-3 text-xs text-ink-dim">
          <summary className="cursor-pointer">PowerPoint 変換情報 ・ 再現できなかった要素 {doc.warnings.length}件</summary>
          <ul className="mt-1 list-disc pl-5">
            {doc.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      {doc.kind === "docx" && (doc.warnings.length > 0 || Object.keys(doc.headingStyles).length > 0) && (
        <details className="mx-auto max-w-[820px] px-12 pt-3 text-xs text-ink-dim">
          <summary className="cursor-pointer">
            Word 変換情報
            {Object.keys(doc.headingStyles).length > 0 && ` ・ 見出しとして扱った独自スタイル ${Object.keys(doc.headingStyles).length}件`}
            {doc.warnings.length > 0 && ` ・ 再現できなかった要素 ${new Set(doc.warnings).size}件`}
          </summary>
          {Object.keys(doc.headingStyles).length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {Object.entries(doc.headingStyles).map(([name, lvl]) => (
                <li key={name}>
                  「{name}」→ 見出し{lvl}
                </li>
              ))}
            </ul>
          )}
          {doc.warnings.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {[...new Set(doc.warnings)].slice(0, 20).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <p className="mt-1">
            見出しが正しく表示されない場合は、資料フォルダの .document-memo-kakikomi.json に {'{ "docxHeadings": { "スタイル名": 1 } }'} の形で指定できます（0 で見出しにしない）。
          </p>
        </details>
      )}
      <div
        key={doc.kind}
        ref={bodyRef}
        className={`doc doc-${doc.kind}${doc.kind === "pptx" ? ` pptx-${pptxView}` : ""}`}
        {...(doc.kind !== "markdown" ? { dangerouslySetInnerHTML: { __html: doc.html } } : {})}
        onClick={(e) => {
          // リンク: 外部 URL はブラウザで開き、文書内リンク（脚注など）はスクロール
          const a = (e.target as Element).closest("a");
          if (a && bodyRef.current?.contains(a)) {
            e.preventDefault();
            const href = a.getAttribute("href") ?? "";
            if (/^https?:\/\//.test(href)) void openUrl(href);
            else if (href.startsWith("#")) bodyRef.current.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView({ block: "center" });
            return;
          }
          const sel = window.getSelection();
          if (sel && !sel.isCollapsed) return;
          const off = indexRef.current?.offsetFromPoint(e.clientX, e.clientY) ?? null;
          if (off !== null) props.onClickOffset(off);
        }}
      >
        {doc.kind === "markdown" ? <Markdown content={doc.content} docAbsPath={docAbsPath} /> : undefined}
      </div>
      {floatPos && (
        <button
          className="btn absolute z-10 border border-fg bg-bg"
          style={{ top: floatPos.top, left: floatPos.left }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => props.onAddNote()}
        >
          + ノート (Ctrl+M)
        </button>
      )}
    </div>
  );

  if (doc.kind === "pdf") {
    return (
      <div className="flex h-full">
        <nav aria-label="ページ一覧" className="w-20 shrink-0 overflow-auto border-r border-line py-1 text-xs">
          {pages.map((p) => (
            <button
              key={p.no}
              className={`flex w-full gap-1 px-2 py-0.5 text-left hover:bg-line ${p.no === currentSlide ? "text-accent" : ""}`}
              onClick={() => goSlide(p.no)}
            >
              <span>p.{p.no}</span>
              {notesPerSlide.get(p.no) ? <span className="ml-auto shrink-0 text-dim">({notesPerSlide.get(p.no)})</span> : null}
            </button>
          ))}
        </nav>
        {view}
      </div>
    );
  }
  if (doc.kind === "docx" || doc.kind === "markdown") {
    // 目次の有無・開閉で本文（view）の位置が変わると React が本文を作り直し、テキスト索引が古い DOM を指してしまう。
    // 見出しが無くても常に同じ形（目次の欄＋本文）で返す
    const tocPane =
      toc.length === 0 ? null : !tocOpen ? (
        <button
          className="w-6 shrink-0 border-r border-line py-2 text-xs text-dim hover:bg-line hover:text-fg [writing-mode:vertical-rl]"
          title="見出しの目次を開く"
          onClick={toggleToc}
        >
          目次 »
        </button>
      ) : (
        <nav ref={tocNavRef} aria-label="見出しの目次" className="w-52 shrink-0 overflow-auto border-r border-line pb-1 text-xs">
          <div className="sticky top-0 flex items-center bg-bg px-2 py-0.5 text-dim">
            <span>目次</span>
            <button className="ml-auto px-1 hover:text-fg" title="目次を閉じる" aria-label="目次を閉じる" onClick={toggleToc}>
              «
            </button>
          </div>
          {toc.map((e) => (
            <button
              key={e.index}
              data-toc={e.index}
              className={`flex w-full gap-1 py-0.5 pr-2 text-left hover:bg-line ${e.index === currentHeading ? "text-accent" : e.depth === 0 ? "text-bright" : ""}`}
              style={{ paddingLeft: 8 + Math.min(e.depth, 4) * 12 }}
              title={e.text}
              onClick={() => goHeading(e.index)}
            >
              <span className="truncate">{e.text}</span>
              {notesPerHeading.get(e.index) ? <span className="ml-auto shrink-0 text-dim">({notesPerHeading.get(e.index)})</span> : null}
            </button>
          ))}
        </nav>
      );
    return (
      <div className="flex h-full">
        {tocPane}
        {view}
      </div>
    );
  }
  if (doc.kind !== "pptx") return view;
  return (
    <div className="flex h-full">
      <nav aria-label="スライド一覧" className="w-52 shrink-0 overflow-auto border-r border-line pb-1 text-xs">
        <div className="sticky top-0 z-10 flex items-center gap-1 bg-bg px-2 py-0.5 text-dim" role="group" aria-label="スライドの表示">
          <span>表示:</span>
          {(
            [
              ["layout", "図", "スライドの見た目どおりに表示"],
              ["cards", "文字", "スライドの文字だけを上から並べて表示"],
            ] as const
          ).map(([v, label, title]) => (
            <button
              key={v}
              className={`px-1 ${pptxView === v ? "bg-fg text-bg" : "hover:text-fg"}`}
              title={title}
              aria-pressed={pptxView === v}
              onClick={() => {
                lsSet(LS_KEYS.pptxView, v);
                // 表示を変えると文字の位置が変わるので、選択と「ノート追加」ボタンを消す
                window.getSelection()?.removeAllRanges();
                setFloatPos(null);
                setPptxView(v);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {slides.map((s) => (
          <button
            key={s.no}
            className={`flex w-full gap-1 px-2 py-0.5 text-left hover:bg-line ${s.no === currentSlide ? "text-accent" : ""}`}
            title={s.title || undefined}
            onClick={() => goSlide(s.no)}
          >
            <span className="w-6 shrink-0 text-right text-dim">{s.no}</span>
            <span className={`truncate ${s.hidden ? "text-dim" : ""}`}>
              {s.title || "（タイトルなし）"}
              {s.hidden && "（非表示）"}
            </span>
            {notesPerSlide.get(s.no) ? <span className="ml-auto shrink-0 text-dim">({notesPerSlide.get(s.no)})</span> : null}
          </button>
        ))}
      </nav>
      {view}
    </div>
  );
}
