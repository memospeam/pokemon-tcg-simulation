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
