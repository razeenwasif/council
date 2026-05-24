import { describe, expect, test } from 'bun:test'
import {
  CLASSIFIER_MODEL_DEFAULT,
  classify,
  decideLLM,
  normalizeClassifierOutput,
} from './llm.js'

// ──────────────────────────────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────────────────────────────

function makeFakeChatCompletionResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

const SETTINGS_WITH_GEMINI = {
  agentModels: {
    [CLASSIFIER_MODEL_DEFAULT]: {
      base_url: 'https://example.test/v1',
      api_key: 'fake-key',
    },
  },
} as const

const SETTINGS_WITH_CLASSIFIER_ROUTE = {
  agentModels: {
    'cheap-model-x': {
      base_url: 'https://custom.test/v1',
      api_key: 'custom-key',
    },
  },
  agentRouting: { classifier: 'cheap-model-x' },
} as const

// ──────────────────────────────────────────────────────────────────────
// normalizeClassifierOutput — the parsing layer
// ──────────────────────────────────────────────────────────────────────

describe('normalizeClassifierOutput', () => {
  test('accepts plain "solo" / "council"', () => {
    expect(normalizeClassifierOutput('solo')).toBe('solo')
    expect(normalizeClassifierOutput('council')).toBe('council')
  })

  test('tolerates capitalization', () => {
    expect(normalizeClassifierOutput('SOLO')).toBe('solo')
    expect(normalizeClassifierOutput('Council')).toBe('council')
  })

  test('strips quotes, asterisks, backticks', () => {
    expect(normalizeClassifierOutput('"solo"')).toBe('solo')
    expect(normalizeClassifierOutput('**council**')).toBe('council')
    expect(normalizeClassifierOutput('`solo`')).toBe('solo')
  })

  test('strips trailing punctuation / whitespace', () => {
    expect(normalizeClassifierOutput('solo.')).toBe('solo')
    expect(normalizeClassifierOutput('council!\n')).toBe('council')
    expect(normalizeClassifierOutput('  solo  ')).toBe('solo')
  })

  test('keeps the last meaningful token when the model preambles', () => {
    expect(normalizeClassifierOutput('decision: solo')).toBe('solo')
    expect(normalizeClassifierOutput('the answer is council')).toBe('council')
  })

  test('returns unparseable on garbage', () => {
    expect(normalizeClassifierOutput('maybe')).toBe('unparseable')
    expect(normalizeClassifierOutput('')).toBe('unparseable')
    expect(normalizeClassifierOutput('solo or council')).toBe('unparseable')
  })
})

// ──────────────────────────────────────────────────────────────────────
// classify — the API call layer
// ──────────────────────────────────────────────────────────────────────

