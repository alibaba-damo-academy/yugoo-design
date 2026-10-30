import { useMemo } from 'react'

type SourceDiffLine = { kind: 'context' | 'removed' | 'added'; text: string }

/** Bounded Myers line diff. A large edit falls back to an exact replacement,
 * preserving every byte rather than truncating source or blocking the browser. */
function sourceDiffLines(before = '', after = ''): SourceDiffLine[] {
  const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const a = lines(before), b = lines(after)
  const trace: Map<number, number>[] = [], frontier = new Map<number, number>([[1, 0]])
  let work = 0
  for (let distance = 0; distance <= a.length + b.length; distance++) {
    trace.push(new Map(frontier))
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      if (++work > 20000) return [...a.map(text => ({ kind: 'removed' as const, text })), ...b.map(text => ({ kind: 'added' as const, text }))]
      let x = diagonal === -distance || (diagonal !== distance && (frontier.get(diagonal - 1) ?? -1) < (frontier.get(diagonal + 1) ?? -1))
        ? frontier.get(diagonal + 1) ?? 0 : (frontier.get(diagonal - 1) ?? 0) + 1
      let y = x - diagonal
      while (x < a.length && y < b.length && a[x] === b[y]) { x++; y++ }
      frontier.set(diagonal, x)
      if (x < a.length || y < b.length) continue
      const result: SourceDiffLine[] = []
      for (let d = trace.length - 1; d >= 0; d--) {
        const previous = trace[d]!, k = x - y
        const previousK = k === -d || (k !== d && (previous.get(k - 1) ?? -1) < (previous.get(k + 1) ?? -1)) ? k + 1 : k - 1
        const previousX = previous.get(previousK) ?? 0, previousY = previousX - previousK
        while (x > previousX && y > previousY) { result.push({ kind: 'context', text: a[--x]! }); y-- }
        if (d === 0) break
        if (x === previousX) result.push({ kind: 'added', text: b[--y]! })
        else result.push({ kind: 'removed', text: a[--x]! })
      }
      return result.reverse()
    }
  }
  return []
}


/** Same exact source diff in standalone and in-place working-copy views. */
export function SourceFileDiff({ path, before, after }: { path: string; before?: string; after?: string }) {
  const lines = useMemo(() => sourceDiffLines(before, after), [before, after])
  return <pre className="ygd-studio-inline-diff" aria-label={path}>{lines.map((line, index) => <span className="ygd-studio-diff-line" data-change={line.kind} key={index}>
    <span aria-hidden="true" className="ygd-studio-diff-sign">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</span><code>{line.text}</code>
  </span>)}</pre>
}
