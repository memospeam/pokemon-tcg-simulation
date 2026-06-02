/**
 * Thin Anthropic SDK wrapper for the LLM agent. Reads ANTHROPIC_API_KEY and
 * (optionally) LLM_AGENT_MODEL from the environment, applies prompt caching to
 * the static system block, and retries transient 429/529 errors.
 *
 * Exposes a `CompleteFn` shape so LlmPolicy can be unit-tested with a fake
 * completion function — no SDK / network needed in tests.
 */
import Anthropic from "@anthropic-ai/sdk";

/** A single decision call: static system prompt + per-turn user prompt → text. */
export type CompleteFn = (system: string, user: string) => Promise<string>;

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
 * every decision in a game.
 *
 * Throws synchronously if no API key is available — callers (LlmPolicy) should
 * decide whether to surface that or fall back to the heuristic.
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

export interface OpenAICompatibleOptions {
  /** Base URL ending in /v1 (e.g. http://localhost:11434/v1 for Ollama). */
  baseUrl: string;
  model: string;
  /** Optional bearer token. Ollama ignores it; cloud providers need it. */
  apiKey?: string;
  maxTokens?: number;
  retries?: number;
  /** Per-request timeout in ms (default 60000). Prevents a hung local model. */
  timeoutMs?: number;
}

/**
 * Build a CompleteFn for any OpenAI-compatible /chat/completions endpoint —
 * no SDK, just fetch. Works with:
 *   • Ollama (local, FREE, no key):  baseUrl http://localhost:11434/v1
 *   • Groq (free tier):              https://api.groq.com/openai/v1
 *   • Google Gemini (free tier):     https://generativelanguage.googleapis.com/v1beta/openai
 *   • OpenRouter, etc.
 *
 * This is the no-Anthropic-key path. The system prompt is sent as the first
 * `system` message (no provider-specific prompt caching).
 */
export function createOpenAICompatibleComplete(opts: OpenAICompatibleOptions): CompleteFn {
  const { baseUrl, model } = opts;
  if (!baseUrl) throw new Error("OpenAI-compatible client needs a baseUrl (e.g. http://localhost:11434/v1).");
  const apiKey = opts.apiKey;
  const maxTokens = opts.maxTokens ?? 256;
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 60000;
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  return async (system: string, user: string): Promise<string> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        });
        if (res.status === 429 || res.status === 503) {
          clearTimeout(timer);
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          continue;
        }
        if (!res.ok) {
          throw new Error(`LLM endpoint ${res.status}: ${(await res.text()).slice(0, 200)}`);
        }
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        clearTimeout(timer);
        return (data.choices?.[0]?.message?.content ?? "").trim();
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 500));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  };
}

/**
 * Pick a CompleteFn from environment, so the harness supports a free local
 * path without code changes:
 *   - LLM_PROVIDER=ollama          → http://localhost:11434/v1 (default model llama3.1)
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
