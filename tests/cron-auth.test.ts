import { describe, expect, it } from "vitest";
import { bearerToken } from "../src/lib/server/bearer";

describe("cron Authorization header", () => {
  it("reads the secret after Bearer, tolerating case and stray whitespace", () => {
    expect(bearerToken("Bearer abc123")).toBe("abc123");
    expect(bearerToken("  bearer   abc123  \n")).toBe("abc123");
  });
  it("is empty when the secret is missing", () => {
    expect(bearerToken("Bearer")).toBe("");
    expect(bearerToken("Bearer   ")).toBe("");
    expect(bearerToken(null)).toBe("");
    expect(bearerToken("abc123")).toBe("");
  });
});
