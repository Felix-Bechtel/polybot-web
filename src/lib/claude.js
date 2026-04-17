// Browser-direct Anthropic Messages API client.
// Requires the "anthropic-dangerous-direct-browser-access: true" header.
// Storage: API key lives in localStorage on the user's device only.
const KEY_STORAGE = "polybot.anthropic.key";
export function getClaudeKey() {
    return localStorage.getItem(KEY_STORAGE);
}
export function setClaudeKey(v) {
    localStorage.setItem(KEY_STORAGE, v.trim());
}
export function clearClaudeKey() {
    localStorage.removeItem(KEY_STORAGE);
}
/** Call Claude. Throws on missing key, network, or non-2xx response. */
export async function askClaude(system, messages, opts) {
    const key = getClaudeKey();
    if (!key)
        throw new Error("Missing Claude API key. Add it in Settings.");
    const model = opts?.model ?? "claude-haiku-4-5";
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
            const data = await res.json();
            const text = (data.content ?? [])
                .filter((b) => b.type === "text")
                .map((b) => b.text ?? "")
                .join("");
            return { text, stopReason: data.stop_reason };
        }
        if ((res.status === 429 || res.status >= 500) && attempt <= 3) {
            await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
            continue;
        }
        const text = await res.text();
        throw new Error(`Claude HTTP ${res.status}: ${text.slice(0, 240)}`);
    }
}
