import { describe, expect, test } from 'bun:test'
import { homedir } from 'os'
import { parseDiscoverArgs } from './discover.js'

describe('parseDiscoverArgs', () => {
  test('extracts question + single --context', () => {
    const out = parseDiscoverArgs(
      'How does quantization affect SNR? --context /home/u/Research/lit-review.md',
    )
    expect(out.question).toBe('How does quantization affect SNR?')
    expect(out.contextFiles).toEqual(['/home/u/Research/lit-review.md'])
  })

  test('supports `--context=path` form', () => {
    const out = parseDiscoverArgs(
      'q --context=/abs/path.md',
    )
    expect(out.contextFiles).toEqual(['/abs/path.md'])
  })

  test('expands ~/ in --context paths', () => {
    const out = parseDiscoverArgs('q --context ~/Research/x.md')
    expect(out.contextFiles[0]).toBe(`${homedir()}/Research/x.md`)
  })

  test('multiple --context flags accumulate', () => {
    const out = parseDiscoverArgs(
      'q --context /a.md --context /b.md --context=/c.md',
    )
    expect(out.contextFiles).toEqual(['/a.md', '/b.md', '/c.md'])
  })

  test('--out captures absolute path', () => {
    const out = parseDiscoverArgs('q --out /tmp/brief.md')
    expect(out.outputPath).toBe('/tmp/brief.md')
  })

  test('--out=- means stdout-only (no file write)', () => {
    const out = parseDiscoverArgs('q --out -')
    expect(out.outputPath).toBe('stdout-only')
  })

  test('default output path lives under ~/Research/debates/', () => {
    const out = parseDiscoverArgs('q')
    expect(out.outputPath).toContain(`${homedir()}/Research/debates/`)
    expect(out.outputPath).toMatch(/\.md$/)
  })

  test('question accepts quoted multi-word spans', () => {
    const out = parseDiscoverArgs('"What is quantization-induced SNR loss?" --context /a.md')
    expect(out.question).toBe('What is quantization-induced SNR loss?')
  })

  test('throws on empty input', () => {
    expect(() => parseDiscoverArgs('')).toThrow(/Question is required/)
    expect(() => parseDiscoverArgs('   ')).toThrow(/Question is required/)
  })

  test('throws on --context without a path argument', () => {
    expect(() => parseDiscoverArgs('q --context')).toThrow(/--context requires a path/)
  })

  test('throws on --out without a path argument', () => {
    expect(() => parseDiscoverArgs('q --out')).toThrow(/--out requires a path/)
  })

  test('throws on unknown flag', () => {
    expect(() => parseDiscoverArgs('q --bogus value')).toThrow(/Unknown flag: --bogus/)
  })

  test('--help raises an error with name HelpRequestedError (handled by caller)', () => {
    expect(() => parseDiscoverArgs('--help')).toThrow()
    expect(() => parseDiscoverArgs('q --help')).toThrow()
  })

  test('flags can appear in any order after the question', () => {
    const out = parseDiscoverArgs(
      'q --out /tmp/a.md --context /b.md --context=/c.md',
    )
    expect(out.outputPath).toBe('/tmp/a.md')
    expect(out.contextFiles).toEqual(['/b.md', '/c.md'])
  })

  test('question stops at the first --', () => {
    const out = parseDiscoverArgs(
      'multi word question here --context /x.md',
    )
    expect(out.question).toBe('multi word question here')
  })
})
