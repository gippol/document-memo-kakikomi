import { useEffect, useState } from "react";
import type { BoardData, BoardItem, FolderNote } from "../lib/board";
import type { LedgerData } from "../lib/ledger";
import { DecisionLedger } from "./DecisionLedger";
import { TaskBoard } from "./TaskBoard";

export type BoardTab = "tasks" | "decisions";

/** 決定の置き換え元を選ぶとき（決定事項の台帳から 1 件選ぶ） */
export interface PickSupersede {
  /** 置き換え元を付ける新しい決定（開いている資料のノート） */
  docPath: string;
  noteId: string;
  /** 新しい決定の内容（見出しに出す） */
  label: string;
  onPick(item: FolderNote): void;
}

interface Props {
  tab: BoardTab;
  onTab(t: BoardTab): void;
  /** 読み込み中は null */
  board: BoardData | null;
  decisions: LedgerData | null;
  error: string | null;
  onJump(item: FolderNote): void;
  /** 宿題を完了・質問を回答済みにする（done: false で戻す）。失敗したらエラーの文を返す */
  onSetDone(item: BoardItem, done: boolean): Promise<string | null>;
  onClose(): void;
  /** 指定すると、決定事項の台帳から置き換え元を選ぶ画面にする */
  pick?: PickSupersede;
}

/**
 * フォルダ全体のノートのダイアログ。
 * 「宿題・質問」（未完了の宿題・未回答の質問のボード）と「決定事項」（決定事項の台帳）を切り替える。
 * 項目を押すとその資料の該当箇所へ移動する。
 */
export function FolderBoard({ tab: shownTab, onTab, board, decisions, error, onJump, onSetDone, onClose, pick }: Props) {
  const tab = pick ? "decisions" : shownTab;
  // 日付が変わっても開いている間は同じ日で数える
  const [today] = useState(() => new Date());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tabs: [BoardTab, string, number | undefined][] = [
    ["tasks", "宿題・質問", board?.items.length],
    ["decisions", "決定事項", decisions?.items.length],
  ];
  const unreadable = (tab === "tasks" ? board : decisions)?.unreadable ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={pick ? "置き換え元の決定を選ぶ" : "フォルダ全体のノート"}
        className="flex h-full max-h-[48rem] w-full max-w-5xl flex-col border border-line bg-bg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-2 py-1">
          {pick ? (
            <span className="min-w-0 truncate" title={pick.label}>
              <span className="text-bright">置き換え元の決定を選ぶ</span>
              <span className="text-dim"> — 新しい決定: </span>
              {pick.label}
            </span>
          ) : (
            <>
              <span className="text-dim">フォルダ全体:</span>
              {tabs.map(([t, label, n]) => (
                <button key={t} onClick={() => onTab(t)} className={`btn ${tab === t ? "on" : ""}`}>
                  {label}
                  {n !== undefined && ` ${n}`}
                </button>
              ))}
            </>
          )}
          <button onClick={onClose} className="btn ml-auto">
            閉じる
          </button>
        </div>

        {error && <p className="border-b border-line px-2 py-1 text-warn">[!] ノートファイルを読み込めません: {error}</p>}
        {unreadable.length > 0 && (
          <p className="truncate border-b border-line px-2 py-1" title={unreadable.join("\n")}>
            <span className="text-bright">[W]</span> 読めないノートファイル {unreadable.length}件（表示していません）: {unreadable.join(", ")}
          </p>
        )}

        {tab === "tasks" ? (
          <TaskBoard data={board} today={today} onJump={onJump} onSetDone={onSetDone} />
        ) : (
          <DecisionLedger data={decisions} today={today} onJump={onJump} pick={pick} />
        )}
      </div>
    </div>
  );
}
