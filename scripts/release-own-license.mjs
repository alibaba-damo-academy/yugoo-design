/** Project-owned materials only; third-party licenses remain separate. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const OWN_LICENSE_FILES = Object.freeze(['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md'])

export async function copyOwnLicenseMaterials(sourceRoot, targetRoot) {
  // Read all authority files first; a missing input must not publish a partial set.
  const materials = await Promise.all(OWN_LICENSE_FILES.map(name => readFile(join(sourceRoot, name))))
  for (const [index, name] of OWN_LICENSE_FILES.entries()) {
    // Never replace a third-party or existing overlay license with our own.
    await writeFile(join(targetRoot, name), materials[index], { flag: 'wx' })
  }
}
