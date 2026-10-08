export const capabilityVerticals = [
  { id: "ai_for_business", name: "AI for Business", description: "Applied AI solutions that improve business operations, decisions and growth." },
  { id: "infrastructure_for_ai", name: "Infrastructure for AI", description: "Secure, scalable cloud, on-premise and model-serving infrastructure." },
  { id: "data_for_ai", name: "Data for AI", description: "Data pipelines, preparation, governance and knowledge systems for AI." },
  { id: "voice_ai", name: "Voice AI", description: "Production voice agents and conversational systems that listen, understand and act." },
] as const;

export type CapabilityVerticalId = (typeof capabilityVerticals)[number]["id"];

export function capabilityName(id: string) {
  return capabilityVerticals.find((vertical) => vertical.id === id)?.name ?? id;
}
