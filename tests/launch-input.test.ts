import { describe, expect, it } from "vitest";
import { z } from "zod";
import { nameField, normalizeSocial, socialField, symbolField } from "../src/lib/server/launch-input";

describe("launch form input", () => {
  it("turns what people type into proper links", () => {
    expect(normalizeSocial("twitter", "@yourcoin")).toBe("https://x.com/yourcoin");
    expect(normalizeSocial("telegram", "@yourcoin")).toBe("https://t.me/yourcoin");
    expect(normalizeSocial("twitter", "x.com/yourcoin")).toBe("https://x.com/yourcoin");
    expect(normalizeSocial("website", "yourcoin.com")).toBe("https://yourcoin.com");
    expect(normalizeSocial("website", "https://yourcoin.com/a")).toBe("https://yourcoin.com/a");
    expect(normalizeSocial("website", "  ")).toBe("");
    expect(normalizeSocial("website", undefined)).toBe("");
  });
  it("accepts typical inputs and rejects junk with a field-specific message", () => {
    const Body = z.object({ website: socialField("website"), twitter: socialField("twitter"), telegram: socialField("telegram") });
    expect(Body.parse({ website: "yourcoin.com", twitter: "@coin", telegram: "" })).toEqual({ website: "https://yourcoin.com", twitter: "https://x.com/coin", telegram: "" });
    expect(Body.parse({})).toEqual({ website: "", twitter: "", telegram: "" });
    const bad = Body.safeParse({ website: "not a link" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0].message).toMatch(/^Website: enter a link/);
  });
  it("symbols: emoji and $ are fine, spaces are not; names are required", () => {
    expect(symbolField(10).parse(" $DOGE ")).toBe("$DOGE");
    expect(symbolField(10).parse("🐸PEPE")).toBe("🐸PEPE");
    expect(symbolField(10).safeParse("TWO WORDS").error?.issues[0].message).toBe("Symbol can't contain spaces");
    expect(symbolField(10).safeParse("WAYTOOLONGSYMBOL").error?.issues[0].message).toMatch(/at most 10/);
    expect(nameField.safeParse("  ").error?.issues[0].message).toBe("Name is required");
  });
});
