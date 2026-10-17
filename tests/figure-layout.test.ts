import { describe, expect, it } from "vitest";
import {
  figureStyle,
  moveImageAttrsToHash,
  parseFigureAttrs,
  rewriteImageAttrs,
  serializeFigureAttrs,
  splitFigureSrc,
} from "../src/core/figure-layout";
import { renderChapter } from "../src/core/manual";
import { createEmptyManual, type MarkdownChapter } from "../src/core/types";

describe("figure-layout（図の配置属性）", () => {
  it("属性を解析し、既定値を省いて書き戻す", () => {
    const layout = parseFigureAttrs("w=80 mt=6.26 ml=10 p=3 align=left mb=0 junk x=1");
    expect(layout).toEqual({ w: "80mm", mt: 6.5, ml: 10, p: 3, align: "left", mb: 0 });
    expect(serializeFigureAttrs(layout)).toBe("w=80 mt=6.5 ml=10 p=3 align=left");
    expect(parseFigureAttrs("w=50% align=right")).toEqual({ w: "50%", align: "right" });
    expect(serializeFigureAttrs({ align: "center" })).toBe("");
  });

  it("画像記法の {…} をハッシュへ移し、フェンスコードは触らない", () => {
    const md = "![図](figures/flow.svg){w=80 mt=6}\n```\n![x](a.svg){w=1}\n```\n![b](b.png){bogus}";
    const out = moveImageAttrsToHash(md);
    expect(out).toContain("![図](figures/flow.svg#mb:w%3D80%3Bmt%3D6)");
    expect(out).toContain("```\n![x](a.svg){w=1}\n```");
    expect(out).toContain("![b](b.png)\n".trimEnd());
    expect(out).not.toContain("{bogus}");
  });

  it("src のハッシュからパスと配置を取り出す", () => {
    expect(splitFigureSrc("figures/flow.svg#mb:w%3D80%3Bmt%3D6")).toEqual({ path: "figures/flow.svg", layout: { w: "80mm", mt: 6 } });
    expect(splitFigureSrc("a.svg#section")).toEqual({ path: "a.svg", layout: {} });
    expect(splitFigureSrc("a.svg")).toEqual({ path: "a.svg", layout: {} });
  });

  it("inline style を組み立てる", () => {
    expect(figureStyle({ w: "80mm", mt: 6, p: 3 })).toBe("width:80mm;margin-top:6mm;padding:3mm;margin-left:auto;margin-right:auto");
    expect(figureStyle({ align: "left", ml: 10 })).toBe("margin-left:10mm;margin-right:auto");
    expect(figureStyle({ align: "right" })).toBe("margin-left:auto;margin-right:0");
    expect(figureStyle({})).toBe("");
  });

  it("Markdown の行の中で、一致する画像だけ属性を書き換える", () => {
    const line = "本文 ![a](x/a.svg){w=10} と ![b](B.PNG) です";
    expect(rewriteImageAttrs(line, "b.png", { w: "60mm", align: "left" })).toBe("本文 ![a](x/a.svg){w=10} と ![b](B.PNG){w=60 align=left} です");
    expect(rewriteImageAttrs(line, "a.svg", {})).toBe("本文 ![a](x/a.svg) と ![b](B.PNG) です");
    expect(rewriteImageAttrs(line, "none.svg", { w: "1mm" })).toBe(line);
  });
});

describe("renderChapter と図の配置", () => {
  it("SVG と PNG の図に style と編集用の data-fig を付ける", () => {
    const manual = createEmptyManual("m");
    manual.figures = [{ id: "f", name: "flow.svg", svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect/></svg>' }];
    manual.images = [{ id: "i", name: "shot.png", dataUri: "data:image/png;base64,AAAA" }];
    const chapter: MarkdownChapter = {
      id: "c",
      kind: "markdown",
      title: "t",
      sourceName: "t.md",
      group: "",
      markdown: "# t\n\n![流れ](figures/flow.svg){w=80 mt=6 align=left ml=5}\n\n![画面](shot.png){p=2}",
    };
    const edit = renderChapter(chapter, manual, 1, { sourceMap: true });
    expect(edit.html).toContain('<figure class="manual-figure" style="width:80mm;margin-top:6mm;margin-left:5mm;margin-right:auto" data-fig="flow.svg" data-fig-layout="w=80 mt=6 ml=5 align=left"><svg');
    expect(edit.html).toContain("<figcaption>流れ</figcaption>");
    expect(edit.html).toContain('<figure class="manual-figure" style="padding:2mm" data-fig="shot.png" data-fig-layout="p=2"><img src="data:image/png;base64,AAAA" alt=""><figcaption>画面</figcaption></figure>');
    expect(edit.warnings).toEqual([]);
    const out = renderChapter(chapter, manual, 1);
    expect(out.html).toContain('style="padding:2mm"');
    expect(out.html).not.toContain("data-fig");
  });
});
