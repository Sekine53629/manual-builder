// 章 HTML の組み立て：種類ごとの変換・図と画像の差し込み・チップの差し替え・見出し ID 付与
import { chapterTitle, type Chapter, type Figure, type ImageAsset, type Manual, type MarkdownChapter } from "./types";
import { CHIPS_PLACEHOLDER_ATTR, LINE_ATTR, LINE_MARKER_ATTR, parseFrontMatter, renderMarkdown } from "./markdown";
import { figureKey } from "./svg";
import { findImage, parseChipRefs, renderChips, type ChipContext } from "./catalog";
import { renderStepsHtml } from "./steps";
import { renderCatalogHtml } from "./catalog-page";
import { escapeHtml } from "./html";
import { figureStyle, serializeFigureAttrs, splitFigureSrc, type FigureLayout } from "./figure-layout";

export interface TocEntry {
  level: number;
  id: string;
  text: string;
}

export interface RenderedChapter {
  chapter: Chapter;
  /** 章のアンカー ID（d1, d2, …） */
  anchor: string;
  html: string;
  toc: TocEntry[];
  /** 図・画像・参照の未解決などの警告（表示用） */
  warnings: string[];
}

const TOC_HEADING_SELECTOR = "h1, h2, h3";
const RASTER_EXTENSIONS = /\.(png|jpe?g|gif|webp)$/i;

export interface RenderChapterOptions {
  /** true: 原稿の行番号（data-line / data-step）を出力に残す。エディタのスクロール同期用 */
  sourceMap?: boolean;
}

/**
 * 1 章を HTML に変換する。
 * - Markdown: front matter → h1 + サブタイトル、`[[chips:...]]` → チップ
 * - steps / catalog: 専用テンプレート
 * - `<img src="xxx.svg">` → インライン SVG、`<img src="xxx.png">` → data URI
 * - 見出しに `c{章番号}-{連番}` 形式の ID を付け、目次エントリを返す
 */
export function renderChapter(chapter: Chapter, manual: Manual, index: number, options: RenderChapterOptions = {}): RenderedChapter {
  try {
    const context: ChipContext = { catalog: manual.catalog, images: manual.images };
    const warnings: string[] = [];
    const sourceMap = options.sourceMap === true;
    const raw = renderBody(chapter, manual, context, warnings, sourceMap);
    const doc = new DOMParser().parseFromString(raw, "text/html");

    inlineFigures(doc, manual.figures, manual.images, sourceMap).forEach((src) => warnings.push(`図 ${src} が見つかりません`));
    replaceChipPlaceholders(doc, context, warnings);
    applyLineMarkers(doc);
    const toc = assignHeadingIds(doc, index);

    return { chapter, anchor: `d${index}`, html: doc.body.innerHTML, toc, warnings };
  } catch (error) {
    console.error(`[renderChapter] 章「${chapter.title}」の変換に失敗しました:`, error);
    throw error;
  }
}

/** マニュアル全体を章ごとに変換する */
export function renderManual(manual: Manual, options: RenderChapterOptions = {}): RenderedChapter[] {
  return manual.chapters.map((chapter, index) => renderChapter(chapter, manual, index + 1, options));
}

function renderBody(chapter: Chapter, manual: Manual, context: ChipContext, warnings: string[], sourceMap: boolean): string {
  switch (chapter.kind) {
    case "markdown":
      return renderMarkdownBody(chapter, sourceMap);
    case "steps": {
      const data = chapter.displayTitle ? { ...chapter.data, title: chapterTitle(chapter) } : chapter.data;
      const result = renderStepsHtml(data, context, { sourceMap });
      warnings.push(...result.warnings);
      return result.html;
    }
    case "catalog": {
      const result = renderCatalogHtml(manual, chapter.displayTitle);
      warnings.push(...result.warnings);
      return result.html;
    }
  }
}

function renderMarkdownBody(chapter: MarkdownChapter, sourceMap: boolean): string {
  const { frontMatter, body, bodyLineOffset } = parseFrontMatter(chapter.markdown);
  const header: string[] = [];
  const hasH1 = /^#\s+\S/m.test(body);
  if (frontMatter.title || !hasH1 || chapter.displayTitle) {
    header.push(`<h1>${escapeHtml(chapter.displayTitle?.trim() || frontMatter.title || chapter.title)}</h1>`);
  }
  if (frontMatter.subtitle) {
    header.push(`<p class="sub">${escapeHtml(frontMatter.subtitle)}</p>`);
  }
  // front matter 由来の h1 / sub は原稿 1 行目に対応させる
  const headerMarker = sourceMap && header.length > 0 ? `<div ${LINE_MARKER_ATTR}="1"></div>` : "";
  return headerMarker + header.join("\n") + renderMarkdown(body, { sourceMap, lineOffset: bodyLineOffset });
}

