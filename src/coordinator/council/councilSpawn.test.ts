import { describe, expect, test } from 'bun:test'
import {
  buildExecutorPrompt,
  buildRevisionPrompt,
  describeResultShape,
  ensureAbortController,
  ensureMainLoopModel,
  extractResultText,
  parseVerdict,
  synthesizeToolUseSummary,
} from './councilSpawn.js'
import type { Review, SynthesizedPlan } from './councilOrchestrator.js'
import type { ToolUseContext } from '../../Tool.js'

const plan: SynthesizedPlan = {
  text: 'use Map, add tests, throw on NaN',
  modelId: 'synthesizer',
  durationMs: 100,
  costUsd: 0.01,
}

describe('parseVerdict', () => {
  test('extracts block from "block — bracket-notation pollution slips guard"', () => {
    expect(
      parseVerdict('block — bracket-notation pollution keys slip the guard'),
    ).toBe('block')
  })

  test('extracts pass from "pass — clean separation"', () => {
    expect(parseVerdict('pass — clean separation, no surprises')).toBe('pass')
  })

  test('extracts concern from "concern — naming"', () => {
    expect(parseVerdict('concern — naming should be more explicit')).toBe(
      'concern',
    )
  })

  test('extracts nit from "nit — missing JSDoc"', () => {
    expect(parseVerdict('nit — missing JSDoc on the public function')).toBe(
      'nit',
    )
  })

  test('block beats concern when both appear', () => {
    // Block is the most serious verdict; if a model mentions both, the
    // block carries the day.
    expect(parseVerdict('block — also a minor concern about naming')).toBe(
      'block',
    )
  })

  test('falls back to concern when no verdict word is present', () => {
    expect(parseVerdict('I think this is fine')).toBe('concern')
  })

  test('case-insensitive', () => {
    expect(parseVerdict('BLOCK — caps are valid too')).toBe('block')
  })
})

describe('buildExecutorPrompt', () => {
  test('embeds the user request and the plan text', () => {
    const out = buildExecutorPrompt('add a /health endpoint', plan)
    expect(out).toContain('add a /health endpoint')
    expect(out).toContain(plan.text)
    expect(out).toMatch(/summarize|summary/i)
  })
})

describe('extractResultText', () => {
  test('pulls text from content[] of {type, text} blocks', () => {
    expect(
      extractResultText({
        content: [
          { type: 'text', text: '## Reasoning\nlooks fine' },
        ],
      }),
    ).toBe('## Reasoning\nlooks fine')
  })

  test('concatenates multiple text blocks with newlines', () => {
    expect(
      extractResultText({
        content: [
          { type: 'text', text: 'first' },
          { type: 'tool_use', name: 'Read', input: {} },
          { type: 'text', text: 'second' },
        ],
      }),
    ).toBe('first\nsecond')
  })

  test('falls back to flat text field', () => {
    expect(extractResultText({ text: 'flat answer' })).toBe('flat answer')
  })

  test('falls back to summary field', () => {
    expect(extractResultText({ summary: 'summary answer' })).toBe(
      'summary answer',
    )
  })

  test('returns empty string when nothing is text-shaped', () => {
    expect(
      extractResultText({
        content: [{ type: 'tool_use', name: 'Glob', input: {} }],
      }),
    ).toBe('')
  })
})

describe('synthesizeToolUseSummary', () => {
  test('produces a structured proposal when content has only tool_uses', () => {
    const out = synthesizeToolUseSummary({
      content: [
        { type: 'tool_use', name: 'Glob', input: {} },
        { type: 'tool_use', name: 'Read', input: {} },
        { type: 'tool_use', name: 'Glob', input: {} },
      ],
    })
    expect(out).toContain('## Reasoning')
    expect(out).toContain('## Proposal')
    expect(out).toContain('## Risks')
    expect(out).toContain('3 tool call(s)') // counts include duplicates
    expect(out).toContain('Glob, Read') // dedupes for naming
  })

  test('returns empty when there are no tool_uses', () => {
    expect(synthesizeToolUseSummary({ content: [] })).toBe('')
    expect(
      synthesizeToolUseSummary({
        content: [{ type: 'text', text: 'hi' }],
      }),
    ).toBe('')
  })
})

describe('describeResultShape', () => {
  test('summarises content block types', () => {
    expect(
      describeResultShape({
        status: 'completed',
        content: [
          { type: 'text' },
          { type: 'tool_use' },
          { type: 'tool_use' },
        ],
      }),
    ).toBe('{ status="completed", content=[text, tool_use, tool_use] }')
  })

  test('handles missing fields', () => {
    expect(describeResultShape({})).toBe('<empty>')
  })
})

