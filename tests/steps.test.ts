import { describe, expect, it } from "vitest";
import { renderStepsHtml, stepsSubtitle } from "../src/core/steps";
import { renderChapter } from "../src/core/manual";
import { createEmptyManual, isStepsData, type StepsChapter } from "../src/core/types";
import { SAMPLE_CATALOG, SAMPLE_IMAGES, SAMPLE_STEPS } from "./fixtures";

describe("renderStepsHtml", () => {
  it("タイトル・使う場面・注意・番号付き手順・チップを出力し、notes は出力しない", () => {
    const { html, warnings } = renderStepsHtml(SAMPLE_STEPS, { catalog: SAMPLE_CATALOG, images: SAMPLE_IMAGES });
    expect(html).toContain("<h1>廃棄登録</h1>");
    expect(html).toContain('<p class="sub">原本：廃棄登録.pdf</p>');
    expect(html).toContain('<div class="callout use"><b>使う場面：</b>破損などで医薬品を廃棄したときの手順。</div>');
    expect(html).toContain('<div class="callout caution"><div class="callout-title">注意</div><ul><li>期限欄は消してから登録する</li></ul></div>');
    expect(html).toContain("<h2>手順</h2>");
    expect(html).toContain('<li class="step"><span class="step-no">1</span><div class="step-body"><p class="step-text">在庫メニューを開く</p><div class="chips">');
    expect(html).toContain('<p class="step-text"><strong>F12 登録</strong>を押す</p>');
    expect(html).toContain('<figure class="shot"><img src="shot1.png" alt=""></figure>');
    expect(html).toContain('<span class="step-no">3</span><div class="step-body"><p class="step-text">完了</p></div>');
    expect(html).not.toContain("内部メモ");
    expect(warnings).toEqual(["手順 1: m_option1:F1 の絵柄画像が取り込まれていません"]);
  });

  it("sub があれば source より優先する", () => {
    expect(stepsSubtitle({ title: "t", steps: [], sub: "S", source: "X" })).toBe("S");
    expect(stepsSubtitle({ title: "t", steps: [], source: "X" })).toBe("原本：X");
    expect(stepsSubtitle({ title: "t", steps: [] })).toBe("");
  });

  it("isStepsData は title と steps を持つものだけ真", () => {
    expect(isStepsData(SAMPLE_STEPS)).toBe(true);
    expect(isStepsData({ menus: [], screens: [] })).toBe(false);
  });
});

describe("renderChapter（steps）", () => {
  it("手順の画像を data URI に差し替え、見出し ID を付ける", () => {
    const manual = createEmptyManual("m");
    manual.catalog = SAMPLE_CATALOG;
    manual.images = [...SAMPLE_IMAGES, { id: "i2", name: "shot1.png", dataUri: "data:image/png;base64,CCCC" }];
    const chapter: StepsChapter = { id: "s1", kind: "steps", title: SAMPLE_STEPS.title, sourceName: "haiki.json", group: "", data: SAMPLE_STEPS };
    const result = renderChapter(chapter, manual, 2);
    expect(result.html).toContain('<h1 id="c2-1">廃棄登録</h1>');
    expect(result.html).toContain('<h2 id="c2-2">手順</h2>');
    expect(result.html).toContain('<img src="data:image/png;base64,CCCC" alt="">');
    expect(result.toc).toEqual([
      { level: 1, id: "c2-1", text: "廃棄登録" },
      { level: 2, id: "c2-2", text: "手順" },
    ]);
  });
});
