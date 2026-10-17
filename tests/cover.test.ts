import { describe, expect, it } from "vitest";
import { coverTemplate, defaultCoverDesign, expandPlaceholders, isCoverDesign, newCoverElement, renderCover, type CoverDesign } from "../src/core/cover";
import { buildCoverHtml, buildManualHtml } from "../src/core/export";
import { createEmptyManual, type MarkdownChapter } from "../src/core/types";

function manualWithChapters() {
  const manual = createEmptyManual("テスト<マニュアル>");
  manual.subtitle = "統合版";
  manual.author = "作成者";
  manual.version = "1.0";
  manual.revisedOn = "2026-10-17";
  manual.coverNotes = ["目次をクリックすると移動できます"];
  manual.book = true;
  manual.autoNumberGroups = true;
  const md = (id: string, group: string): MarkdownChapter => ({ id, kind: "markdown", title: id, sourceName: `${id}.md`, markdown: `# ${id}`, group });
  manual.chapters = [md("a", "基本"), md("b", "基本"), md("c", "操作")];
  manual.images = [{ id: "i", name: "logo.png", dataUri: "data:image/png;base64,AAAA" }];
  manual.figures = [{ id: "f", name: "mark.svg", svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect width="2" height="2"></rect></svg>' }];
  return manual;
}

describe("renderCover", () => {
  it("既定デザインは帯・タイトル・作成者行・補足・収録内容を mm 座標で描く", () => {
    const manual = manualWithChapters();
    const html = renderCover(manual, undefined);
    expect(html).toContain('<section class="cover cover-page">');
    expect(html).toContain('class="cover-el cover-rect" style="left:15mm;top:16mm;width:180mm;height:70mm;background:#2b6cb0;border-radius:1mm"');
    expect(html).toContain("font-size:24pt;color:#ffffff;font-weight:700\">テスト&lt;マニュアル&gt;</div>");
    expect(html).toContain("作成：作成者　／　2026年10月17日　／　版 1.0");
    expect(html).toContain("<p>目次をクリックすると移動できます</p>");
    expect(html).toContain('<h3 class="cover-contents">収録内容（3本）</h3>');
    expect(html).toContain("<li>第1章 基本（2本）</li>\n<li>第2章 操作（1本）</li>");
    expect(html).not.toContain("data-el");
  });

  it("画像・テキスト・プレースホルダ・z 順・ページ背景を扱い、編集用には data-el を付ける", () => {
    const manual = manualWithChapters();
    const design: CoverDesign = {
      background: "#fff8e6",
      elements: [
        { id: "t", type: "text", x: 10, y: 20, w: 100, text: "{title}\n{count}本 / {groups}章", align: "center", z: 2 },
        { id: "img", type: "image", x: 150, y: 20, w: 40, h: 40, src: "images/LOGO.png", z: 1 },
        { id: "none", type: "image", x: 0, y: 0, src: "missing.png" },
        { id: "svg", type: "image", x: 0, y: 100, w: 30, src: "images/mark.svg" },
      ],
    };
    const html = renderCover(manual, design, { editable: true });
    expect(html).toContain('<section class="cover cover-page" style="background:#fff8e6" data-mb-cover="1">');
    const imgIndex = html.indexOf('data-el="img"');
    const textIndex = html.indexOf('data-el="t"');
    expect(imgIndex).toBeGreaterThan(-1);
    expect(textIndex).toBeGreaterThan(imgIndex); // z が大きい方が後ろ（手前）
    expect(html).toContain('<img src="data:image/png;base64,AAAA" alt="">');
    expect(html).toContain("テスト&lt;マニュアル&gt;<br>3本 / 2章");
    expect(html).toContain("text-align:center");
    expect(html).toContain("[画像がありません: missing.png]");
    expect(html).toContain('style="left:0mm;top:100mm;width:30mm" data-el="svg"><svg xmlns=');
  });

  it("expandPlaceholders は未知のキーをそのまま残す", () => {
    const manual = manualWithChapters();
    expect(expandPlaceholders("{title}/{unknown}/{date}", manual)).toBe("テスト<マニュアル>/{unknown}/2026年10月17日");
  });

  it("isCoverDesign / coverTemplate / newCoverElement", () => {
    const manual = manualWithChapters();
    expect(isCoverDesign(defaultCoverDesign(manual))).toBe(true);
    expect(isCoverDesign({ elements: [{ x: 1 }] })).toBe(false);
    expect(isCoverDesign(JSON.parse(coverTemplate(manual)))).toBe(true);
    expect(newCoverElement("image", "e1", "logo.png")).toMatchObject({ id: "e1", type: "image", src: "logo.png" });
    expect(newCoverElement("text", "e2").text).toBe("テキスト");
  });
});

describe("統合版の表紙", () => {
  it("manual.cover があればそれを、無ければ既定デザインを使う", () => {
    const manual = manualWithChapters();
    expect(buildManualHtml(manual, { css: "" }).html).toContain('class="cover-el cover-rect"');
    manual.cover = { elements: [{ id: "only", type: "text", x: 5, y: 5, text: "カスタム表紙 {title}" }] };
    const html = buildManualHtml(manual, { css: "" }).html;
    expect(html).toContain("カスタム表紙 テスト&lt;マニュアル&gt;");
    expect(html).not.toContain("cover-rect");
    expect(html).not.toContain("data-el");
  });

  it("buildCoverHtml は編集用の表紙だけを返す", () => {
    const manual = manualWithChapters();
    const { html, chapterHtml } = buildCoverHtml(manual, { css: "x{}" });
    expect(html).toContain('<body class="book">');
    expect(html).toContain('data-mb-cover="1"');
    expect(chapterHtml).toContain('data-el="title"');
    expect(html).not.toContain("<article");
  });
});
