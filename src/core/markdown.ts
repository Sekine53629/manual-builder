// Markdown → HTML 変換（marked + DOMPurify）、front matter、チップ記法の前処理
import { marked, type MarkedOptions, type TokensList } from "marked";
import DOMPurify, { type Config, type DOMPurify as Purifier } from "dompurify";

const SANITIZE_OPTIONS: Config = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
};

/** `[[chips:...]]` の行を一時的に置き換えるプレースホルダ要素の属性名 */
export const CHIPS_PLACEHOLDER_ATTR = "data-chips";
/** 原稿の行番号を示すマーカー要素の属性名（manual.ts で次の要素の data-line に移す） */
export const LINE_MARKER_ATTR = "data-src-line";
/** 出力要素に付く原稿行番号の属性名（エディタのスクロール同期用。書き出し時は付けない） */
export const LINE_ATTR = "data-line";

const MARKED_OPTIONS: MarkedOptions = { async: false, gfm: true, breaks: true };

export interface RenderMarkdownOptions {
  /** true: 各ブロックの直前に原稿の行番号マーカーを入れる */
  sourceMap?: boolean;
  /** 本文の 1 行目が原稿全体の何行目か（front matter を除いた分のずれ） */
  lineOffset?: number;
}

let purifierInstance: Purifier | undefined;

/**
 * DOMPurify のインスタンスを返す。
 * ブラウザでは既定インスタンス、Node（jsdom）では後から用意した window で生成する。
 */
export function purifier(): Purifier {
  if (purifierInstance) {
    return purifierInstance;
  }
  if (DOMPurify.isSupported) {
    purifierInstance = DOMPurify;
  } else {
    const win = (globalThis as { window?: Window }).window;
    if (!win) {
      throw new Error("DOMPurify を初期化できません（window がありません）");
    }
    purifierInstance = DOMPurify(win as unknown as Parameters<typeof DOMPurify>[0]);
  }
  return purifierInstance;
}

/** 先頭の UTF-8 BOM を取り除く（日本語 Windows で保存した md は BOM 付きのことが多い） */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export interface FrontMatter {
  title?: string;
  subtitle?: string;
  [key: string]: string | undefined;
}

export interface ParsedMarkdown {
  frontMatter: FrontMatter;
  /** front matter を取り除いた本文 */
  body: string;
  /** 取り除いた front matter の行数（本文 1 行目は原稿の bodyLineOffset + 1 行目） */
  bodyLineOffset: number;
}

/** 先頭の `---` ブロック（key: value 形式のみ）を取り出す */
export function parseFrontMatter(markdown: string): ParsedMarkdown {
  const text = stripBom(markdown);
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) {
    return { frontMatter: {}, body: text, bodyLineOffset: 0 };
  }
  const frontMatter: FrontMatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (kv) {
      frontMatter[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  return { frontMatter, body: text.slice(match[0].length), bodyLineOffset: countNewlines(match[0]) };
}

/** Markdown の最初の `# 見出し` を章タイトルとして取り出す */
export function extractTitle(markdown: string, fallback: string): string {
  const { frontMatter, body } = parseFrontMatter(markdown);
  if (frontMatter.title) {
    return frontMatter.title;
  }
  const match = /^#\s+(.+?)\s*#*\s*$/m.exec(body);
  return match ? match[1].trim() : fallback;
}

/**
 * `[[chips:ref1, ref2]]` だけの行をプレースホルダ要素に置き換える。
 * marked は行頭の `<div` を HTML ブロックとして素通しするので、変換後に DOM で差し替える。
 */
export function replaceChipLines(markdown: string): string {
  return markdown.replace(/^[ \t]*\[\[chips:([^\]]*)\]\][ \t]*$/gm, (_m, body: string) => {
    const encoded = encodeURIComponent(body.trim());
    return `<div ${CHIPS_PLACEHOLDER_ATTR}="${encoded}"></div>`;
  });
}

/**
 * `**強調**` を `<strong>` に正規化する。
 * CommonMark では `**「6ヶ月前」**に` のように閉じ `**` の直前が約物・直後が文字だと強調にならないが、
 * 日本語の原稿ではこの書き方が頻出するため、フェンスコード以外では無条件に強調として扱う。
 */
export function normalizeStrong(markdown: string): string {
  const lines = markdown.split("\n");
  let inFence = false;
  return lines
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) {
        return line;
      }
      return line.replace(/\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*/g, "<strong>$1</strong>");
    })
    .join("\n");
}

function countNewlines(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      n += 1;
    }
  }
  return n;
}

/**
 * ブロック（marked のトップレベルトークン）ごとに変換し、直前に原稿の行番号マーカーを置く。
 * 行番号は 1 始まり・原稿全体での位置（lineOffset を加算）
 */
function renderWithLineMarkers(markdown: string, lineOffset: number): string {
  const tokens = marked.lexer(markdown, MARKED_OPTIONS);
  const out: string[] = [];
  let line = 1 + lineOffset;
  for (const token of tokens) {
    if (token.type !== "space") {
      const single = Object.assign([token], { links: tokens.links }) as unknown as TokensList;
      out.push(`<div ${LINE_MARKER_ATTR}="${line}"></div>`);
      out.push(marked.parser(single, MARKED_OPTIONS) as string);
    }
    line += countNewlines(token.raw);
  }
  return out.join("");
}

/** Markdown 本文をサニタイズ済み HTML に変換する（front matter は呼び出し側で除去済みであること） */
export function renderMarkdown(markdown: string, options: RenderMarkdownOptions = {}): string {
  try {
    const prepared = replaceChipLines(normalizeStrong(stripBom(markdown)));
    const raw = options.sourceMap
      ? renderWithLineMarkers(prepared, options.lineOffset ?? 0)
      : (marked.parse(prepared, MARKED_OPTIONS) as string);
    return purifier().sanitize(raw, SANITIZE_OPTIONS);
  } catch (error) {
    console.error("[renderMarkdown] Markdown の変換に失敗しました:", error);
    throw error;
  }
}

/** 1 行の Markdown（強調・コードなど）を HTML にする。手順文などに使う */
export function renderInline(markdown: string): string {
  try {
    const raw = marked.parseInline(normalizeStrong(markdown), { async: false, gfm: true }) as string;
    return purifier().sanitize(raw, SANITIZE_OPTIONS);
  } catch (error) {
    console.error("[renderInline] Markdown の変換に失敗しました:", error);
    throw error;
  }
}

/** 組み立て済み HTML 断片をサニタイズする（steps・カタログ章など） */
export function sanitizeHtml(html: string): string {
  return purifier().sanitize(html, SANITIZE_OPTIONS);
}
