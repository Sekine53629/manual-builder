import { describe, expect, it } from "vitest";
import { buildManualHtml, groupChapters } from "../src/core/export";
import { renderChapter, renderManual } from "../src/core/manual";
import { createEmptyManual, type Figure, type Manual, type MarkdownChapter } from "../src/core/types";
import { SAMPLE_CATALOG, SAMPLE_IMAGES } from "./fixtures";

const FLOW_SVG: Figure = {
  id: "f1",
  name: "flow.svg",
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"></rect></svg>',
};

function md(id: string, title: string, sourceName: string, markdown: string, group = ""): MarkdownChapter {
  return { id, kind: "markdown", title, sourceName, markdown, group };
}

function makeManual(): Manual {
  const manual = createEmptyManual("テスト<マニュアル>");
  manual.version = "1.0";
  manual.revisedOn = "2026-10-17";
  manual.figures = [FLOW_SVG];
  manual.chapters = [
    md("c1", "はじめに", "01-intro.md", "# はじめに\n\n## 目的\n\n本文\n\n![業務フロー](figures/flow.svg)"),
    md("c2", "操作", "02-ops.md", "# 操作\n\n![無い図](missing.svg)\n\n### 細目"),
  ];
  return manual;
}

describe("renderChapter", () => {
  it("SVG 参照をインライン figure に置き換え、見出しに ID を付ける", () => {
    const manual = makeManual();
    const result = renderChapter(manual.chapters[0], manual, 1);
    expect(result.html).toContain('<figure class="manual-figure">');
    expect(result.html).toContain("<svg");
    expect(result.html).toContain("<figcaption>業務フロー</figcaption>");
    expect(result.html).not.toContain("<img");
    expect(result.toc).toEqual([
      { level: 1, id: "c1-1", text: "はじめに" },
      { level: 2, id: "c1-2", text: "目的" },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("見つからない図は警告表示に置き換え、warnings に記録する", () => {
    const manual = makeManual();
    const result = renderChapter(manual.chapters[1], manual, 2);
    expect(result.warnings).toEqual(["図 missing.svg が見つかりません"]);
    expect(result.html).toContain("manual-figure-missing");
  });

  it("front matter の title/subtitle を h1 と .sub にする", () => {
    const manual = makeManual();
    const chapter = md("c3", "x", "fm.md", "---\ntitle: 不動在庫処理\nsubtitle: 出典：担当表\n---\n\n## 全体の流れ\n\n本文");
    const result = renderChapter(chapter, manual, 3);
    expect(result.html).toContain('<h1 id="c3-1">不動在庫処理</h1>');
    expect(result.html).toContain('<p class="sub">出典：担当表</p>');
    expect(result.html).not.toContain("title:");
    expect(result.toc[1]).toEqual({ level: 2, id: "c3-2", text: "全体の流れ" });
  });

  it("[[chips:...]] をカタログから解決したチップに置き換える", () => {
    const manual = makeManual();
    manual.catalog = SAMPLE_CATALOG;
    manual.images = SAMPLE_IMAGES;
    const chapter = md("c4", "x", "chips.md", "手順:\n\n[[chips:m_tabs:F10, m_option1:F1, m_zaiko_tabs:F7, m_zaiko_zuiji:F1, s:伝票入力:F12, m_none:F1]]\n\n次へ");
    const result = renderChapter(chapter, manual, 4);
    expect(result.html).toContain('<div class="chips">');
    expect(result.html).toContain('<span class="chip tab"><span class="k">F10</span>オプション1</span>');
    expect(result.html).toContain('<span class="chip ztab"><span class="k">F7</span>随時処理</span>');
    expect(result.html).toContain('<span class="chip"><img src="data:image/png;base64,AAAA" alt=""><span class="k">F1</span>不動品リスト</span>');
    expect(result.html).toContain('<span class="chip key" title="伝票入力"><span class="k">F12</span>登録</span>');
    expect(result.html).toContain('<span class="chip missing" title="未登録の参照">m_none:F1</span>');
    expect(result.html).not.toContain("data-chips");
    expect(result.warnings).toEqual(["参照 m_none:F1 がカタログにありません", "m_option1:F1 の絵柄画像が取り込まれていません"]);
  });

  it("生 HTML の div（class 付き）と PNG 参照を通す", () => {
    const manual = makeManual();
    manual.images = [{ id: "i1", name: "shot.png", dataUri: "data:image/png;base64,BBBB" }];
    const chapter = md("c5", "x", "raw.md", '<div class="flow">\n<div class="fbox g">A</div>\n</div>\n\n![画面](img/shot.png)\n\n行1\n行2');
    const result = renderChapter(chapter, manual, 5);
    expect(result.html).toContain('<div class="fbox g">A</div>');
    expect(result.html).toContain('src="data:image/png;base64,BBBB"');
    expect(result.html).toContain("行1<br>行2");
  });
});

describe("buildManualHtml（単体出力）", () => {
  it("自己完結した HTML を生成し、タイトルをエスケープする", () => {
    const { html, warnings } = buildManualHtml(makeManual(), { css: "body{color:red}" });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<title>テスト&lt;マニュアル&gt;</title>");
    expect(html).toContain("body{color:red}");
    expect(html).toContain('<a href="#c1-2">目的</a>');
    expect(html).not.toContain('href="#c2-2"'); // h3 は目次に含めない
    expect(html).toContain("版 1.0｜改定日 2026-10-17");
    expect(warnings).toEqual(["章「操作」: 図 missing.svg が見つかりません"]);
  });

  it("章が 1 つなら h1 と .sub の直後に章内目次（h2 のみ）を入れる", () => {
    const manual = makeManual();
    manual.chapters = [md("c1", "x", "a.md", "---\ntitle: 単体\nsubtitle: サブ\n---\n\n## 一\n\n## 二")];
    const { html } = buildManualHtml(manual, { css: "" });
    expect(html).not.toContain("manual-header");
    const subIndex = html.indexOf('<p class="sub">サブ</p>');
    const tocIndex = html.indexOf('<nav class="toc-inline"');
    const firstH2 = html.indexOf('<h2 id="c1-2">');
    expect(subIndex).toBeGreaterThan(0);
    expect(tocIndex).toBeGreaterThan(subIndex);
    expect(firstH2).toBeGreaterThan(tocIndex);
    expect(html).toContain('<a href="#c1-2">一</a>');
    expect(html).not.toContain('<a href="#c1-1">');
  });
});

describe("buildManualHtml（統合版）", () => {
  it("表紙・全体目次・章バッジを出力する", () => {
    const manual = makeManual();
    manual.book = true;
    manual.subtitle = "統合版";
    manual.author = "作成者";
    manual.coverNotes = ["目次をクリックすると移動できます"];
    manual.chapters[0].group = "第1章 基本";
    manual.chapters[1].group = "第1章 基本";
    const { html } = buildManualHtml(manual, { css: "" });
    expect(html).toContain('<body class="book">');
    expect(html).toContain('<h1 class="cover-title">テスト&lt;マニュアル&gt;</h1>');
    expect(html).toContain('<p class="cover-sub">統合版</p>');
    expect(html).toContain("作成：作成者　／　2026年10月17日　／　版 1.0");
    expect(html).toContain('<p class="cover-note">目次をクリックすると移動できます</p>');
    expect(html).toContain("収録内容（2本）");
    expect(html).toContain("<li>第1章 基本（2本）</li>");
    expect(html).toContain('<div class="toc-group"><a href="#d1">第1章 基本</a></div>');
    expect(html).toContain('<div class="toc-item"><a href="#d2">操作</a></div>');
    expect(html).toContain('<article class="doc" id="d2" data-chapter="02-ops.md" data-kind="markdown">\n<div class="badge">第1章 基本</div>');
  });

  it("groupChapters は連続する同名グループをまとめる", () => {
    const manual = makeManual();
    manual.chapters[0].group = "A";
    manual.chapters[1].group = "B";
    manual.chapters.push(md("c3", "三", "c.md", "# 三", "B"));
    const groups = groupChapters(renderManual(manual));
    expect(groups.map((g) => [g.name, g.chapters.length])).toEqual([
      ["A", 1],
      ["B", 2],
    ]);
  });
});
