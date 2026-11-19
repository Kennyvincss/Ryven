/** The token part of an Authorization header: "Bearer  abc " -> "abc" (case/spacing tolerant). Pure. */
export function bearerToken(header: string | null): string {
  const m = (header ?? "").trim().match(/^bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}
