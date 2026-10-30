/** Trusted package entry. React comes from the host, never a bundled import. */
export async function install(registry, sources, pin, { React, ReactDOM }) {
  return registry.registerPackage(sources, pin, checked => checked.manifest.components.map(component => ({
    id: component.id,
    scrollOwner: 'panel',
    render: () => React.createElement('p', { 'data-native-package': checked.name }, 'Trusted notice component'),
  })), { hostReact: React, providerReact: React, hostReactDOM: ReactDOM, providerReactDOM: ReactDOM })
}