/** 行番号マーカー（空 div）を取り除き、直後の要素に data-line を付ける */
function applyLineMarkers(doc: Document): void {
  doc.querySelectorAll<HTMLElement>(`[${LINE_MARKER_ATTR}]`).forEach((marker) => {
    const line = marker.getAttribute(LINE_MARKER_ATTR) ?? "";
    const target = marker.nextElementSibling as HTMLElement | null;
    if (target && !target.hasAttribute(LINE_MARKER_ATTR) && !target.hasAttribute(LINE_ATTR)) {
      target.setAttribute(LINE_ATTR, line);
    }
    marker.remove();
  });
}

/** `<img>` を図（インライン SVG）または data URI 画像に差し替える。戻り値は見つからなかった参照 */
function inlineFigures(doc: Document, figures: Figure[], images: ImageAsset[], sourceMap = false): string[] {
  const byKey = new Map(figures.map((figure) => [figureKey(figure.name), figure]));
  const missing: string[] = [];

  doc.querySelectorAll("img").forEach((img) => {
    const rawSrc = img.getAttribute("src") ?? "";
    if (rawSrc.startsWith("data:")) {
      return; // チップなどで既に埋め込み済み
    }
    const { path: src, layout } = splitFigureSrc(rawSrc);
    const key = figureKey(src);
    const caption = img.getAttribute("alt") ?? "";
    if (/\.svg$/i.test(key)) {
      const figure = byKey.get(key);
      if (!figure) {
        missing.push(src);
        img.replaceWith(createMissingNotice(doc, src));
        return;
      }
      const figureEl = createFigureElement(doc, caption, layout, key, sourceMap);
      figureEl.insertAdjacentHTML("afterbegin", figure.svg);
      img.replaceWith(figureEl);
      return;
    }
    if (RASTER_EXTENSIONS.test(key)) {
      const asset = findImage(src, images);
      if (!asset) {
        missing.push(src);
        img.replaceWith(createMissingNotice(doc, src));
        return;
      }
      img.setAttribute("src", asset.dataUri);
      // 手順ページの figure.shot など、既に figure に入っているものはそのまま
      if (img.parentElement?.tagName === "FIGURE") {
        return;
      }
      const figureEl = createFigureElement(doc, caption, layout, key, sourceMap);
      img.replaceWith(figureEl);
      figureEl.insertAdjacentElement("afterbegin", img);
      img.removeAttribute("alt");
      img.setAttribute("alt", "");
    }
  });

  return missing;
}

/** 図の入れ物。配置属性を style に、編集用に data-fig（ファイル名）と data-fig-layout を付ける */
function createFigureElement(doc: Document, caption: string, layout: FigureLayout, key: string, sourceMap: boolean): HTMLElement {
  const figureEl = doc.createElement("figure");
  figureEl.className = "manual-figure";
  const style = figureStyle(layout);
  if (style) {
    figureEl.setAttribute("style", style);
  }
  if (sourceMap) {
    figureEl.setAttribute("data-fig", key);
    figureEl.setAttribute("data-fig-layout", serializeFigureAttrs(layout));
  }
  if (caption) {
    const captionEl = doc.createElement("figcaption");
    captionEl.textContent = caption;
    figureEl.appendChild(captionEl);
  }
  return figureEl;
}

function createMissingNotice(doc: Document, src: string): HTMLElement {
  const notice = doc.createElement("div");
  notice.className = "manual-figure-missing";
  notice.textContent = `[図が見つかりません: ${src}]`;
  return notice;
}

/** `[[chips:...]]` のプレースホルダをチップに差し替える */
function replaceChipPlaceholders(doc: Document, context: ChipContext, warnings: string[]): void {
  doc.querySelectorAll<HTMLElement>(`[${CHIPS_PLACEHOLDER_ATTR}]`).forEach((placeholder) => {
    let body = placeholder.getAttribute(CHIPS_PLACEHOLDER_ATTR) ?? "";
    try {
      body = decodeURIComponent(body);
    } catch {
      // エンコードされていない値はそのまま使う
    }
    const result = renderChips(parseChipRefs(body), context);
    result.missing.forEach((ref) => warnings.push(`参照 ${ref} がカタログにありません`));
    result.missingImages.forEach((ref) => warnings.push(`${ref} の絵柄画像が取り込まれていません`));
    const wrapper = doc.createElement("div");
    wrapper.innerHTML = result.html;
    const chips = wrapper.firstElementChild;
    if (chips) {
      placeholder.replaceWith(chips);
    } else {
      placeholder.remove();
    }
  });
}

function assignHeadingIds(doc: Document, chapterIndex: number): TocEntry[] {
  const entries: TocEntry[] = [];
  doc.querySelectorAll<HTMLHeadingElement>(TOC_HEADING_SELECTOR).forEach((heading, i) => {
    const id = `c${chapterIndex}-${i + 1}`;
    heading.id = id;
    entries.push({
      level: Number(heading.tagName.slice(1)),
      id,
      text: heading.textContent?.trim() ?? "",
    });
  });
  return entries;
}
