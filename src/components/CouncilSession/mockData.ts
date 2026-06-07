import type { SessionState } from './types.js'

/**
 * Phase A mock state — used by the preview script and any visual smoke
 * tests until Phase B wires the real orchestrator events. Mimics a council
 * mid-proposal: 4 voices done, 1 running, 2 pending; healthy elapsed +
 * non-zero cost.
 */
export const MOCK_COUNCIL_SESSION: SessionState = {
  prompt: 'rename the foo helper to bar across the codebase',
  kind: 'council',
  stage: 'proposal',
  focusedVoiceIndex: 3,
  voices: [
    {
      role: 'architect',
      model: 'claude-opus-4-7',
      status: 'done',
      headline: 'Use a codemod with explicit rename map',
      output:
        '## Headline\n' +
        '   Use a codemod with explicit rename map\n\n' +
        '## Position\n' +
        '   Define a one-shot codemod (ts-morph or jscodeshift) that\n' +
        '   walks all identifiers named `foo` and renames to `bar`,\n' +
        '   gated on scope. Manual edits risk drift across test files.\n',
    },
    {
      role: 'implementer',
      model: 'deepseek-chat',
      status: 'done',
      headline: 'Sed + tests pass',
      output:
        '## Headline\n   Sed + tests pass\n\n' +
        '## Position\n   For ~30 callsites, a global sed with a follow-up\n' +
        '   test pass is faster than setting up a codemod toolchain.\n',
    },
    {
      role: 'skeptic',
      model: 'gemini-3.5-flash',
      status: 'done',
      headline: 'Watch for cross-file string references',
      output:
        '## Headline\n   Watch for cross-file string references\n\n' +
        '## Position\n   `foo` may appear in template strings or comments\n' +
        '   that the codemod will miss. Need a follow-up grep pass.\n',
    },
    {
      role: 'critic',
      model: 'gpt-4.1-mini',
      status: 'running',
      headline: '',
      output:
        '## Headline\n' +
        '   Add a debounce wrapper around the keystroke handler\n\n' +
        '## Position\n' +
        '   Current keystroke handler invokes the rename worker on every\n' +
        '   keystroke, which could trip rate limits at scale. A 200ms\n' +
        '   debounce wrapper would coalesce events while preserving\n' +
        '   responsiveness for human typists. The wrapper should reset\n' +
        '   on focus change so paused edits do not stall the queue.\n\n' +
        '## Reasoning\n' +
        '   The existing handler is fire-and-forget — there is no\n' +
        '   batching layer between the keystroke event and the rename\n' +
        '   call. For solo use this is fine, but if multiple files are\n' +
        '   open at once the rename calls stack up and...',
    },
    { role: 'tester', model: 'qwen3.6-plus', status: 'pending', headline: '', output: '' },
    { role: 'security', model: 'mistral-large-latest', status: 'pending', headline: '', output: '' },
    { role: 'performance', model: 'mistral-medium-latest', status: 'pending', headline: '', output: '' },
  ],
  status: {
    costUsd: 0.18,
    totalTokens: 12_400,
    startMs: Date.now() - (7 * 60 + 22) * 1000, // 7m 22s ago
    totalAgents: 7,
    runningAgents: 1,
  },
}

export const MOCK_DISCOVER_SESSION: SessionState = {
  prompt: 'What is the strongest published result on GW detection sensitivity below 50 Hz?',
  kind: 'discover',
  stage: 'proposal',
  focusedVoiceIndex: 0,
  voices: [
    {
      role: 'hypothesizer',
      model: 'claude-opus-4-7',
      status: 'running',
      headline: '',
      output: '## Headline\n   [streaming...]\n',
    },
    { role: 'empiricist', model: 'gemini-3.5-flash', status: 'pending', headline: '', output: '' },
    { role: 'devils_advocate', model: 'mistral-large-latest', status: 'pending', headline: '', output: '' },
    { role: 'methodologist', model: 'qwen3.6-plus', status: 'pending', headline: '', output: '' },
  ],
  status: {
    costUsd: 0.04,
    totalTokens: 2_100,
    startMs: Date.now() - 90 * 1000, // 1m 30s ago
    totalAgents: 4,
    runningAgents: 1,
  },
}
