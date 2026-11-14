// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sheet, SheetBook } from "../lib/sheet";
import { SheetViewer, type CellSelection, type SheetViewerHandle } from "./SheetViewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollTo ??= function () {};
});

function sheet(name: string, rows: string[][], merges: Sheet["merges"] = []): Sheet {
  return { name, rows, types: rows.map((r) => r.map((v) => (/^[\d,]+$/.test(v) ? "n" : " ")).join("")), merges, colWidths: [], truncated: false };
}

const BOOK: SheetBook = {
  sheets: [
    sheet(
      "予算",
      [
        ["予算案", "", ""],
        ["項目", "4月", "5月"],
        ["人件費", "1,200", "1,350"],
      ],
      [{ r1: 0, c1: 0, r2: 0, c2: 2 }],
    ),
    sheet("日程", [["タスク"], ["設計"]]),
  ],
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function mount(overrides: Partial<Parameters<typeof SheetViewer>[0]> = {}) {
  container = document.createElement("div");
  document.body.replaceChildren(container);
  root = createRoot(container);
  const onSelectionChange = vi.fn<(s: CellSelection | null) => void>();
  const onClickCell = vi.fn();
  const ref = createRef<SheetViewerHandle>();
  act(() =>
    root.render(
      <SheetViewer
        ref={ref}
        book={BOOK}
        warnings={[]}
        highlights={[]}
        activeId={null}
        pending={null}
        onSelectionChange={onSelectionChange}
        onAddNote={() => {}}
        onClickCell={onClickCell}
        {...overrides}
      />,
    ),
  );
  return { onSelectionChange, onClickCell, ref };
}

const td = (r: number, c: number) => container.querySelector<HTMLElement>(`td[data-r="${r}"][data-c="${c}"]`)!;
const down = (el: Element, init: MouseEventInit = {}) =>
  act(() => void el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, ...init })));

afterEach(() => act(() => root.unmount()));

describe("SheetViewer", () => {
  it("列番号・行番号と結合セルを描画する", () => {
    mount();
    expect([...container.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(["", "A", "B", "C"]);
    expect(td(0, 0).colSpan).toBe(3);
    expect(td(0, 1)).toBeNull();
    expect(td(2, 1).className).toContain("num");
  });

  it("クリックでセルを選択し、Shift+クリックで範囲を広げる", () => {
    const { onSelectionChange, onClickCell } = mount();
    down(td(1, 1));
    expect(onClickCell).toHaveBeenLastCalledWith("予算", 1, 1);
    expect(onSelectionChange).toHaveBeenLastCalledWith({ sheet: "予算", range: { r1: 1, c1: 1, r2: 1, c2: 1 }, quote: "4月" });
    down(td(2, 2), { shiftKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      sheet: "予算",
      range: { r1: 1, c1: 1, r2: 2, c2: 2 },
      quote: "4月 | 5月\n1,200 | 1,350",
    });
  });

  it("結合セルにかかる選択は結合セル全体になる", () => {
    const { onSelectionChange } = mount();
    down(td(1, 1));
    down(td(0, 0), { shiftKey: true });
    expect(onSelectionChange.mock.lastCall?.[0]?.range).toEqual({ r1: 0, c1: 0, r2: 1, c2: 2 });
  });

  it("列番号のクリックで列全体を選択する（結合セルにかかれば Excel と同じく広がる）", () => {
    const { onSelectionChange } = mount();
    down(container.querySelector('th[data-col="2"]')!);
    expect(onSelectionChange.mock.lastCall?.[0]?.range).toEqual({ r1: 0, c1: 0, r2: 2, c2: 2 });
    down(container.querySelector('th[data-row="2"]')!);
    expect(onSelectionChange.mock.lastCall?.[0]?.range).toEqual({ r1: 2, c1: 0, r2: 2, c2: 2 });
  });

  it("別のシートのノートへジャンプするとシートが切り替わる", () => {
    const { ref } = mount();
    act(() => ref.current!.scrollToRange("日程", { r1: 1, c1: 0, r2: 1, c2: 0 }));
    expect(td(1, 0).textContent).toBe("設計");
    expect(container.querySelector("button.bg-paper")?.textContent).toBe("日程");
  });

  it("シートのタブにノートの件数を表示する", () => {
    mount({ highlights: [{ id: "note-001", sheet: "日程", range: { r1: 1, c1: 0, r2: 1, c2: 0 }, stale: false }] });
    const tabs = [...container.querySelectorAll("button")].map((b) => b.textContent);
    expect(tabs).toContain("日程(1)");
  });
});
