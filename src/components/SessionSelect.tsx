import { sessionLabel, type SessionCount } from "../lib/session";

/**
 * 会議の回（ノートの作成日）を選ぶ。null はすべての回。
 * 毎週の定例会で 1 年使うと回が 50 を超えるので、ボタンを並べず select にする。
 */
export function SessionSelect(props: {
  sessions: SessionCount[];
  value: string | null;
  onChange(v: string | null): void;
  /** すべての回の件数 */
  total: number;
}) {
  const today = new Date();
  // 選んでいる回のノートがすべて消えても、選択肢から消さない
  const list =
    props.value && !props.sessions.some((s) => s.date === props.value)
      ? [...props.sessions, { date: props.value, count: 0 }]
      : props.sessions;
  return (
    <label className="flex items-center gap-1 text-dim" title="ノートを書いた日を会議の回とみなして絞り込みます">
      回:
      <select
        value={props.value ?? ""}
        onChange={(e) => props.onChange(e.target.value || null)}
        className="border border-dim bg-bg px-1 text-bright outline-none [color-scheme:dark] focus:border-fg"
      >
        <option value="">すべての回 ({props.total})</option>
        {list.map((s) => (
          <option key={s.date} value={s.date}>
            {sessionLabel(s.date, today)} ({s.count})
          </option>
        ))}
      </select>
    </label>
  );
}
