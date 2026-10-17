import { describe, expect, it } from "vitest";
import {
  assembleManual,
  computeGroupLabels,
  createDefaultManifest,
  isManifest,
  markdownTemplate,
  stepsTemplate,
  stripGroupNumber,
  type Manifest,
  type ProjectFiles,
} from "../src/core/project";
import { buildChapterHtml, buildManualHtml, groupChapters } from "../src/core/export";
import { renderChapter, renderManual } from "../src/core/manual";
import { isStepsData, type MarkdownChapter } from "../src/core/types";
import { SAMPLE_CATALOG, SAMPLE_STEPS } from "./fixtures";

/** メモリ上のファイル群で ProjectFiles を実装する */
function memoryFiles(entries: Record<string, string | Uint8Array>): ProjectFiles {
  return {
    async readText(path) {
      const v = entries[path];
      if (v === undefined || typeof v !== "string") {
        throw new Error(`no file: ${path}`);
      }
      return v;
    },
    async readDataUri(path) {
      return `data:image/png;base64,${Buffer.from(path).toString("base64")}`;
    },
    async list(dir) {
      const prefix = `${dir.replace(/\/$/, "")}/`;
      return Object.keys(entries).filter((k) => k.startsWith(prefix));
    },
  };
}

const MANIFEST: Manifest = {
  title: "テスト統合版",
  book: true,
  autoNumberGroups: true,
  catalog: "catalog/menus.json",
  menuTree: "catalog/menu-tree.txt",
  catalogMeta: { title: "一覧" },
  menus: { m_ctrl: { heading: "下段" }, m_none: { heading: "x" } },
  images: ["images"],
  chapters: [
    { file: "catalog", group: "第9章 基本" },
    { file: "chapters/a.md", group: "基本", title: "表示名A" },
    { file: "chapters/b.json", group: "操作", sub: "原本：b.pdf" },
    { file: "chapters/missing.md", group: "操作" },
  ],
};

const FILES = memoryFiles({
  "catalog/menus.json": JSON.stringify(SAMPLE_CATALOG),
  "catalog/menu-tree.txt": "root\n└─ F1",
  "images/m_zaiko_zuiji_F1.png": "",
  "images/flow.svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect/></svg>',
  "chapters/a.md": "---\ntitle: A\n---\n\n## 一\n\n本文",
  "chapters/b.json": JSON.stringify(SAMPLE_STEPS),
});

describe("assembleManual", () => {
  it("manifest と素材から Manual を組み立て、読めないものは warnings にする", async () => {
    const { manual, chapters, warnings } = await assembleManual(MANIFEST, FILES);
    expect(manual.title).toBe("テスト統合版");
    expect(manual.book).toBe(true);
    expect(manual.autoNumberGroups).toBe(true);
    expect(manual.catalog?.meta?.title).toBe("一覧");
    expect(manual.catalog?.menus.find((m) => m.id === "m_ctrl")?.heading).toBe("下段");
    expect(manual.menuTree).toContain("root");
    expect(manual.images.map((i) => i.name)).toEqual(["m_zaiko_zuiji_F1.png"]);
    expect(manual.figures.map((f) => f.name)).toEqual(["flow.svg"]);
    expect(manual.chapters.map((c) => c.kind)).toEqual(["catalog", "markdown", "steps", "markdown"]);
    expect(chapters[3].error).toContain("no file");
    expect(manual.chapters[3].kind === "markdown" && manual.chapters[3].markdown).toContain("読み込みエラー");
    expect(manual.chapters[1].displayTitle).toBe("表示名A");
    expect(manual.chapters[1].title).toBe("A");
    expect(chapters[1].sourcePath).toBe("chapters/a.md");
    expect(chapters[1].sourceText).toContain("## 一");
    const steps = manual.chapters[2];
    expect(steps.kind === "steps" && steps.data.sub).toBe("原本：b.pdf");
    expect(warnings).toEqual(["menus.m_none: カタログに無いメニュー ID です", "chapters/missing.md: no file: chapters/missing.md"]);
  });

  it("自動採番でグループ名の既存番号を外し、並び順で第N章を振る", async () => {
    const { manual } = await assembleManual(MANIFEST, FILES);
    const groups = groupChapters(renderManual(manual), true);
    expect(groups.map((g) => g.label)).toEqual(["第1章 基本", "第2章 操作"]);
    expect(computeGroupLabels(["第9章 基本", "基本", "", "操作", "第1章 操作"], true)).toEqual(["第1章 基本", "第1章 基本", "", "第2章 操作", "第2章 操作"]);
    expect(computeGroupLabels(["A", "A", "B"], false)).toEqual(["A", "A", "B"]);
    const { html } = buildManualHtml(manual, { css: "" });
    expect(html).toContain('<div class="badge">第1章 基本</div>');
    expect(html).toContain('<div class="toc-group"><a href="#d3">第2章 操作</a></div>');
    expect(html).toContain("<li>第1章 基本（2本）</li>");
    expect(html).not.toContain("第9章");
  });

  it("自動採番でなければグループ名をそのまま使う", async () => {
    const { manual } = await assembleManual({ ...MANIFEST, autoNumberGroups: false }, FILES);
    const { html } = buildManualHtml(manual, { css: "" });
    expect(html).toContain('<div class="badge">第9章 基本</div>');
    expect(html).toContain('<div class="badge">基本</div>');
  });
});

