/** Lossless on-demand definitions with a bounded, non-duplicated required reading set. */
import type { DesignKit } from './types.ts'

const slots = { 'skill.yaml': 'skillYaml', 'schema.yaml': 'schemaYaml', 'validation.yaml': 'validationYaml',
  'panel.yaml': 'panelYaml', 'renderer.md': 'rendererMd' } as const

function resources(kit: DesignKit): Map<string, string> {
  const result = new Map<string, string>([['mindset.md', kit.mindsetSource ?? kit.mindset]])
  for (const skill of kit.skills) {
    const prefix = `${skill.name}/`
    result.set(`${prefix}SKILL.md`, skill.content)
    for (const [file, field] of Object.entries(slots)) {
      const text = skill.metadata?.[field]
      if (typeof text === 'string') result.set(`${prefix}${file}`, text)
    }
  }
  for (const [path, text] of Object.entries(kit.resources ?? {})) if (!result.has(path)) result.set(path, text)
  return result
}

export function migrationDefinitionReadPlan(source: DesignKit, target: DesignKit): {
  required: Record<'source' | 'target', string>
  resources: Record<'source' | 'target', ReadonlyMap<string, string>>
} {
  const inputs = { source: resources(source), target: resources(target) }
  const names = new Set([...source.skills, ...target.skills].map(skill => skill.name))
  const changed = new Set<string>()
  for (const name of names) {
    const a = source.skills.find(skill => skill.name === name), b = target.skills.find(skill => skill.name === name)
    const paths = new Set([...inputs.source.keys(), ...inputs.target.keys()].filter(path => path.startsWith(`${name}/`)))
    if (!a || !b || a.version !== b.version || [...paths].some(path => inputs.source.get(path) !== inputs.target.get(path))) changed.add(name)
  }
  const relevant = new Set(changed)
  // Read direct cross-Bundle contracts from authored declarations. Do not infer
  // dependencies from prose or transitively pull every unrelated Bundle method in.
  for (const skill of [...source.skills, ...target.skills]) {
    const declarations = [skill.metadata?.schemaYaml, skill.metadata?.panelYaml, skill.metadata?.validationYaml]
      .filter(value => typeof value === 'string').join('\n')
    for (const name of names) if (name !== skill.name && declarations.includes(`${name}/`)
      && (changed.has(skill.name) || changed.has(name))) {
      relevant.add(skill.name); relevant.add(name)
    }
  }
  const required = {} as Record<'source' | 'target', string>
  for (const side of ['source', 'target'] as const) {
    const kit = side === 'source' ? source : target
    const selected: Record<string, string> = {}
    for (const [path, text] of inputs[side]) {
      const owner = kit.skills.find(skill => path.startsWith(`${skill.name}/`))
      // Shared authored constraints and complete affected methods/contracts are required.
      // Unrelated examples/assets remain available through their exact resource key.
      if (!owner && /\.(md|ya?ml|json)$/u.test(path) || owner && relevant.has(owner.name)
        && ((changed.has(owner.name) && /\.md$/u.test(path)) || ['skill.yaml', 'schema.yaml', 'validation.yaml', 'panel.yaml'].includes(path.slice(owner.name.length + 1)))) selected[path] = text
    }
    required[side] = JSON.stringify({ kit: { name: kit.name, version: kit.version }, changed: [...changed], relevant: [...relevant],
      // The relation contract is Kit-owned; the compiled ontology duplicates member schemas.
      relationVocabulary: kit.relationVocabulary, files: selected,
      availableResources: ['complete', ...inputs[side].keys()] }, null, 2)
  }
  return { required, resources: inputs }
}
