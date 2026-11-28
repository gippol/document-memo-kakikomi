import { useState } from "react";
import { AUTHOR_MAX } from "../lib/author";

/**
 * ヘッダーの「名前」: ノートに記録する名前（書いた人・完了にした人）を見せ、押すとその場で変えられる。
 * Enter で決める（空にすると記録しない）、Esc でやめる。git の名前を使っているときはそう示す
 */
export function AuthorSetting(props: {
  author: string | undefined;
  setting: string | null;
  gitName: string | null;
  onChange(v: string | null): void;
}) {
  const { author, setting, gitName } = props;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  if (editing) {
    const done = (v: string | null) => {
      props.onChange(v);
      setEditing(false);
    };
    return (
      <span className="flex shrink-0 items-center gap-1">
        <span className="text-dim">名前</span>
        <input
          autoFocus
          value={value}
          maxLength={AUTHOR_MAX}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") done(value);
            else if (e.key === "Escape") setEditing(false);
          }}
          placeholder="空にすると記録しない"
          aria-label="ノートに記録する名前"
          className="w-[16ch] border border-dim bg-bg px-1 text-bright caret-bright outline-none placeholder:text-dim focus:border-fg"
        />
        <button className="btn" onClick={() => done(value)}>
          決定
        </button>
        {gitName && (
          <button className="btn" title={`git の user.name（${gitName}）を使う`} onClick={() => done(null)}>
            git の名前
          </button>
        )}
        <button className="btn" onClick={() => setEditing(false)}>
          やめる
        </button>
      </span>
    );
  }

  const source = setting === null ? (gitName ? "git の user.name" : "未設定") : setting === "" ? "記録しない" : "この PC で設定";
  return (
    <button
      className={`btn shrink-0 ${author ? "" : "text-dim"}`}
      title={`ノートに記録する名前（書いた人・完了にした人）: ${author ?? "なし"}（${source}）。押すと変えられます`}
      onClick={() => {
        setValue(author ?? "");
        setEditing(true);
      }}
    >
      {author ? `名前: ${author}` : "名前: なし"}
    </button>
  );
}
