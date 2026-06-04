/**
 * Node-only LLM client: the Anthropic SDK wrapper + env-driven provider
 * selection. This module imports @anthropic-ai/sdk (which pulls node:crypto),
 * so it must NEVER be imported from browser code — the browser uses
 * client.ts (fetch-based) via browserPolicy.ts instead.
 *
 * Used by the CLI harness (scripts/llmPlaytest.ts).
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  createOpenAICompatibleComplete,
  type CompleteFn,
} from "./client";

const DEFAULT_MODEL = "claude-sonnet-4-5";

export interface AnthropicClientOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  /** Retry attempts on 429/529. */
  retries?: number;
}

/**
 * Build a CompleteFn backed by the Anthropic API. The `system` text is sent as
 * a cached system block (5-minute TTL) so the static rules aren't re-billed on
 * every decision in a game. Throws if no API key is available.
 */
export function createAnthropicComplete(opts: AnthropicClientOptions = {}): CompleteFn {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set — cannot create LLM client.");
  }
  const model = opts.model ?? process.env.LLM_AGENT_MODEL ?? DEFAULT_MODEL;
  const maxTokens = opts.maxTokens ?? 256;
  const retries = opts.retries ?? 3;
  const client = new Anthropic({ apiKey });

  return async (system: string, user: string): Promise<string> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const res = await client.messages.create({
          model,
          max_tokens: maxTokens,
          system: [
            { type: "text", text: system, cache_control: { type: "ephemeral" } },
          ],
          messages: [{ role: "user", content: user }],
        });
        return res.content
          .map((block) => (block.type === "text" ? block.text : ""))
          .join("")
          .trim();
      } catch (err) {
        lastErr = err;
        const status = (err as { status?: number })?.status;
        if (status === 429 || status === 529) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  };
}

/**
 * Pick a CompleteFn from environment (CLI harness):
 *   - LLM_PROVIDER=ollama          → http://localhost:11434/v1 (default llama3.1)
 *   - LLM_PROVIDER=openai-compatible + LLM_BASE_URL [+ LLM_API_KEY]
 *   - LLM_PROVIDER=anthropic (default) → ANTHROPIC_API_KEY
 * LLM_AGENT_MODEL overrides the model in every case.
 */
export function createCompleteFromEnv(): CompleteFn {
  const provider = (process.env.LLM_PROVIDER ?? "anthropic").toLowerCase();
  const model = process.env.LLM_AGENT_MODEL;
  if (provider === "ollama") {
    return createOpenAICompatibleComplete({
      baseUrl: process.env.LLM_BASE_URL ?? "http://localhost:11434/v1",
      model: model ?? "llama3.1",
    });
  }
  if (provider === "openai-compatible") {
    const baseUrl = process.env.LLM_BASE_URL;
    if (!baseUrl) throw new Error("LLM_PROVIDER=openai-compatible requires LLM_BASE_URL.");
    return createOpenAICompatibleComplete({
      baseUrl,
      model: model ?? "gpt-4o-mini",
      apiKey: process.env.LLM_API_KEY,
    });
  }
  return createAnthropicComplete({ model });
}
