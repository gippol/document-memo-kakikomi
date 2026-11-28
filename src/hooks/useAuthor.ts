import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { AUTHOR_MAX, resolveAuthor } from "../lib/author";
import { LS_KEYS, lsGet, lsRemove, lsSet } from "../lib/storage";

/**
 * ノートに記録する名前（書いた人・完了にした人）。
 * この PC で決めた名前（localStorage）を使い、決めていなければ git の user.name（開いているフォルダの設定も見る）。
 */
export function useAuthor(root: string | null) {
  /** この PC で決めた名前。null は決めていない（git の名前を使う）、空文字は記録しない */
  const [setting, setSettingState] = useState<string | null>(() => lsGet(LS_KEYS.author));
  const [gitName, setGitName] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .gitUserName(root)
      .catch(() => null)
      .then((n) => {
        if (alive) setGitName(n);
      });
    return () => {
      alive = false;
    };
  }, [root]);

  /** 名前を決める（空文字は記録しない）。null で決めたものを消し、git の名前に戻す */
  const setSetting = (v: string | null) => {
    const name = v === null ? null : v.trim().slice(0, AUTHOR_MAX);
    if (name === null) lsRemove(LS_KEYS.author);
    else lsSet(LS_KEYS.author, name);
    setSettingState(name);
  };

  return { author: resolveAuthor(setting, gitName), setting, gitName, setSetting };
}
