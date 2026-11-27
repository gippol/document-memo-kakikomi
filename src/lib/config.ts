/** 資料フォルダごとの設定ファイル（フォルダ直下に置く。任意） */
export const CONFIG_FILE = ".document-memo-kakikomi.json";

/** 全体メモに入れる定型文 */
export interface NoteTemplate {
  /** ボタンに出す名前 */
  name: string;
  text: string;
}

export interface FolderConfig {
  /** Word の見出しスタイル指定: スタイル名 → 見出しレベル (1〜6)、0 は「見出しにしない」 */
  docxHeadings: Record<string, number>;
  /** 全体メモのテンプレート。設定ファイルに書かなければ DEFAULT_TEMPLATES */
  templates: NoteTemplate[];
}

/** 設定ファイルに templates が無いときのテンプレート */
export const DEFAULT_TEMPLATES: NoteTemplate[] = [
  { name: "定例会", text: "出席者：\n欠席：\n議題：\n1. \n次回日程：" },
];

export const DEFAULT_CONFIG: FolderConfig = { docxHeadings: {}, templates: DEFAULT_TEMPLATES };

/**
 * 設定ファイルを読む。JSON として読めないときは例外。
 * 項目（docxHeadings・templates）は別々に読み、壊れた項目だけ既定値にして errors に理由を返す
 * （テンプレートの書き間違いで Word の見出し設定まで消えないように）
 */
export function parseConfig(json: string): { config: FolderConfig; errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    throw new Error(`JSON として読めません（${e instanceof Error ? e.message : e}）`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("最上位はオブジェクト { ... } にしてください");
  }
  const obj = data as Record<string, unknown>;
  const errors: string[] = [];
  const item = <T>(parse: () => T, fallback: T): T => {
    try {
      return parse();
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      return fallback;
    }
  };
  const config: FolderConfig = {
    docxHeadings: item(() => parseDocxHeadings(obj.docxHeadings), DEFAULT_CONFIG.docxHeadings),
    templates: item(() => parseTemplates(obj.templates), DEFAULT_CONFIG.templates),
  };
  return { config, errors };
}

function parseDocxHeadings(raw: unknown = {}): Record<string, number> {
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
  return docxHeadings;
}

const TEMPLATE_SHAPE = `{ "name": "名前", "text": "本文" }（本文は行の配列 ["1 行目", "2 行目"] でもよい）`;

/** text は文字列か、JSON で改行を書きやすいよう行の配列 */
function parseTemplates(raw: unknown): NoteTemplate[] {
  if (raw === undefined) return DEFAULT_TEMPLATES;
  if (!Array.isArray(raw)) throw new Error(`"templates" は [ ${TEMPLATE_SHAPE}, ... ] の形にしてください`);
  return raw.map((t, i) => {
    const at = `"templates" の ${i + 1} 番目`;
    if (typeof t !== "object" || t === null || Array.isArray(t)) throw new Error(`${at}は ${TEMPLATE_SHAPE} の形にしてください`);
    const { name, text } = t as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim()) throw new Error(`${at}の "name" を文字列で書いてください`);
    const lines = typeof text === "string" ? [text] : text;
    if (!Array.isArray(lines) || !lines.every((l) => typeof l === "string")) {
      throw new Error(`${at}（${name}）の "text" は文字列か、文字列の配列にしてください`);
    }
    // Windows の改行（\r\n）は textarea が \n にそろえるので、カーソル位置がずれないよう先にそろえる
    return { name: name.trim(), text: lines.join("\n").replace(/\r\n?/g, "\n") };
  });
}

/**
 * 書きかけのコメントにテンプレートを入れる。空ならそのまま、何か書いてあれば改行して後ろに足す（書いたものは消さない）。
 * cursor は入れた後にカーソルを置く位置（テンプレートの 1 行目の末尾。「出席者：」の後ろからすぐ書ける）
 */
export function insertTemplate(comment: string, text: string): { comment: string; cursor: number } {
  const head = comment.trimEnd() ? comment.trimEnd() + "\n" : "";
  const firstLine = text.split("\n")[0];
  return { comment: head + text, cursor: head.length + firstLine.length };
}
