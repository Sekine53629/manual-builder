import { describe, expect, it } from "vitest";
import { extractTitle, normalizeStrong, parseFrontMatter, renderMarkdown, replaceChipLines, stripBom } from "../src/core/markdown";

describe("stripBom", () => {
  it("先頭の BOM を取り除く", () => {
    expect(stripBom("﻿# 見出し")).toBe("# 見出し");
  });

  it("BOM が無ければそのまま返す", () => {
    expect(stripBom("# 見出し")).toBe("# 見出し");
  });
});

describe("parseFrontMatter", () => {
  it("先頭の --- ブロックから key: value を取り出し、本文から除く", () => {
    const { frontMatter, body } = parseFrontMatter("---\ntitle: 題名\nsubtitle: 副題｜出典: X\n---\n\n## 本文");
    expect(frontMatter).toEqual({ title: "題名", subtitle: "副題｜出典: X" });
    expect(body).toBe("\n## 本文");
  });

  it("CRLF と BOM 付きでも動く", () => {
    const { frontMatter, body } = parseFrontMatter("﻿---\r\ntitle: 題名\r\n---\r\n本文");
    expect(frontMatter.title).toBe("題名");
    expect(body).toBe("本文");
  });

  it("front matter が無ければ空オブジェクトと本文そのまま", () => {
    expect(parseFrontMatter("# A\n---\nB")).toEqual({ frontMatter: {}, body: "# A\n---\nB", bodyLineOffset: 0 });
  });
});

describe("extractTitle", () => {
  it("front matter の title を最優先にする", () => {
    expect(extractTitle("---\ntitle: FM\n---\n# 見出し", "x")).toBe("FM");
  });

  it("最初の # 見出しをタイトルにする", () => {
    expect(extractTitle("前書き\n\n# はじめに\n\n## 概要", "fallback")).toBe("はじめに");
  });

  it("# 見出しが無ければ fallback を返す", () => {
    expect(extractTitle("## 小見出しだけ", "ファイル名")).toBe("ファイル名");
  });

  it("BOM 付きでも見出しを拾う", () => {
    expect(extractTitle("﻿# 操作手順", "x")).toBe("操作手順");
  });
});

describe("replaceChipLines", () => {
  it("[[chips:...]] だけの行をプレースホルダ div にする", () => {
    const out = replaceChipLines("a\n\n[[chips:m_tabs:F10, s:画面:F12]]\n\nb");
    expect(out).toBe('a\n\n<div data-chips="m_tabs%3AF10%2C%20s%3A%E7%94%BB%E9%9D%A2%3AF12"></div>\n\nb');
  });

  it("行の途中の [[chips]] は置き換えない", () => {
    expect(replaceChipLines("x [[chips:a]] y")).toBe("x [[chips:a]] y");
  });
});

describe("normalizeStrong", () => {
  it("約物の直後に閉じ ** が来ても強調にする", () => {
    expect(normalizeStrong("2. **不動品計算日は「6ヶ月前」**に設定する")).toBe("2. <strong>不動品計算日は「6ヶ月前」</strong>に設定する");
    expect(normalizeStrong("a **b** c **d**")).toBe("a <strong>b</strong> c <strong>d</strong>");
  });

  it("フェンスコードの中は触らない", () => {
    expect(normalizeStrong("```\n**x**\n```\n**y**")).toBe("```\n**x**\n```\n<strong>y</strong>");
  });

  it("空白に接する ** は強調にしない", () => {
    expect(normalizeStrong("** x **")).toBe("** x **");
  });
});

describe("renderMarkdown", () => {
  it("GFM の表を HTML に変換する", () => {
    const html = renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
  });

  it("script タグを除去する", () => {
    const html = renderMarkdown("本文 <script>alert(1)</script>");
    expect(html).not.toContain("<script");
    expect(html).toContain("本文");
  });

  it("改行を <br> にし、class 付き div を残す", () => {
    const html = renderMarkdown('1. 一行目\n   二行目\n\n<div class="meta">出典</div>');
    expect(html).toContain("一行目<br>二行目");
    expect(html).toContain('<div class="meta">出典</div>');
  });
});
