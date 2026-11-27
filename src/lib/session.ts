/**
 * 会議の回（セッション）。
 * 定例会で同じ資料を毎回使うとき、どの回に書いたノートかを分ける。今はノートの作成日（この PC の時刻での日付）を回とみなす。
 */
import { formatDate } from "./noteMeta";

/** 回の日付 YYYY-MM-DD（作成日時が読めなければ記録された文字列の先頭 10 文字） */
export function sessionOf(note: { createdAt: string }): string {
  const d = new Date(note.createdAt);
  return isNaN(d.getTime()) ? note.createdAt.slice(0, 10) : formatDate(d);
}

export interface SessionCount {
  date: string;
  count: number;
}

/** ノートのある回と件数（新しい順） */
export function listSessions(notes: { createdAt: string }[]): SessionCount[] {
  const counts = new Map<string, number>();
  for (const n of notes) {
    const d = sessionOf(n);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts].map(([date, count]) => ({ date, count })).sort((a, b) => b.date.localeCompare(a.date));
}

/** 回で絞り込む（null は全部の回） */
export function inSession(note: { createdAt: string }, session: string | null): boolean {
  return session === null || sessionOf(note) === session;
}

/** 回の選択肢に出す名前（例: 2026-11-20 → 11/20(金)。今年でなければ年も付ける） */
export function sessionLabel(date: string, today: Date): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const md = `${Number(m[2])}/${Number(m[3])}(${"日月火水木金土"[d.getDay()]})`;
  return d.getFullYear() === today.getFullYear() ? md : `${m[1]}/${md}`;
}
