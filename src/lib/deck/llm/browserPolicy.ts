/**
 * Browser-side LLM policy factory for "play vs LLM" in the app.
 *
 * Uses the fetch-based OpenAI-compatible client (works in the browser) — NOT
 * the Node Anthropic SDK. Config comes from Vite env vars; defaults to a local
 * Ollama so no API key is exposed in the browser bundle:
 *
 *   VITE_LLM_BASE_URL  (default http://localhost:11434/v1)
 *   VITE_LLM_MODEL     (default llama3.2:3b)
 *   VITE_LLM_API_KEY   (optional — only for cloud providers like Groq)
 *
 * Note: Ollama must allow the dev origin (CORS). Recent Ollama allows
 * localhost origins by default; otherwise run `OLLAMA_ORIGINS=* ollama serve`.
 */
import { createOpenAICompatibleComplete } from "./client";
import { LlmPolicy } from "./llmPolicy";
import type { TurnPolicy } from "../policy";

export function createBrowserLlmPolicy(): TurnPolicy {
  const env = import.meta.env as Record<string, string | undefined>;
  const baseUrl = env.VITE_LLM_BASE_URL ?? "http://localhost:11434/v1";
  const model = env.VITE_LLM_MODEL ?? "llama3.2:3b";
  const apiKey = env.VITE_LLM_API_KEY || undefined;
  const complete = createOpenAICompatibleComplete({ baseUrl, model, apiKey, timeoutMs: 60000 });
  // Interactive play: effectively no call cap (one game, human-paced).
  return new LlmPolicy(complete, { maxCalls: 100000 });
}
