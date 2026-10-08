import { z } from "zod";

export const eventIntelligenceRequest = z.object({
  event: z.object({ id: z.string().min(1).max(200), title: z.string().min(1).max(300) }),
  attendees: z.array(z.object({
    name: z.string().max(200), role: z.string().max(300), company: z.string().max(300),
    linkedin: z.string().max(500), email: z.string().max(320), custom: z.record(z.string(), z.string().max(1500)),
  })).min(1).max(300),
});

export const eventIntelligenceSchema = z.object({
  summary: z.string().max(1800),
  priorityPeople: z.array(z.object({
    name: z.string().max(200), company: z.string().max(300), role: z.string().max(300),
    category: z.enum(["Professional", "Founder", "Student", "Unknown"]),
    confidence: z.enum(["High", "Medium", "Low"]),
    fitScore: z.number().int().min(0).max(100), why: z.string().max(900),
    reachOut: z.string().max(900), seniorContact: z.string().max(500),
    linkedin: z.string().max(500), email: z.string().max(320), publicEvidence: z.string().max(900),
  })).max(30),
  organisations: z.array(z.object({
    name: z.string().max(300), attendeeCount: z.number().int().min(1),
    relevance: z.string().max(900), decisionMakerRoles: z.array(z.string().max(200)).max(8),
    nextStep: z.string().max(900),
  })).max(30),
  segments: z.array(z.object({ name: z.string().max(200), count: z.number().int().min(0), reason: z.string().max(600) })).max(12),
  recommendations: z.array(z.string().max(700)).max(12),
  researchSources: z.array(z.object({ title: z.string().max(300), url: z.string().url().max(1000) })).max(40),
});

export type EventAiIntelligence = z.infer<typeof eventIntelligenceSchema> & { model?: string; analyzedAt?: string; enrichmentProvider?: string };