describe('ensureAbortController', () => {
  const baseCtxWithAbort = (ac?: AbortController): ToolUseContext =>
    ({
      abortController: ac,
      options: { mainLoopModel: 'claude' },
    }) as unknown as ToolUseContext

  test('returns context unchanged when AbortController is present', () => {
    const ac = new AbortController()
    const ctx = baseCtxWithAbort(ac)
    const out = ensureAbortController(ctx, new AbortController().signal)
    expect(out).toBe(ctx)
    expect(out.abortController).toBe(ac)
  })

  test('fills a new AbortController when missing', () => {
    const ctx = baseCtxWithAbort(undefined)
    const out = ensureAbortController(ctx, new AbortController().signal)
    expect(out).not.toBe(ctx)
    expect(out.abortController).toBeInstanceOf(AbortController)
    expect(out.abortController.signal.aborted).toBe(false)
  })

  test('propagates parent abort to the new controller', () => {
    const ctx = baseCtxWithAbort(undefined)
    const parent = new AbortController()
    const out = ensureAbortController(ctx, parent.signal)

    expect(out.abortController.signal.aborted).toBe(false)
    parent.abort()
    expect(out.abortController.signal.aborted).toBe(true)
  })

  test('starts already-aborted if the parent was already aborted', () => {
    const ctx = baseCtxWithAbort(undefined)
    const parent = new AbortController()
    parent.abort()
    const out = ensureAbortController(ctx, parent.signal)
    expect(out.abortController.signal.aborted).toBe(true)
  })
})

describe('ensureMainLoopModel', () => {
  // Minimal context stub — just enough to exercise the patch path.
  // Real ToolUseContext has many other fields; the function only reads
  // and writes options.mainLoopModel.
  const baseCtx = (mainLoopModel?: unknown): ToolUseContext =>
    ({
      options: {
        mainLoopModel,
        commands: [],
        debug: false,
        tools: [],
        verbose: false,
        mcpClients: [],
        mcpResources: {},
        isNonInteractiveSession: false,
        agentDefinitions: { activeAgents: [], allAgents: [] },
        thinkingConfig: { type: 'disabled' },
      },
    }) as unknown as ToolUseContext

  test('returns the context unchanged when mainLoopModel is already set', () => {
    const ctx = baseCtx('claude-opus-4-7')
    const out = ensureMainLoopModel(ctx)
    expect(out).toBe(ctx) // reference equality — no clone needed
    expect(out.options.mainLoopModel).toBe('claude-opus-4-7')
  })

  test('fills mainLoopModel when undefined', () => {
    const ctx = baseCtx(undefined)
    const out = ensureMainLoopModel(ctx)
    expect(out).not.toBe(ctx) // cloned
    expect(typeof out.options.mainLoopModel).toBe('string')
    expect((out.options.mainLoopModel as string).length).toBeGreaterThan(0)
  })

  test('fills mainLoopModel when empty string', () => {
    const ctx = baseCtx('')
    const out = ensureMainLoopModel(ctx)
    expect((out.options.mainLoopModel as string).length).toBeGreaterThan(0)
  })

  test('does not mutate the input options', () => {
    const ctx = baseCtx(undefined)
    const before = ctx.options.mainLoopModel
    ensureMainLoopModel(ctx)
    expect(ctx.options.mainLoopModel).toBe(before) // input still undefined
  })
})

describe('buildRevisionPrompt', () => {
  test('includes the original request, plan, previous diff, and blocking concerns', () => {
    const reviews: Review[] = [
      {
        role: 'security',
        verdict: 'block',
        findings: ['prototype pollution via __proto__[x]'],
        modelId: 'mistral-large',
        durationMs: 100,
        costUsd: 0.02,
      },
      {
        role: 'critic',
        verdict: 'block',
        findings: ['missing JSDoc and Object.create(null) base'],
        modelId: 'gpt-4.1-mini',
        durationMs: 100,
        costUsd: 0.01,
      },
    ]

    const out = buildRevisionPrompt('add parser', plan, {
      previousDiff: 'modified src/utils/x.ts',
      blockingReviews: reviews,
    })

    expect(out).toContain('add parser')
    expect(out).toContain(plan.text)
    expect(out).toContain('modified src/utils/x.ts')
    expect(out).toContain('Security')
    expect(out).toContain('prototype pollution')
    expect(out).toContain('Critic')
    expect(out).toContain('Object.create(null)')
    expect(out).toMatch(/\(2\)/) // mentions count of 2 blocking concerns
  })

  test('explicitly tells the executor to make edits, not refuse', () => {
    const out = buildRevisionPrompt('x', plan, {
      previousDiff: 'd',
      blockingReviews: [
        {
          role: 'skeptic',
          verdict: 'block',
          findings: ['boom'],
          modelId: 'g',
          durationMs: 1,
          costUsd: 0,
        },
      ],
    })
    expect(out).toMatch(/Make explicit edits|do not skip|do not refuse/i)
  })
})
