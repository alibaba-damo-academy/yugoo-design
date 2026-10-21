import { createRequire } from 'node:module'

/** Keep ngraph's CommonJS event consumer on the package's callable CJS export.
 * A browser build with an explicit `import` condition otherwise selects its ESM
 * namespace for require('ngraph.events'), which fails during async layout init.
 * Do not change resolution conditions for unrelated packages or ESM consumers.
 */
export function graphBrowserDependencies() {
  return {
    name: 'design-graph-browser-dependencies',
    resolveId(source: string, importer: string | undefined) {
      if (source === 'ngraph.events' && importer && /[\\/]ngraph\.forcelayout[\\/]/.test(importer)) {
        return createRequire(importer).resolve(source)
      }
      return null
    },
  }
}
