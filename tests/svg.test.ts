import { describe, expect, it } from "vitest";
import { figureKey, sanitizeSvg } from "../src/core/svg";

const SIMPLE_SVG =
  '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

describe("sanitizeSvg", () => {
  it("XML 宣言を取り除き <svg> から始まる文字列を返す", () => {
    const clean = sanitizeSvg(SIMPLE_SVG, "a.svg");
    expect(clean.startsWith("<svg")).toBe(true);
    expect(clean).toContain("<rect");
    expect(clean).toContain('viewBox="0 0 10 10"');
  });

  it("script 要素と onload 属性を除去する", () => {
    const dirty =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" onload="alert(1)"><script>alert(1)</script><circle r="1"/></svg>';
    const clean = sanitizeSvg(dirty, "b.svg");
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("onload");
    expect(clean).toContain("<circle");
  });

  it("SVG でなければ例外を投げる", () => {
    expect(() => sanitizeSvg("<div>not svg</div>", "c.svg")).toThrow();
  });
});

describe("figureKey", () => {
  it("パスからファイル名だけを小文字で取り出す", () => {
    expect(figureKey("figures/Flow.SVG")).toBe("flow.svg");
    expect(figureKey("C:\\work\\図1.svg")).toBe("図1.svg");
  });

  it("URL エンコードとクエリを扱う", () => {
    expect(figureKey("img/%E5%9B%B3.svg?v=2")).toBe("図.svg");
  });
});
