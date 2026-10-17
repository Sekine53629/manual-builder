// 配布用の単一 HTML ファイルを生成する
import { chapterTitle, type Manual } from "./types";
import { renderChapter, renderManual, type RenderedChapter, type TocEntry } from "./manual";
import { computeGroupLabels, stripGroupNumber } from "./project";
import { renderCover } from "./cover";
import { escapeHtml, joinHtml } from "./html";

export { escapeHtml } from "./html";

export interface ExportOptions {
  /** 出力 HTML に埋め込む CSS */
  css: string;
}

export interface ExportResult {
  html: string;
  /** 未解決の図などの警告（表示用） */
  warnings: string[];
  /** 章プレビューのとき、その章の本文 HTML（HTML 表示ペイン用） */
  chapterHtml?: string;
}

/** 章内目次（統合版でない場合）に載せる見出しレベルの上限 */
const TOC_MAX_LEVEL = 2;

/** マニュアル全体を自己完結した HTML 文字列にする（CSS・SVG・画像を内包、外部参照なし） */
export function buildManualHtml(manual: Manual, options: ExportOptions): ExportResult {
  try {
    const rendered = renderManual(manual);
    const warnings = rendered.flatMap((r) => r.warnings.map((w) => `章「${chapterTitle(r.chapter)}」: ${w}`));
    const title = escapeHtml(manual.title);

    const body = manual.book ? buildBookBody(manual, rendered) : buildPlainBody(manual, rendered);
    const html = wrapDocument(title, options.css, manual.book ? "book" : "plain", body);
    return { html, warnings };
  } catch (error) {
    console.error("[buildManualHtml] HTML の生成に失敗しました:", error);
    throw error;
  }
}

// ---- 統合版（表紙・全体目次・章バッジ） ---------------------------------

interface ChapterGroup {
  /** 章に書かれたままのグループ名 */
  name: string;
  /** 出力に使うグループ名（自動採番なら「第N章 名前」） */
  label: string;
  chapters: RenderedChapter[];
}

/** 連続する同じグループ名の章をまとめる（空のグループ名は直前のグループに属さず「未分類」） */
export function groupChapters(rendered: RenderedChapter[], autoNumber = false): ChapterGroup[] {
  const groups: ChapterGroup[] = [];
  const key = (name: string) => (autoNumber ? stripGroupNumber(name) : name);
  for (const r of rendered) {
    const name = r.chapter.group.trim();
    const last = groups[groups.length - 1];
    if (last && key(last.name) === key(name)) {
      last.chapters.push(r);
    } else {
      groups.push({ name, label: name, chapters: [r] });
    }
  }
  const labels = computeGroupLabels(
    groups.map((g) => g.name),
    autoNumber,
  );
  groups.forEach((g, i) => {
    g.label = labels[i];
  });
  return groups;
}

/** 章ごとのグループ表示名（章バッジ・目次に使う） */
export function groupLabels(manual: Manual, rendered: RenderedChapter[]): Map<RenderedChapter, string> {
  const map = new Map<RenderedChapter, string>();
  for (const g of groupChapters(rendered, manual.autoNumberGroups)) {
    g.chapters.forEach((r) => map.set(r, g.label));
  }
  return map;
}

/**
 * エディタのプレビュー用に 1 章だけを HTML にする（行番号付き）。
 * 統合版なら章バッジも付け、見た目は書き出し結果と同じにする
 */
export function buildChapterHtml(manual: Manual, chapterIndex: number, options: ExportOptions): ExportResult {
  try {
    const chapter = manual.chapters[chapterIndex];
    if (!chapter) {
      throw new Error(`章がありません: ${chapterIndex}`);
    }
    const target = renderChapter(chapter, manual, chapterIndex + 1, { sourceMap: true });
    const labels = computeGroupLabels(
      manual.chapters.map((c) => c.group),
      manual.autoNumberGroups,
    );
    const label = manual.book ? labels[chapterIndex] : "";
    const body = manual.book || manual.chapters.length > 1 ? buildArticle(target, label) : buildSingleArticle(target);
    return {
      html: wrapDocument(escapeHtml(chapterTitle(chapter)), options.css, manual.book ? "book" : "plain", body),
      warnings: target.warnings.map((w) => `章「${chapterTitle(chapter)}」: ${w}`),
      chapterHtml: target.html,
    };
  } catch (error) {
    console.error("[buildChapterHtml] 章プレビューの生成に失敗しました:", error);
    throw error;
  }
}

