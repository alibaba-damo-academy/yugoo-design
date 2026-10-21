/**
 * Compatibility aliases for Design tool arguments.
 * Canonical Bundle names keep their sdk-pilot underscore form (`flow_design`)
 * in the Mindset catalog, Design Files, events, and `run_design_skill` input.
 */

/**
 * Return the legacy hyphen alias accepted by selected Design tools.
 * @param name - canonical underscore-form Bundle name.
 * @returns the corresponding hyphen-form alias.
 */
export function skillAlias(name: string): string {
  return name.replace(/_/g, '-')
}
