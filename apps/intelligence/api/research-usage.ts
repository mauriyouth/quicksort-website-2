type Request = { method?: string; headers: Record<string, string | string[] | undefined> };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): void };
export default async function handler(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Use GET." });
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return res.status(401).json({ error: "Sign in to view usage." });
  try {
    const response = await fetch(`${process.env.ADMIN_INTERNAL_ORIGIN || "https://admin.quicksort.fr"}/api/business-research-usage`, { headers: { Authorization: authorization }, signal: AbortSignal.timeout(25000) });
    return res.status(response.status).json(await response.json());
  } catch { return res.status(502).json({ error: "Research usage is temporarily unavailable." }); }
}
