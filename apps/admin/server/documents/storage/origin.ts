type HeaderBag = { headers: Record<string, string | string[] | undefined> };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || "";

/**
 * The origin of the browser that called the API — the one that will PUT bytes
 * to a storage upload URL. Browsers send `Origin` on POST; fall back to the
 * Referer, then the forwarded host.
 */
export function browserOrigin(req: HeaderBag): string | null {
  const origin = first(req.headers.origin);
  if (origin && origin !== "null") return origin;
  const referer = first(req.headers.referer);
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      /* ignore */
    }
  }
  const host = first(req.headers["x-forwarded-host"]) || first(req.headers.host);
  if (!host) return null;
  const proto = first(req.headers["x-forwarded-proto"]).split(",")[0] || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
