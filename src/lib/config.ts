/** 資料フォルダごとの設定ファイル（フォルダ直下に置く。任意） */
export const CONFIG_FILE = ".document-memo-kakikomi.json";

export interface FolderConfig {
  /** Word の見出しスタイル指定: スタイル名 → 見出しレベル (1〜6)、0 は「見出しにしない」 */
  docxHeadings: Record<string, number>;
}

export const DEFAULT_CONFIG: FolderConfig = { docxHeadings: {} };

export function parseConfig(json: string): FolderConfig {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    throw new Error(`JSON として読めません（${e instanceof Error ? e.message : e}）`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("最上位はオブジェクト { ... } にしてください");
  }
  const raw = (data as Record<string, unknown>).docxHeadings ?? {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`"docxHeadings" は { "スタイル名": レベル } の形にしてください`);
  }
  const docxHeadings: Record<string, number> = {};
  for (const [name, lvl] of Object.entries(raw)) {
    if (typeof lvl !== "number" || !Number.isInteger(lvl) || lvl < 0 || lvl > 6) {
      throw new Error(`"docxHeadings" の「${name}」は 0〜6 の整数にしてください（0 は見出しにしない）`);
    }
    docxHeadings[name] = lvl;
  }
  return { docxHeadings };
}
