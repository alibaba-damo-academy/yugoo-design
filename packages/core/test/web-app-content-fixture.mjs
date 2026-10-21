/** Resolve test assets through the package's existing discovery declaration. */
import { readFileSync } from 'node:fs'
const packageRoot = new URL('../../skills-web-app/', import.meta.url)
const kit = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8')).designSystem.kit
const bundleRoot = new URL(`${(kit.bundles ?? kit.skills).replace(/\/$/, '')}/`, packageRoot)
export const webAppBundleUrl = (path = '') => new URL(path, bundleRoot)
