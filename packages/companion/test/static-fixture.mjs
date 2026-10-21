import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Explicit empty verified assets for server/API tests, not a browser fixture. */
export async function staticFixture(root) {
  const staticRoot = join(root, 'static-server-fixture')
  await mkdir(join(staticRoot, 'css-assets/design-companion'), { recursive: true })
  await writeFile(join(staticRoot, 'client.js'), '// Synthetic API server fixture; no browser execution.\n')
  const indexPath = join(staticRoot, 'index.html')
  await writeFile(indexPath, '<!doctype html><script src="/client.js"></script>')
  await writeFile(join(staticRoot, 'css-assets/design-companion/manifest.json'), JSON.stringify({
    schema: 'design-system-css-assets-v1', prefix: '/design-system-assets/design-companion/', assets: [],
  }))
  return { staticRoot, indexPath }
}
