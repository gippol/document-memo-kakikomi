import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { colName, contains, expandMerges, formatRef, rangeQuote, rangeText, type CellRange, type Sheet, type SheetBook } from "../lib/sheet";

export interface CellHighlight {
  id: string;
  sheet: string;
  range: CellRange;
  stale: boolean;
}

export interface CellSelection {
  sheet: string;
  range: CellRange;
  quote: string;
}

export interface SheetViewerHandle {
  scrollToRange(sheet: string, range: CellRange): void;
  clearSelection(): void;
}

interface Props {
  ref: Ref<SheetViewerHandle>;
  book: SheetBook;
  warnings: string[];
  highlights: CellHighlight[];
  activeId: string | null;
  pending: { sheet: string; range: CellRange } | null;
  onSelectionChange(sel: CellSelection | null): void;
  onAddNote(): void;
  onClickCell(sheet: string, r: number, c: number): void;
}

const DEFAULT_COL_CH = 9;
const ROW_HEAD_CH = 5;

function colWidthCh(w: number | undefined): number {
  if (w === undefined || !isFinite(w)) return DEFAULT_COL_CH;
  return Math.min(60, Math.max(2, Math.round(w * 1.1)));
}

/** 表本体。値が変わらない限り再描画しない（選択・ハイライトは上に重ねて描く） */
const Grid = memo(function Grid({ sheet }: { sheet: Sheet }) {
  const nCols = sheet.rows[0]?.length ?? 0;
  const spans = new Map<string, CellRange>();
  const covered = new Set<string>();
  for (const m of sheet.merges) {
    spans.set(`${m.r1},${m.c1}`, m);
    for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) covered.add(`${r},${c}`);
  }
  return (
    <table className="sheet-grid" style={{ width: `${ROW_HEAD_CH + sheet.colWidths.reduce<number>((s, w) => s + colWidthCh(w), 0)}ch` }}>
      <colgroup>
        <col style={{ width: `${ROW_HEAD_CH}ch` }} />
        {Array.from({ length: nCols }, (_, c) => (
          <col key={c} style={{ width: `${colWidthCh(sheet.colWidths[c])}ch` }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th className="corner" />
          {Array.from({ length: nCols }, (_, c) => (
            <th key={c} data-col={c}>
              {colName(c)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sheet.rows.map((row, r) => (
          <tr key={r}>
            <th data-row={r}>{r + 1}</th>
            {row.map((v, c) => {
              const key = `${r},${c}`;
              if (covered.has(key)) return null;
              const span = spans.get(key);
              const end = span ? span.c2 : c;
              // Excel と同じく、右隣が空なら文字列ははみ出して表示する
              const clip = v !== "" && end + 1 < nCols && (row[end + 1] !== "" || covered.has(`${r},${end + 1}`));
              const t = sheet.types[r]?.[c] ?? " ";
              return (
                <td
                  key={c}
                  data-r={r}
                  data-c={c}
                  rowSpan={span ? span.r2 - span.r1 + 1 : undefined}
                  colSpan={span ? span.c2 - span.c1 + 1 : undefined}
                  className={`${clip || span ? "clip" : ""} ${t === "n" ? "num" : t === "b" || t === "e" ? "mid" : ""}`}
                  title={v.length > 12 || v.includes("\n") ? v : undefined}
                >
                  {v}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
});

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function SheetViewer(props: Props) {
  const { ref, book, warnings, highlights, activeId, pending } = props;
  const [sheetName, setSheetName] = useState(book.sheets[0]?.name ?? "");
  const sheet = book.sheets.find((s) => s.name === sheetName) ?? book.sheets[0];
  const [sel, setSel] = useState<{ sheet: string; anchor: { r: number; c: number }; range: CellRange } | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const pendingScroll = useRef<{ sheet: string; range: CellRange } | null>(null);
  const cbRef = useRef(props);
  cbRef.current = props;

  // 資料が更新されてシートが消えたら先頭のシートへ
  useEffect(() => {
    if (!book.sheets.some((s) => s.name === sheetName)) setSheetName(book.sheets[0]?.name ?? "");
  }, [book, sheetName]);

  /** セル要素（結合セルの一部なら結合セル全体の要素） */
  const cellEl = useCallback(
    (r: number, c: number): HTMLElement | null => {
      const table = wrapRef.current?.querySelector("table");
      if (!table || !sheet) return null;
      const m = sheet.merges.find((g) => contains(g, r, c));
      const [rr, cc] = m ? [m.r1, m.c1] : [r, c];
      return table.tBodies[0]?.rows[rr]?.querySelector<HTMLElement>(`td[data-c="${cc}"]`) ?? null;
    },
    [sheet],
  );

  const boxOf = useCallback(
    (g: CellRange): Box | null => {
      const wrap = wrapRef.current;
      if (!wrap || !sheet || sheet.rows.length === 0) return null;
      const maxR = sheet.rows.length - 1;
      const maxC = (sheet.rows[0]?.length ?? 1) - 1;
      if (g.r1 > maxR || g.c1 > maxC) return null;
      const a = cellEl(g.r1, g.c1);
      const b = cellEl(Math.min(g.r2, maxR), Math.min(g.c2, maxC));
      if (!a || !b) return null;
      const w = wrap.getBoundingClientRect();
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const left = Math.min(ra.left, rb.left) - w.left;
      const top = Math.min(ra.top, rb.top) - w.top;
      return { left, top, width: Math.max(ra.right, rb.right) - w.left - left, height: Math.max(ra.bottom, rb.bottom) - w.top - top };
    },
    [cellEl, sheet],
  );

  const scrollTo = useCallback(
    (g: CellRange) => {
      const sc = scrollRef.current;
      const box = boxOf(g);
      if (!sc || !box) return;
      sc.scrollTo({ top: Math.max(0, box.top - sc.clientHeight / 3), left: Math.max(0, box.left - sc.clientWidth / 4), behavior: "smooth" });
    },
    [boxOf],
  );

  useImperativeHandle(ref, () => ({
    scrollToRange(name, range) {
      if (name !== sheet?.name) {
        pendingScroll.current = { sheet: name, range };
        setSheetName(name);
      } else scrollTo(range);
    },
    clearSelection() {
      setSel(null);
    },
  }));

  // 表の描画後・サイズ変更時に、重ねて描く枠の位置を計算し直す
  useLayoutEffect(() => {
    setLayoutTick((t) => t + 1);
    const p = pendingScroll.current;
    if (p && p.sheet === sheet?.name) {
      pendingScroll.current = null;
      scrollTo(p.range);
    }
    const table = wrapRef.current?.querySelector("table");
    if (!table) return;
    const ro = new ResizeObserver(() => setLayoutTick((t) => t + 1));
    ro.observe(table);
    return () => ro.disconnect();
  }, [sheet, scrollTo]);

  // 選択範囲を親へ通知
  useEffect(() => {
    if (!sel || !sheet || sel.sheet !== sheet.name) {
      cbRef.current.onSelectionChange(null);
      return;
    }
    cbRef.current.onSelectionChange({ sheet: sel.sheet, range: sel.range, quote: rangeQuote(sheet, sel.range) || `(空のセル ${formatRef(sel.range)})` });
  }, [sel, sheet]);

  useEffect(() => {
    const up = () => (dragging.current = false);
    document.addEventListener("mouseup", up);
    return () => document.removeEventListener("mouseup", up);
  }, []);

  if (!sheet) return <div className="flex h-full items-center justify-center bg-paper text-ink-dim">-- 表示できるシートがありません --</div>;

  const nRows = sheet.rows.length;
  const nCols = sheet.rows[0]?.length ?? 0;

  /** マウス位置の要素から、選択の起点・終点にするセル範囲を求める */
  const targetOf = (el: Element): CellRange | null => {
    const td = el.closest<HTMLElement>("td[data-r]");
    if (td) {
      const r = Number(td.dataset.r);
      const c = Number(td.dataset.c);
      return { r1: r, c1: c, r2: r, c2: c };
    }
    const th = el.closest<HTMLElement>("th[data-col], th[data-row]");
    if (th?.dataset.col !== undefined) {
      const c = Number(th.dataset.col);
      return { r1: 0, c1: c, r2: Math.max(0, nRows - 1), c2: c };
    }
    if (th?.dataset.row !== undefined) {
      const r = Number(th.dataset.row);
      return { r1: r, c1: 0, r2: r, c2: Math.max(0, nCols - 1) };
    }
    return null;
  };

  const select = (from: { r: number; c: number }, to: CellRange) => {
    const g = expandMerges(
      { r1: Math.min(from.r, to.r1), c1: Math.min(from.c, to.c1), r2: Math.max(from.r, to.r2), c2: Math.max(from.c, to.c2) },
      sheet.merges,
    );
    setSel({ sheet: sheet.name, anchor: from, range: g });
  };

  const counts = new Map<string, number>();
  for (const h of highlights) counts.set(h.sheet, (counts.get(h.sheet) ?? 0) + 1);

  void layoutTick; // 枠の位置は描画のたびに DOM から求める
  const boxes = highlights
    .filter((h) => h.sheet === sheet.name)
    .map((h) => ({ h, box: boxOf(h.range) }))
    .filter((x): x is { h: CellHighlight; box: Box } => x.box !== null)
    // 大きい範囲を下に、小さい範囲・アクティブを上に
    .sort((a, b) => (a.h.id === activeId ? 1 : 0) - (b.h.id === activeId ? 1 : 0) || b.box.width * b.box.height - a.box.width * a.box.height);
  const pendBox = pending && pending.sheet === sheet.name ? boxOf(pending.range) : null;
  const selBox = sel && sel.sheet === sheet.name ? boxOf(sel.range) : null;
  const style = (b: Box) => ({ top: b.top, left: b.left, width: b.width, height: b.height });

  return (
    <div className="flex h-full flex-col bg-paper text-ink">
      <div className="flex shrink-0 items-end gap-px overflow-x-auto border-b border-rule bg-[#ebe8e0] px-2 pt-1 font-mono text-xs">
        {book.sheets.map((s) => (
          <button
            key={s.name}
            onClick={() => {
              setSheetName(s.name);
              setSel(null);
            }}
            className={`shrink-0 border border-b-0 px-3 py-0.5 ${s.name === sheet.name ? "border-rule bg-paper text-ink" : "border-transparent text-ink-dim hover:text-ink"}`}
          >
            {s.name}
            {counts.get(s.name) ? <span className="ml-1 text-[#b4730f]">({counts.get(s.name)})</span> : null}
          </button>
        ))}
        {warnings.length > 0 && (
          <details className="relative ml-auto shrink-0 pb-0.5 text-ink-dim">
            <summary className="cursor-pointer">Excel 変換情報 {warnings.length}件</summary>
            <ul className="absolute right-0 z-30 mt-1 w-[48ch] list-disc border border-rule bg-paper py-1 pl-6 pr-2 shadow">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div
        ref={scrollRef}
        tabIndex={0}
        className="relative min-h-0 flex-1 overflow-auto outline-none"
        onKeyDown={(e) => {
          if (e.key === "Escape") setSel(null);
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && sel) {
            e.preventDefault();
            void navigator.clipboard?.writeText(rangeText(sheet, sel.range));
          }
        }}
      >
        <div
          ref={wrapRef}
          className="relative inline-block select-none"
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            const t = targetOf(e.target as Element);
            if (!t) return;
            e.preventDefault();
            scrollRef.current?.focus({ preventScroll: true });
            dragging.current = true;
            if (e.shiftKey && sel && sel.sheet === sheet.name) select(sel.anchor, t);
            else select({ r: t.r1, c: t.c1 }, t);
            props.onClickCell(sheet.name, t.r1, t.c1);
          }}
          onMouseOver={(e) => {
            if (!dragging.current || !sel || (e.buttons & 1) === 0) return;
            const t = targetOf(e.target as Element);
            if (t) select(sel.anchor, t);
          }}
        >
          <Grid sheet={sheet} />
          {boxes.map(({ h, box }) => (
            <div key={h.id} className={`cell-mark ${h.id === activeId ? "active" : h.stale ? "stale" : ""}`} style={style(box)} />
          ))}
          {pendBox && <div className="cell-mark pending" style={style(pendBox)} />}
          {selBox && <div className="cell-sel" style={style(selBox)} />}
          {selBox && (
            <button
              className="btn absolute z-30 border border-fg bg-bg font-mono text-xs"
              style={{ top: selBox.top + selBox.height + 4, left: selBox.left + Math.min(selBox.width, 240) }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => props.onAddNote()}
            >
              + ノート (Ctrl+M)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
