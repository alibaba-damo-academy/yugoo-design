import type { DesignProjection } from './types.ts'

/** Browser-only baseline. Never a publication or a runtime save receipt. */
export function createPanelDemoSave() {
  const saved = new Map<string, { base: string; state: unknown }>()
  return {
    accept(source: DesignProjection | undefined, drafts: Record<string, unknown>, skills: readonly string[]) {
      for (const skill of skills) if (source?.[skill]) {
        saved.set(skill, { base: JSON.stringify(source[skill].state), state: drafts[skill] })
      }
    },
    project(source: DesignProjection | undefined): DesignProjection | undefined {
      if (!source || !saved.size) return source
      const result = { ...source }
      for (const [skill, value] of saved) {
        if (!source[skill] || JSON.stringify(source[skill].state) !== value.base) { saved.delete(skill); continue }
        result[skill] = { ...source[skill], state: value.state }
      }
      return result
    },
  }
}
