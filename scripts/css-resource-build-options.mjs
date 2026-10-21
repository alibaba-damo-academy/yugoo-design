import * as parser from 'css-tree'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Scope resource reads to the nearest real package owner, including npm CSS.
 * Route identity is target-specific: renderer/client builds must not overwrite
 * one another's asset manifest. No URL base is inferred from a CJS factory.
 */
export function cssResourceBuildOptions(targetId) {
  if (typeof targetId !== 'string' || !/^[a-z0-9-]+$/u.test(targetId)) throw Error('Invalid CSS build target')
  return {
    prefix: `/design-system-assets/${targetId}/`, parser,
    ownerRoot(stylesheet) {
      let directory = dirname(realpathSync(stylesheet))
      for (let level = 0; level < 32; level++) {
        if (existsSync(join(directory, 'package.json'))) return directory
        const parent = dirname(directory)
        if (parent === directory) break
        directory = parent
      }
      throw Error('CSS stylesheet has no bounded package owner')
    },
  }
}
