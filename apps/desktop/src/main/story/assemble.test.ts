import { describe, expect, it } from "vitest";
import { calculateXfadeOffsets } from "./stages/assemble";

describe("story assemble helpers", () => {
  it("computes xfade offsets using adjusted segment durations", () => {
    expect(calculateXfadeOffsets([5, 7, 9], 1)).toEqual([5, 12]);
  });

  it("handles zero transition", () => {
    expect(calculateXfadeOffsets([2, 3, 4], 0)).toEqual([2, 5]);
  });
});