describe("helpers", () => {
  it("stripGroupNumber", () => {
    expect(stripGroupNumber("第12章 在庫・伝票")).toBe("在庫・伝票");
    expect(stripGroupNumber("第 3 章　基本")).toBe("基本");
    expect(stripGroupNumber("基本")).toBe("基本");
  });

  it("createDefaultManifest / isManifest / templates", () => {
    const m = createDefaultManifest("新規");
    expect(isManifest(m)).toBe(true);
    expect(isManifest({ menus: [] })).toBe(false);
    expect(m.chapters).toEqual([]);
    expect(markdownTemplate("題")).toContain("title: 題");
    expect(isStepsData(JSON.parse(stepsTemplate("題")))).toBe(true);
  });
});

describe("sourceMap（エディタのスクロール同期）", () => {
  it("Markdown の各ブロックに原稿の行番号 data-line を付け、front matter 分をずらす", async () => {
    const { manual } = await assembleManual(MANIFEST, FILES);
    const chapter: MarkdownChapter = {
      id: "x",
      kind: "markdown",
      title: "t",
      sourceName: "x.md",
      group: "",
      markdown: "---\ntitle: T\n---\n\n## 一\n\n本文\n\n[[chips:m_tabs:F1]]\n\n- a\n- b",
    };
    const r = renderChapter(chapter, manual, 1, { sourceMap: true });
    expect(r.html).toContain('<h1 data-line="1" id="c1-1">T</h1>');
    expect(r.html).toContain('<h2 data-line="5" id="c1-2">一</h2>');
    expect(r.html).toContain('<p data-line="7">本文</p>');
    expect(r.html).toContain('<div class="chips" data-line="9">');
    expect(r.html).toContain('<ul data-line="11">');
    expect(r.html).not.toContain("data-src-line");
    // 既定（書き出し）では行番号を付けない
    expect(renderChapter(chapter, manual, 1).html).not.toContain("data-line");
  });

  it("手順には data-step を付け、章プレビューは 1 章だけをバッジ付きで出す", async () => {
    const { manual } = await assembleManual(MANIFEST, FILES);
    const { html, chapterHtml } = buildChapterHtml(manual, 2, { css: "x{}" });
    expect(html).toContain('<li class="step" data-step="1">');
    expect(html).toContain('<div class="badge">第2章 操作</div>');
    expect(chapterHtml).toContain('data-step="2"');
    expect(chapterHtml).not.toContain("<article");
    expect(html).not.toContain("表示名A");
    expect(buildManualHtml(manual, { css: "" }).html).not.toContain("data-step");
  });
});
