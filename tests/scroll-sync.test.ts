import { describe, expect, it } from "vitest";
import { interpolate, type Segment } from "../src/scroll-sync";

const SEGMENTS: Segment[] = [
  { line: 1, pos: 0 },
  { line: 11, pos: 100 },
  { line: 21, pos: 400 },
];

describe("interpolate（スクロール同期の線形補間）", () => {
  it("対応点の間を線形に補間する", () => {
    expect(interpolate(SEGMENTS, 6, "line")).toBe(50);
    expect(interpolate(SEGMENTS, 16, "line")).toBe(250);
    expect(interpolate(SEGMENTS, 250, "pos")).toBe(16);
  });

  it("対応点そのものはそのまま返す", () => {
    expect(interpolate(SEGMENTS, 11, "line")).toBe(100);
    expect(interpolate(SEGMENTS, 400, "pos")).toBe(21);
  });

  it("範囲外は端の勾配で外挿する", () => {
    expect(interpolate(SEGMENTS, 31, "line")).toBe(700);
    expect(interpolate(SEGMENTS, -4, "line")).toBe(-50);
  });

  it("対応点が 1 つ以下でも落ちない", () => {
    expect(interpolate([], 5, "line")).toBe(0);
    expect(interpolate([{ line: 3, pos: 30 }], 10, "line")).toBe(30);
  });
});
