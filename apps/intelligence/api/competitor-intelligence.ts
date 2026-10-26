type Request = { method?: string; headers: Record<string, string | string[] | undefined>; body: unknown };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): void };
export const config = { maxDuration: 120 };
export default async function handler(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string") return res.status(401).json({ error: "Sign in to research competitors." });
  try {
    const upstream = await fetch(`${process.env.ADMIN_INTERNAL_ORIGIN || "https://admin.quicksort.fr"}/api/business-competitor-intelligence`, { method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body: JSON.stringify(req.body), signal: AbortSignal.timeout(115000) });
    return res.status(upstream.status).json(await upstream.json());
  } catch { return res.status(502).json({ error: "The central intelligence service is unavailable. Try again shortly." }); }
}
