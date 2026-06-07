import { createContext, createElement, useContext, type ReactNode } from 'react'
import { useTerminalSize } from './useTerminalSize.js'

/**
 * `useEffectiveTerminalSize` — terminal-size that subtrees can override.
 *
 * Most components call `useTerminalSize()` and assume they own the full
 * terminal width. That assumption is correct for the regular REPL (it
 * IS the whole screen) and was the load-bearing reason Phase 3b's
 * side-pane broke chat word-wrap: shrinking the available width via flex
 * didn't change what `useTerminalSize()` reported, so word-wrap still
 * targeted the full terminal and rows overflowed into the side pane.
 *
 * Phase C of `COUNCIL_MODE_REDESIGN.md` puts chat content inside a flex
 * pane that's narrower than the terminal. We need a way to tell
 * descendants of that pane "your effective width is N cols, not the
 * terminal's M cols" without:
 *
 *  - monkey-patching `useTerminalSize` (would affect the entire render
 *    tree, breaking components outside the pane)
 *  - refactoring every component that reads terminal width to take an
 *    explicit prop (sprawling, invasive across dozens of files)
 *
 * Solution: a React context that, when present, overrides what this
 * hook returns. When absent (the default), this hook falls through to
 * the real `useTerminalSize`. Components opt into the override by
 * calling `useEffectiveTerminalSize` instead of `useTerminalSize`.
 *
 * Migration policy: do NOT replace `useTerminalSize` calls wholesale.
 * Components that legitimately need the real terminal size (the screen
 * root, anything painting backgrounds across the whole viewport)
 * should keep using `useTerminalSize`. Only switch the hook for
 * components inside a flex-allocated sub-pane that need to wrap to
 * that pane's width — `Messages`, `Markdown`, `Spinner`, anything that
 * computes text-wrap or column-clamped layout.
 *
 * Usage:
 *
 *   // At the parent that knows the constrained width:
 *   <EffectiveTerminalSizeProvider columns={40} rows={30}>
 *     <Messages ... />
 *   </EffectiveTerminalSizeProvider>
 *
 *   // Inside Messages and below, switch:
 *   const { columns } = useEffectiveTerminalSize()
 *   // columns === 40, not whatever useTerminalSize() reports
 */

export interface EffectiveTerminalSize {
  columns: number
  rows: number
}

const Ctx = createContext<EffectiveTerminalSize | null>(null)

/**
 * Returns the effective terminal size — the context value when a
 * provider is in scope, otherwise the real terminal size.
 *
 * Always called unconditionally at the top of a component (React
 * rules-of-hooks). The `useTerminalSize()` call is unconditional so
 * it's safe inside a `useEffectiveTerminalSize` call regardless of
 * whether a provider is present.
 */
export function useEffectiveTerminalSize(): EffectiveTerminalSize {
  const realSize = useTerminalSize()
  const override = useContext(Ctx)
  return override ?? { columns: realSize.columns, rows: realSize.rows }
}

export interface EffectiveTerminalSizeProviderProps {
  columns: number
  /** Optional row override. Defaults to the real terminal's row count
   *  via the consumer's own `useTerminalSize` calls; subtrees that only
   *  care about columns can leave this unset. */
  rows?: number
  children: ReactNode
}

/**
 * Wraps a subtree so descendants calling `useEffectiveTerminalSize`
 * get the supplied columns (and rows if provided) instead of the real
 * terminal's. Renders a fragment-equivalent — does NOT introduce any
 * layout chrome of its own.
 */
export function EffectiveTerminalSizeProvider({
  columns,
  rows,
  children,
}: EffectiveTerminalSizeProviderProps): ReactNode {
  // We use the real rows when not overridden — pulls from the same
  // source the rest of the tree would have used anyway. Done via a
  // separate render-time call rather than reading from a sibling
  // provider for simplicity.
  const real = useTerminalSize()
  const value: EffectiveTerminalSize = {
    columns,
    rows: rows ?? real.rows,
  }
  return createElement(Ctx.Provider, { value }, children)
}

/** Test-only escape hatch for asserting against the underlying context. */
export const __TEST_ONLY_EffectiveTerminalSizeContext = Ctx
