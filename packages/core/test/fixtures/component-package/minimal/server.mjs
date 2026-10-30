/** Trusted Provider bootstrap; the existing registry retains Bundle authority. */
export function install(registry, checked, authority, registerContributions) {
  return registerContributions(registry, checked, checked.manifest.components.map(component => ({
    authority, presentation: component.id,
  })))
}
