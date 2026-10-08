import { z } from "zod";

export const competitorRecordSchema = z.object({
  name: z.string().max(200), url: z.string().url().max(1000), location: z.string().max(200),
  summary: z.string().max(1200), positioning: z.string().max(900), audience: z.string().max(700),
  services: z.array(z.string().max(200)).max(12), differentiators: z.array(z.string().max(400)).max(10),
  threats: z.array(z.string().max(500)).max(8), opportunities: z.array(z.string().max(500)).max(8),
  evidence: z.array(z.object({ title: z.string().max(300), url: z.string().url().max(1000) })).max(20),
});

export const competitorResultSchema = z.object({ competitors: z.array(competitorRecordSchema).max(12), marketSummary: z.string().max(1800) });
export type CompetitorRecord = z.infer<typeof competitorRecordSchema> & { id: string; source: "Manual" | "Discovered"; analyzedAt: string };
export type CompetitorResult = z.infer<typeof competitorResultSchema>;
