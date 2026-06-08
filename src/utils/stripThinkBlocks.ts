/**
 * Strip `<think>...</think>` chain-of-thought blocks from model output.
 *
 * Why this exists: DeepSeek-R1 distills + Qwen 3 family emit explicit
 * `<think>...</think>` blocks before their final answer. These blocks
 * contain valuable reasoning but should NOT appear in:
 *   - The synthesist's input (it would try to summarize scratch work)
 *   - The brief's voice-position appendix (bloats the artifact)
 *   - The agent-thoughts pane (the user wants to scan conclusions, not CoT)
 *   - The telemetry record's voice output preview (waste of the 500-char budget)
 *
 * Position-text strip happens once at orchestrator level (debateSpawn /
 * councilSpawn return paths), so the downstream consumers — emit
 * voice-output event, synthesist input, brief appendix, telemetry —
 * all see clean text by construction.
 *
 * Edge cases:
 *   - No `<think>` tag at all: return as-is (fast path).
 *   - Multiple closed blocks: stripped (regex `/g` flag).
 *   - Unclosed `<think>` (model hit max_tokens mid-CoT, no `</think>`):
 *     drop everything from `<think>` to end. The voice's actual
 *     answer never landed, so the cleaned output is essentially
 *     empty — which is the correct signal: this voice failed to
 *     produce a final position. Better than leaking CoT.
 *
 * BACKLOG P2 follow-ups:
 *   - Optionally capture the stripped thinking into a `voice.thinking`
 *     side-channel so the trace is archived for thesis analysis.
 *   - Add streaming variant (state machine over chunks) if a future
 *     code path needs to strip during streaming, not just at completion.
 */
export function stripThinkBlocks(text: string): string {
  if (!text || text.indexOf('<think>') === -1) return text
  // Closed blocks: <think>...</think>
  let result = text.replace(/<think>[\s\S]*?<\/think>\n?/g, '')
  // Unclosed block at the tail: <think>... (no closing tag, truncated output)
  result = result.replace(/<think>[\s\S]*$/, '')
  return result.trim()
}
