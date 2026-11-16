import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { LS_KEYS, lsGet, lsSet } from "../lib/storage";

/** 資料とノートの配置: side = 左右, stack = 上下 */
export type Layout = "side" | "stack";

/** ノート欄の既定サイズ（side: 幅, stack: 高さ, px） */
const PANE_DEFAULT: Record<Layout, number> = { side: 380, stack: 280 };
export const PANE_MIN = 160;

/** 資料とノート欄の配置と、境界線のドラッグによるノート欄のサイズ変更 */
export function usePaneLayout() {
  const [layout, setLayout] = useState<Layout>(() => (lsGet(LS_KEYS.layout) === "stack" ? "stack" : "side"));
  const [paneSize, setPaneSize] = useState<Record<Layout, number>>(() => ({
    side: Number(lsGet(LS_KEYS.paneSize("side"))) || PANE_DEFAULT.side,
    stack: Number(lsGet(LS_KEYS.paneSize("stack"))) || PANE_DEFAULT.stack,
  }));
  /** 資料とノート欄を囲む要素（ドラッグ時の大きさの基準） */
  const splitRef = useRef<HTMLDivElement>(null);

  const toggleLayout = () => {
    const next: Layout = layout === "side" ? "stack" : "side";
    lsSet(LS_KEYS.layout, next);
    setLayout(next);
  };

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = splitRef.current?.getBoundingClientRect();
    if (!box) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const l = layout;
    let size = paneSize[l];
    const onMove = (ev: PointerEvent) => {
      const total = l === "side" ? box.width : box.height;
      const raw = l === "side" ? box.right - ev.clientX : box.bottom - ev.clientY;
      size = Math.round(Math.min(Math.max(raw, PANE_MIN), total - PANE_MIN));
      setPaneSize((p) => ({ ...p, [l]: size }));
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      lsSet(LS_KEYS.paneSize(l), String(size));
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  return { layout, toggleLayout, paneSize: paneSize[layout], splitRef, startResize };
}