describe('classify', () => {
  test('returns "unwired" when no settings are present', async () => {
    const result = await classify('whatever', { settings: {} })
    expect(result).toBe('unwired')
  })

  test('returns "unwired" when classifier model not configured', async () => {
    const result = await classify('whatever', {
      settings: { agentModels: { other: { base_url: 'x', api_key: 'y' } } },
    })
    expect(result).toBe('unwired')
  })

  test('returns the parsed classification on success', async () => {
    const fetcher = (async () => makeFakeChatCompletionResponse('council')) as typeof fetch
    const result = await classify('refactor the auth middleware', {
      fetcher,
      settings: SETTINGS_WITH_GEMINI,
    })
    expect(result).toBe('council')
  })

  test('calls the URL and headers derived from the settings profile', async () => {
    let seenUrl: string | undefined
    let seenAuth: string | undefined
    let seenBody: Record<string, unknown> | undefined

    const fetcher = (async (url: string, init?: RequestInit) => {
      seenUrl = url
      seenAuth = (init?.headers as Record<string, string>)?.Authorization
      seenBody = JSON.parse(init?.body as string)
      return makeFakeChatCompletionResponse('solo')
    }) as typeof fetch

    await classify('rename a var', { fetcher, settings: SETTINGS_WITH_GEMINI })

    expect(seenUrl).toBe('https://example.test/v1/chat/completions')
    expect(seenAuth).toBe('Bearer fake-key')
    expect(seenBody?.model).toBe(CLASSIFIER_MODEL_DEFAULT)
    expect(seenBody?.temperature).toBe(0)
    // Two messages — system + user.
    const messages = seenBody?.messages as Array<{ role: string; content: string }>
    expect(messages).toHaveLength(2)
    expect(messages[0]?.role).toBe('system')
    expect(messages[1]?.role).toBe('user')
    expect(messages[1]?.content).toBe('rename a var')
  })

  test('honors agentRouting.classifier override', async () => {
    let seenUrl: string | undefined
    let seenBody: Record<string, unknown> | undefined
    const fetcher = (async (url: string, init?: RequestInit) => {
      seenUrl = url
      seenBody = JSON.parse(init?.body as string)
      return makeFakeChatCompletionResponse('council')
    }) as typeof fetch

    await classify('x', {
      fetcher,
      settings: SETTINGS_WITH_CLASSIFIER_ROUTE,
    })

    expect(seenUrl).toBe('https://custom.test/v1/chat/completions')
    expect(seenBody?.model).toBe('cheap-model-x')
  })

  test('returns "unparseable" on non-2xx response', async () => {
    const fetcher = (async () =>
      new Response('rate limited', { status: 429 })) as typeof fetch
    const result = await classify('x', {
      fetcher,
      settings: SETTINGS_WITH_GEMINI,
    })
    expect(result).toBe('unparseable')
  })

  test('returns "unparseable" when the response body is shaped wrong', async () => {
    const fetcher = (async () =>
      new Response(JSON.stringify({ unexpected: 'shape' }), {
        status: 200,
      })) as typeof fetch
    const result = await classify('x', {
      fetcher,
      settings: SETTINGS_WITH_GEMINI,
    })
    expect(result).toBe('unparseable')
  })

  test('returns "unparseable" when the model says something off-script', async () => {
    const fetcher = (async () =>
      makeFakeChatCompletionResponse('I think probably solo but maybe council')) as typeof fetch
    const result = await classify('x', {
      fetcher,
      settings: SETTINGS_WITH_GEMINI,
    })
    expect(result).toBe('unparseable')
  })

  test('returns "unparseable" on fetcher throw (network error)', async () => {
    const fetcher = (async () => {
      throw new Error('ECONNREFUSED')
    }) as typeof fetch
    const result = await classify('x', {
      fetcher,
      settings: SETTINGS_WITH_GEMINI,
    })
    expect(result).toBe('unparseable')
  })

  test('aborts and returns "unparseable" when the call exceeds the timeout', async () => {
    let abortReceived = false
    const fetcher = (async (_url: string, init?: RequestInit) => {
      const signal = init?.signal
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener('abort', () => {
          abortReceived = true
          reject(new Error('aborted'))
        })
      })
    }) as typeof fetch

    const result = await classify('x', {
      fetcher,
      settings: SETTINGS_WITH_GEMINI,
      timeoutMs: 30,
    })

    expect(abortReceived).toBe(true)
    expect(result).toBe('unparseable')
  })
})

// ──────────────────────────────────────────────────────────────────────
// decideLLM — the strategy entry point with heuristic fallback
// ──────────────────────────────────────────────────────────────────────

describe('decideLLM', () => {
  test('routes solo when classifier says solo', async () => {
    const fetcher = (async () => makeFakeChatCompletionResponse('solo')) as typeof fetch
    const decision = await decideLLM('rename foo to bar', {
      fetcher,
      settings: SETTINGS_WITH_GEMINI,
    })
    expect(decision.route).toBe('solo')
    expect(decision.reason).toContain('solo')
    expect(decision.reason).toContain(CLASSIFIER_MODEL_DEFAULT)
  })

  test('routes council when classifier says council', async () => {
    const fetcher = (async () => makeFakeChatCompletionResponse('council')) as typeof fetch
    const decision = await decideLLM('refactor the entire auth subsystem', {
      fetcher,
      settings: SETTINGS_WITH_GEMINI,
    })
    expect(decision.route).toBe('council')
    expect(decision.reason).toContain('council')
  })

  test('falls back to heuristic when classifier is unwired', async () => {
    // No fetcher, no settings → unwired → heuristic. The heuristic
    // sends ≤6-word prompts solo.
    const decision = await decideLLM('rename foo', { settings: {} })
    expect(decision.route).toBe('solo') // heuristic catches this
    expect(decision.reason).toContain('fell back to heuristic')
  })

  test('falls back to heuristic on classifier API failure', async () => {
    const fetcher = (async () => {
      throw new Error('network down')
    }) as typeof fetch
    const decision = await decideLLM(
      'refactor everything to use a state machine',
      { fetcher, settings: SETTINGS_WITH_GEMINI },
    )
    // Substantial prompt → heuristic routes to council.
    expect(decision.route).toBe('council')
    expect(decision.reason).toContain('fell back to heuristic')
  })

  test('falls back to heuristic when classifier output is unparseable', async () => {
    const fetcher = (async () =>
      makeFakeChatCompletionResponse('maybe both')) as typeof fetch
    const decision = await decideLLM('rename foo to bar', {
      fetcher,
      settings: SETTINGS_WITH_GEMINI,
    })
    expect(decision.route).toBe('solo') // heuristic
    expect(decision.reason).toContain('unparseable')
    expect(decision.reason).toContain('fell back to heuristic')
  })
})
