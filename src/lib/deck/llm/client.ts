/**
 * Browser-safe LLM client: a fetch-based OpenAI-compatible /chat/completions
 * caller. NO Node-only SDK imports, so this module is safe to bundle for the
 * browser (the "play vs LLM" UI path). The Anthropic SDK wrapper lives in the
 * Node-only clientAnthropic.ts.
 *
 * Exposes a `CompleteFn` shape so LlmPolicy can be unit-tested with a fake
 * completion function — no SDK / network needed in tests.
 */

/** A single decision call: static system prompt + per-turn user prompt → text. */
export type CompleteFn = (system: string, user: string) => Promise<string>;

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
