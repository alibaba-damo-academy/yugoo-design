/** Reuse Core's legacy migration before comparing immutable imported content. */
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { DesignContentStore } from '../../core/lib/index.js'

/** Caller owns stagingRoot and removes it on both success and failure. */
export async function normalizeLegacyKitImport(staged, { stagingRoot, sourceId }) {
  const legacy = staged.find(unit => unit.kind === 'kit' && !unit.files.some(file => file.path === 'kit.yaml'))
  if (!legacy) return staged
  if (staged.length !== 1) throw new Error('Legacy Kit import must contain one complete Kit unit.')

  // This temporary store only invokes the existing migration. It never becomes
  // the installed catalog; normal adoption still checks bytes and original sources.
  const migrationRoot = await mkdtemp(join(stagingRoot, 'legacy-normalization-'))
  const migration = new DesignContentStore(migrationRoot)
  const kit = await migration.retainKitClosure(legacy.rootDir, { sourceId })
  if (kit.name !== legacy.pin.name || String(kit.version) !== legacy.pin.version) throw new Error('Legacy Kit identity changed during normalization.')

  let count = 0, total = 0
  const capture = async (kind, pin, rootDir) => {
    const files = []
    const walk = async directory => {
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) await walk(path)
        else if (entry.isFile()) {
          const bytes = await readFile(path)
          if (++count > 4096 || (total += bytes.length) > 16 * 1024 * 1024) throw new Error('Normalized content exceeds bounded archive limits.')
          files.push({ path: relative(rootDir, path).split(sep).join('/'), base64: bytes.toString('base64'),
            bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
        } else throw new Error('Normalized imported content must contain only regular files.')
      }
    }
    await walk(rootDir)
    return { kind, pin, rootDir, files }
  }
  const normalized = [await capture('kit', legacy.pin, kit.sourceRoot)]
  for (const skill of kit.skills) normalized.push(await capture('bundle', {
      name: skill.catalogName ?? skill.name, version: String(skill.version),
    }, skill.resourceRoot))
  return normalized
}