function wrapDocument(title: string, css: string, bodyClass: string, body: string): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="ja">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    "<style>",
    css,
    "</style>",
    "</head>",
    `<body class="${bodyClass}">`,
    body,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function buildBookBody(manual: Manual, rendered: RenderedChapter[]): string {
  const groups = groupChapters(rendered, manual.autoNumberGroups);
  const labels = groupLabels(manual, rendered);
  return [
    buildCover(manual),
    buildBookToc(groups),
    '<main class="manual-body">',
    joinHtml(rendered, (r) => buildArticle(r, labels.get(r) ?? "")),
    "</main>",
  ].join("\n");
}

function buildCover(manual: Manual): string {
  return renderCover(manual, manual.cover);
}

/** エディタ用: 表紙だけを HTML にする（要素に data-el を付け、ドラッグできるようにする） */
export function buildCoverHtml(manual: Manual, options: ExportOptions): ExportResult {
  try {
    const html = renderCover(manual, manual.cover, { editable: true });
    return { html: wrapDocument(escapeHtml(manual.title), options.css, "book", html), warnings: [], chapterHtml: html };
  } catch (error) {
    console.error("[buildCoverHtml] 表紙プレビューの生成に失敗しました:", error);
    throw error;
  }
}

function buildBookToc(groups: ChapterGroup[]): string {
  const rows = groups.flatMap((g) => {
    const first = g.chapters[0];
    const head = g.label
      ? [`<div class="toc-group"><a href="#${first.anchor}">${escapeHtml(g.label)}</a></div>`]
      : [];
    const items = g.chapters.map((r) => `<div class="toc-item"><a href="#${r.anchor}">${escapeHtml(chapterTitle(r.chapter))}</a></div>`);
    return [...head, ...items];
  });
  return ['<nav class="toc" aria-label="目次">', "<h2>目次</h2>", rows.join("\n"), "</nav>"].join("\n");
}

function buildArticle(r: RenderedChapter, groupLabel: string): string {
  const source = escapeHtml(r.chapter.sourceName);
  const badge = groupLabel.trim() ? `<div class="badge">${escapeHtml(groupLabel.trim())}</div>\n` : "";
  return `<article class="doc" id="${r.anchor}" data-chapter="${source}" data-kind="${r.chapter.kind}">\n${badge}${r.html}\n</article>`;
}

/** 単体出力（章 1 つ）: h1 と sub の直後に章内目次を差し込んだ article */
function buildSingleArticle(r: RenderedChapter): string {
  const entries = r.toc.filter((e) => e.level === TOC_MAX_LEVEL);
  const html = insertAfterSubtitle(r.html, buildPlainToc(entries));
  return `<article class="doc" id="${r.anchor}" data-chapter="${escapeHtml(r.chapter.sourceName)}" data-kind="${r.chapter.kind}">\n${html}\n</article>`;
}

// ---- 単体出力（章内目次） ---------------------------------------------------

function buildPlainBody(manual: Manual, rendered: RenderedChapter[]): string {
  const parts: string[] = [];
  if (rendered.length !== 1) {
    parts.push(
      '<header class="manual-header">',
      `<h1>${escapeHtml(manual.title)}</h1>`,
      `<p class="sub">版 ${escapeHtml(manual.version)}｜改定日 ${escapeHtml(manual.revisedOn)}</p>`,
      "</header>",
    );
  }
  if (rendered.length === 1) {
    // 単体のマニュアル: h1 と sub の直後に目次を差し込む
    parts.push(buildSingleArticle(rendered[0]));
  } else {
    const entries = rendered.flatMap((r) => r.toc).filter((e) => e.level <= TOC_MAX_LEVEL);
    const labels = groupLabels(manual, rendered);
    parts.push(buildPlainToc(entries), '<main class="manual-body">', joinHtml(rendered, (r) => buildArticle(r, labels.get(r) ?? "")), "</main>");
  }
  return parts.join("\n");
}

function buildPlainToc(entries: TocEntry[]): string {
  if (entries.length === 0) {
    return "";
  }
  const items = joinHtml(entries, (e) => `<li class="toc-level-${e.level}"><a href="#${e.id}">${escapeHtml(e.text)}</a></li>`);
  return ['<nav class="toc-inline" aria-label="目次">', "<b>目次</b>", "<ul>", items, "</ul>", "</nav>"].join("\n");
}

/** 先頭の h1（と続く p.sub）の直後に HTML を差し込む。無ければ先頭に置く */
function insertAfterSubtitle(html: string, insert: string): string {
  if (!insert) {
    return html;
  }
  const match = /^([\s\S]*?<h1[^>]*>[\s\S]*?<\/h1>\s*(?:<p class="sub">[\s\S]*?<\/p>)?)/.exec(html);
  if (!match) {
    return `${insert}\n${html}`;
  }
  return `${match[1]}\n${insert}${html.slice(match[1].length)}`;
}
