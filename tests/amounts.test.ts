import { describe, expect, it } from "vitest";
import { fromBaseUnits, toBaseUnits } from "../src/lib/shared/amounts";

describe("amounts", () => {
  it("converts exactly without floats", () => {
    expect(toBaseUnits("5", 6)).toBe(5_000_000n);
    expect(toBaseUnits("0.000001", 6)).toBe(1n);
    expect(toBaseUnits("2.5", 6)).toBe(2_500_000n);
    expect(fromBaseUnits(15_000_000n, 6)).toBe("15");
    expect(fromBaseUnits(1n, 6)).toBe("0.000001");
  });
  it("rejects bad input", () => {
    expect(() => toBaseUnits("1.0000001", 6)).toThrow();
    expect(() => toBaseUnits("-1", 6)).toThrow();
    expect(() => toBaseUnits("1e3", 6)).toThrow();
  });
});
