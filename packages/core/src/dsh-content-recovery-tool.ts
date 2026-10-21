/** Actual registered recovery capability identity; a copied tool name grants nothing. */
const recoveryTools = new WeakSet<object>()
export function markContentRecoveryTool<T extends object>(definition: T): T { recoveryTools.add(definition); return definition }
export function isContentRecoveryTool(definition: unknown): boolean {
  return typeof definition === 'object' && definition !== null && recoveryTools.has(definition)
}
