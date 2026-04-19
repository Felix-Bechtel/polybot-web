// Browser-direct Anthropic Messages API client.
// Requires the "anthropic-dangerous-direct-browser-access: true" header.
// Storage: API key lives in localStorage on the user's device only.

const KEY_STORAGE = "polybot.anthropic.key";

export function getClaudeKey(): string | null {
  return localStorage.getItem(KEY_STORAGE);
}
export function setClaudeKey(v: string): void {
  localStorage.setItem(KEY_STORAGE, v.trim());
}
export function clearClaudeKey(): void {
  localStorage.removeItem(KEY_STORAGE);
}

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ClaudeReply {
  text: string;
  stopReason?: string;
  usage?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
}

/** Call Claude. Throws on missing key, network, or non-2xx response. */
export async function askClaude(
  system: string,
  messages: ClaudeMessage[],
  opts?: { model?: string; maxTokens?: number; signal?: AbortSignal; kind?: "chat" | "alert-enrich" },
): Promise<ClaudeReply> {
  const key = getClaudeKey();
  if (!key) throw new Error("Missing Claude API key. Add it in Settings.");
  const model = opts?.model ?? "claude-opus-4-7";
  const body = {
    model,
    max_tokens: opts?.maxTokens ?? 400,
    system,
    messages,
  };
  // Naive client-side retry on 429 / 5xx, up to 3 attempts.
  let attempt = 0;
  while (true) {
    attempt++;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: opts?.signal,
    });
    if (res.ok) {
      const data = await res.json() as {
        stop_reason?: string;
        content?: Array<{ type: string; text?: string }>;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
      };
      const text = (data.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      const usage = {
        input: data.usage?.input_tokens ?? 0,
        output: data.usage?.output_tokens ?? 0,
        cacheRead: data.usage?.cache_read_input_tokens,
        cacheWrite: data.usage?.cache_creation_input_tokens,
      };
      // Persist to local usage tracker (5h rolling window in Settings).
      try {
        const { recordUsage } = await import("./usage");
        recordUsage({
          kind: opts?.kind ?? "chat",
          input: usage.input,
          output: usage.output,
          cacheRead: usage.cacheRead,
          cacheWrite: usage.cacheWrite,
          model,
        });
      } catch { /* usage tracking is best-effort */ }
      return { text, stopReason: data.stop_reason, usage };
    }
    if ((res.status === 429 || res.status >= 500) && attempt <= 3) {
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
      continue;
    }
    const text = await res.text();
    throw new Error(`Claude HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
}
