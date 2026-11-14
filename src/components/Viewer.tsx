import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { memo, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { trimRange, type AnchorLocation } from "../lib/anchor";
import type { LoadedDoc } from "../lib/document";
import { containerText, linesOfRange, locateInHtml, offsetFromPoint, offsetOf, rangeFromOffsets } from "../lib/dom";

export interface HighlightSpec {
  id: string;
  start: number;
  end: number;
  stale: boolean;
}

export interface TextSelection {
  start: number;
  end: number;
  quote: string;
}

export interface ViewerHandle {
  /** 範囲の位置情報（Markdown: 行 / Word: 段落・見出し） */
  locate(start: number, end: number): AnchorLocation;
  scrollToRange(start: number, end: number): void;
}

interface Props {
  ref: Ref<ViewerHandle>;
  doc: LoadedDoc;
  /** 資料の絶対パス（相対画像の解決に使う） */
  docAbsPath: string;
  highlights: HighlightSpec[];
  activeId: string | null;
  pending: { start: number; end: number } | null;
  onTextReady(text: string): void;
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
      const url = !s || /^(https?:|data:)/.test(s) ? s : convertFileSrc(resolveRelative(docAbsPath, s));
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
  const cbRef = useRef(props);
  cbRef.current = props;

  useImperativeHandle(ref, () => ({
    locate(start, end) {
      const body = bodyRef.current;
      const r = body && rangeFromOffsets(body, start, end);
      if (!body || !r) return {};
      return doc.kind === "markdown" ? linesOfRange(r) : locateInHtml(body, r);
    },
    scrollToRange(start, end) {
      const body = bodyRef.current;
      const sc = scrollRef.current;
      const r = body && rangeFromOffsets(body, start, end);
      if (!r || !sc) return;
      const rect = r.getBoundingClientRect();
      const scRect = sc.getBoundingClientRect();
      sc.scrollTo({ top: sc.scrollTop + rect.top - scRect.top - sc.clientHeight / 3, behavior: "smooth" });
    },
  }));

  // 描画後のテキストをアンカー基準として親へ渡す
  useLayoutEffect(() => {
    if (!bodyRef.current) return;
    cbRef.current.onTextReady(containerText(bodyRef.current));
    setTextVersion((v) => v + 1);
    setFloatPos(null);
  }, [docKey]);

  // ハイライト描画
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const normal: Range[] = [];
    const stale: Range[] = [];
    const active: Range[] = [];
    for (const h of highlights) {
      const r = rangeFromOffsets(body, h.start, h.end);
      if (!r) continue;
      if (h.id === activeId) active.push(r);
      else (h.stale ? stale : normal).push(r);
    }
    const pend = pending ? rangeFromOffsets(body, pending.start, pending.end) : null;
    setHighlight("note", normal, 1);
    setHighlight("note-stale", stale, 2);
    setHighlight("note-active", active, 3);
    setHighlight("note-pending", pend ? [pend] : [], 4);
  }, [highlights, activeId, pending, textVersion]);

  useEffect(
    () => () => {
      if ("highlights" in CSS) ["note", "note-stale", "note-active", "note-pending"].forEach((n) => CSS.highlights.delete(n));
    },
    [],
  );

  // 選択範囲の監視
  useEffect(() => {
    const onChange = () => {
      const body = bodyRef.current;
      const sc = scrollRef.current;
      const sel = window.getSelection();
      if (!body || !sc || !sel || sel.isCollapsed || sel.rangeCount === 0) {
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
      const text = containerText(body);
      const [start, end] = trimRange(
        text,
        offsetOf(body, range.startContainer, range.startOffset),
        offsetOf(body, range.endContainer, range.endOffset),
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

  return (
    <div ref={scrollRef} className="relative h-full overflow-auto bg-paper">
      {doc.kind === "docx" && doc.warnings.length > 0 && (
        <details className="mx-auto max-w-[820px] px-12 pt-3 text-xs text-ink-dim">
          <summary className="cursor-pointer">Word からの変換で再現できなかった要素があります（{doc.warnings.length}件）</summary>
          <ul className="mt-1 list-disc pl-5">
            {[...new Set(doc.warnings)].slice(0, 20).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      <div
        key={doc.kind}
        ref={bodyRef}
        className={`doc doc-${doc.kind}`}
        {...(doc.kind === "docx" ? { dangerouslySetInnerHTML: { __html: doc.html } } : {})}
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
          if (!bodyRef.current) return;
          const off = offsetFromPoint(bodyRef.current, e.clientX, e.clientY);
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
}
