export function loadTregSettings() { return { token: process.env.TREG_TOKEN || "" }; }

export async function callTreg(token: string, endpoint: string, body: Record<string, unknown>, meta: string, maxCost = "0.10") {
  const response = await fetch(`https://treg.to/call/${endpoint}`, { method: "POST", headers: { "X-Treg-Token": token, "X-Treg-Meta": meta, "X-Treg-Route-Max-Cost": maxCost, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Treg request failed (${response.status}).`);
  return response.json() as Promise<Record<string, unknown>>;
}

type Attendee = { name: string; role: string; company: string; linkedin: string; email: string };
async function enrichOne(attendee: Attendee, token: string, eventId: string) {
  const identity = { ...(attendee.email ? { email: attendee.email } : {}), ...(attendee.linkedin ? { linkedin_url: attendee.linkedin } : {}), ...(attendee.name ? { full_name: attendee.name } : {}) };
  if (!Object.keys(identity).length) return null;
  const payload = await callTreg(token, "treg.people.enrich", identity, `workspace=business,event=${eventId}`);
  const output = payload.output && typeof payload.output === "object" ? payload.output : null;
  if (!output) return null;
  return { attendee: attendee.name, supplied: { role: attendee.role, company: attendee.company }, profile: output, provider: (payload._treg as Record<string, unknown> | undefined)?.served_by };
}

export async function enrichWithTreg(attendees: Attendee[], eventId: string) {
  const { token } = loadTregSettings();
  if (!token) throw new Error("Backend research is not configured.");
  const configuredLimit = Number(process.env.TREG_ENRICHMENT_LIMIT || 300);
  const limit = Number.isFinite(configuredLimit) ? Math.max(1, Math.min(300, configuredLimit)) : 300;
  const queue = attendees.filter((attendee) => attendee.name || attendee.email || attendee.linkedin).slice(0, limit);
  const profiles: unknown[] = [];
  for (let index = 0; index < queue.length; index += 12) {
    const batch = await Promise.all(queue.slice(index, index + 12).map((attendee) => enrichOne(attendee, token, eventId).catch(() => null)));
    profiles.push(...batch.filter(Boolean));
  }
  return { provider: "Backend research", profiles };
}
