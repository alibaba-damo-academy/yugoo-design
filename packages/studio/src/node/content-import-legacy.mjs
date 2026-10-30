/** Reuse Core's legacy migration before comparing immutable imported content. */
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { DesignContentStore, contentNodeFs, loadDesignKit } from 'dsh-design-core'

/** Caller owns stagingRoot and removes it on both success and failure. */
export async function normalizeLegacyKitImport(staged, { stagingRoot, sourceId, dependencies }) {
  const legacy = staged.find(unit => unit.kind === 'kit' && !unit.files.some(file => file.path === 'kit.yaml'))
  if (!legacy) return staged
  if (staged.length !== 1) throw new Error('Legacy Kit import must contain one complete Kit unit.')

  const transport = legacy.files.filter(file => file.path === 'bundles' || file.path.startsWith('bundles/'))
  if (transport.length) {
    const original = await loadDesignKit(contentNodeFs, legacy.rootDir, { sourceId })
    const pins = original.skills.map(skill => ({ name: skill.catalogName ?? skill.name, version: String(skill.version) }))
    const keys = values => values.map(pin => [pin.name, pin.version])
    if (!Array.isArray(dependencies) || JSON.stringify(keys(dependencies)) !== JSON.stringify(keys(pins))) {
      throw new Error('Legacy Bundle transport does not match declared exact dependencies.')
    }
    const recognized = new Set()
    for (const [index, skill] of original.skills.entries()) {
      const prefix = `bundles/${pins[index].name}/${pins[index].version}/`
      const copies = transport.filter(file => file.path.startsWith(prefix))
      if (!copies.length) continue
      const embeddedPrefix = relative(legacy.rootDir, skill.resourceRoot).split(sep).join('/') + '/'
      const embedded = new Map(legacy.files.filter(file => file.path.startsWith(embeddedPrefix))
        .map(file => [file.path.slice(embeddedPrefix.length), file.base64]))
      if (copies.length !== embedded.size || copies.some(file => embedded.get(file.path.slice(prefix.length)) !== file.base64)) {
        throw new Error('Legacy Bundle transport must match its complete embedded Bundle bytes.')
      }
      for (const file of copies) recognized.add(file.path)
    }
    if (transport.some(file => !recognized.has(file.path))) throw new Error('Legacy Bundle transport contains undeclared content.')
    // This is only the caller-owned staged clone. Every removed byte is retained
    // in the verified embedded Bundle, which Core migrates independently below.
    await rm(join(legacy.rootDir, 'bundles'), { recursive: true })
  }

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
