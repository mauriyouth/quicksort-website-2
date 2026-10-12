import { APICallError } from "ai";

export type AiFailure = { log: string; client: string };

/**
 * Turns a thrown provider/SDK error into a sanitized server log line plus an
 * actionable client message. Never includes CVs, prompts, tokens, or provider
 * request/response bodies — only the error class, HTTP status, and a short
 * provider message snippet.
 */
export function classifyAiFailure(
  failure: unknown,
  options: { model: string | null; fallback: string },
): AiFailure {
  const model = options.model ?? "unknown";
  const detail = (failure instanceof Error ? failure.message : String(failure))
    .replace(/\s+/g, " ")
    .slice(0, 300);
  if (failure instanceof APICallError) {
    const status = failure.statusCode ?? 0;
    const log = `${failure.name} status=${status} model=${model}: ${detail}`;
    if (status === 401 || status === 403) {
      return { log, client: "OpenAI rejected the saved API key. Update the key in Settings → AI configuration, then try again." };
    }
    if (status === 402) {
      return { log, client: "The OpenAI account is out of credits or billing is past due. Top up the account, then try again." };
    }
    if (status === 429) {
      return { log, client: "OpenAI rate-limited the request (plan limit or heavy usage). Wait a moment and try again." };
    }
    if (status === 408 || status === 504 || /\btimeout\b/i.test(detail)) {
      return { log, client: "The extraction took too long and was cut off. Try again, or paste the profile text instead." };
    }
    if (status === 400 && /input_file|pdf|file|image/i.test(detail)) {
      return {
        log,
        client: `The configured model${options.model ? ` (${options.model})` : ""} cannot read PDF files. Switch to a PDF-capable model such as gpt-4.1 or gpt-4o in Settings → AI configuration — or paste the profile text instead.`,
      };
    }
    return { log, client: options.fallback };
  }
  const name = failure instanceof Error ? failure.name : typeof failure;
  const log = `error=${name} model=${model}: ${detail}`;
  if (failure instanceof Error && /abort|timeout/i.test(failure.name)) {
    return { log, client: "The extraction timed out. Try again, or paste the profile text instead." };
  }
  return { log, client: options.fallback };
}
