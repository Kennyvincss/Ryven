import { describe, expect, it } from "vitest";
import { RELAY_IMAGE_TYPES, allowedImageUrl, relayedImageSrc } from "../src/lib/shared/image-hosts";

describe("coin image relay allowlist", () => {
  it("allows coin-image hosts over https", () => {
    for (const u of [
      "https://static.datapi.jup.ag/token-icons/abc.webp",
      "https://ipfs.io/ipfs/QmXyz",
      "https://bafybeigdyrzt5.ipfs.dweb.link/",
      "https://pump.mypinata.cloud/ipfs/Qm1",
      "https://arweave.net/abc",
      "https://dd.dexscreener.com/ds-data/tokens/solana/x.png",
    ]) expect(allowedImageUrl(u)?.href).toBe(new URL(u).href);
  });

  it("refuses anything else", () => {
    for (const u of [
      "http://static.datapi.jup.ag/x.webp", // not https
      "https://static.datapi.jup.ag:8443/x.webp", // custom port
      "https://user:pw@ipfs.io/ipfs/Qm", // credentials
      "https://evil.com/x.png",
      "https://jup.ag.evil.com/x.png",
      "https://evilarweave.net/x",
      "https://localhost/x.png",
      "https://169.254.169.254/latest/meta-data",
      "file:///etc/passwd",
      "not a url",
      "",
      null,
    ]) expect(allowedImageUrl(u)).toBeNull();
  });

  it("builds relay URLs only for allowed images", () => {
    expect(relayedImageSrc("https://static.datapi.jup.ag/a b.webp")).toBe("/api/img?u=" + encodeURIComponent("https://static.datapi.jup.ag/a b.webp"));
    expect(relayedImageSrc("https://evil.com/x.png")).toBeNull();
  });

  it("passes raster images only (no SVG)", () => {
    for (const t of ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/avif"]) expect(RELAY_IMAGE_TYPES.test(t)).toBe(true);
    for (const t of ["image/svg+xml", "text/html", "application/octet-stream", ""]) expect(RELAY_IMAGE_TYPES.test(t)).toBe(false);
  });
});
