/** Read-only public snapshot triage. Never copies files or changes Git configuration. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const actions = new Set(['include', 'exclude', 'review'])
export const EXPORT_FILE_BYTE_LIMIT = 32 * 1024 * 1024
export const EXPORT_TOTAL_BYTE_LIMIT = 64 * 1024 * 1024
const reviewableFindings = new Set(['large_file_manual_review', 'binary_manual_review'])
function git(source, args, options = {}) {
  return execFileSync('git', ['--no-replace-objects', '-C', source, ...args], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...options,
  })
}
function validatePolicy(policy) {
  if (policy?.version !== 1 || !Array.isArray(policy.rules)) throw new Error('Invalid public source policy')
  for (const rule of policy.rules) {
    if (!actions.has(rule.action) || !['file', 'prefix'].includes(rule.kind)
      || typeof rule.path !== 'string' || !rule.path || rule.path.startsWith('/')
      || /[\\\0\r\n]/u.test(rule.path) || rule.path.split('/').some(x => x === '.' || x === '..')
      || (rule.kind === 'prefix' && !rule.path.endsWith('/'))
      || typeof rule.reason !== 'string' || !rule.reason.trim()) throw new Error('Invalid public source rule')
  }
  if (policy.reviewedFiles !== undefined && !Array.isArray(policy.reviewedFiles)) throw new Error('Invalid reviewed files')
  const reviewedPaths = new Set()
  for (const review of policy.reviewedFiles ?? []) {
    if (!review || typeof review.path !== 'string' || !review.path || review.path.startsWith('/')
      || /[\\\0\r\n]/u.test(review.path) || review.path.split('/').some(part => !part || part === '.' || part === '..')
      || reviewedPaths.has(review.path) || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(review.oid)
      || !Number.isSafeInteger(review.bytes) || review.bytes < 0 || review.bytes > EXPORT_FILE_BYTE_LIMIT
      || !Array.isArray(review.findings) || !review.findings.length
      || new Set(review.findings).size !== review.findings.length || review.findings.some(kind => !reviewableFindings.has(kind))
      || typeof review.reason !== 'string' || !review.reason.trim()) throw new Error('Invalid exact blob review')
    reviewedPaths.add(review.path)
  }
}
const patterns = [
  ['credential_like', /\b(?:tvly-|fc-|sk-)[A-Za-z0-9_-]{16,}/u],
  ['private_source', /gitlab\.alibaba-inc\.com/u],
  ['internal_gateway', /llm-gateway\.pre-opt\.aliyun\.com/u],
  ['developer_absolute_path', /(?:\/home\/jeff\/|[A-Za-z]:\\Users\\)/u],
  ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
]

// A hashed Slovak locale chunk can resemble an sk- credential. Only recognize
// full JSON asset lines in the distribution manifest, bound to an output hash;
// prose, other fields, other files and malformed manifests still scan normally.
function distributionAssetLines(path, text) {
  const safe = new Set()
  if (path !== 'release/dsh-distribution-materials.json') return safe
  try {
    const manifest = JSON.parse(text)
    if (manifest.schemaVersion !== 1 || !manifest.packages) return safe
    const assets = new Set()
    for (const pkg of Object.values(manifest.packages)) {
      for (const [asset, hash] of Object.entries(pkg.observedOutputSha256 ?? {})) {
        if (/^lib\/sk-SK-[A-Z0-9]{8}-[A-Za-z0-9_-]{8}\.js$/u.test(asset)
          && /^[a-f0-9]{64}$/u.test(hash)) assets.add(asset)
      }
    }
    text.split('\n').forEach((line, i) => {
      const match = /^\s*"(lib\/sk-SK-[A-Z0-9]{8}-[A-Za-z0-9_-]{8}\.js)"(?:\s*:\s*"([a-f0-9]{64})")?,?\s*$/u.exec(line)
      if (match && assets.has(match[1])) safe.add(i)
    })
  } catch { /* No exception for malformed JSON. */ }
  return safe
}

export function inspectPublicSnapshot({ source, revision, policy, publicSourceConfig = false }) {
  if (typeof publicSourceConfig !== 'boolean') throw new Error('Explicit public source config selection must be boolean')
  validatePolicy(policy)
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(revision)) throw new Error('A full immutable commit ID is required')
  if (git(source, ['rev-parse', '--verify', `${revision}^{commit}`]).trim() !== revision) throw new Error('Revision is not the requested commit')
  const tree = git(source, ['ls-tree', '-r', '-l', '-z', '--full-tree', revision])
  const entries = tree.split('\0').filter(Boolean).map(row => {
    const match = /^(\d+) (blob|commit) ([a-f0-9]+)\s+(\d+|-)\t([\s\S]+)$/u.exec(row)
    if (!match) throw new Error('Unexpected Git tree entry')
    const [, mode, type, oid, size, path] = match
    const rule = policy.rules.find(r => r.kind === 'file' ? path === r.path : path.startsWith(r.path))
    return { path, mode, type, oid, bytes: size === '-' ? null : Number(size), action: rule?.action ?? 'review', reason: rule?.reason ?? 'No explicit public export decision', findings: [] }
  })
  for (const review of policy.reviewedFiles ?? []) {
    const entry = entries.find(entry => entry.path === review.path)
    if (!entry || entry.action !== 'include' || !['100644', '100755'].includes(entry.mode)
      || entry.oid !== review.oid || entry.bytes !== review.bytes) throw new Error('Exact blob review does not match included committed input')
    entry.reviewedFindings = review.findings
    entry.reviewReason = review.reason
  }
  const selectedBytes = entries.filter(entry => entry.action === 'include').reduce((sum, entry) => sum + (entry.bytes ?? 0), 0)
  if (selectedBytes > EXPORT_TOTAL_BYTE_LIMIT) throw new Error('Selected export exceeds total byte bound')
  // Read only bounded committed blobs, never working-tree bytes or submodule contents.
  const scans = []
  for (const entry of entries) {
    if (entry.action === 'exclude') continue
    if (entry.bytes > EXPORT_FILE_BYTE_LIMIT) entry.findings.push({ kind: 'export_file_capacity_exceeded' })
    if (!['100644', '100755'].includes(entry.mode)) entry.findings.push({ kind: 'non_regular_entry' })
    else if (entry.bytes > 1024 * 1024) entry.findings.push({ kind: 'large_file_manual_review' })
    else scans.push(entry)
  }
  if (scans.reduce((n, e) => n + e.bytes + 128, 0) > 60 * 1024 * 1024) throw new Error('Bounded scan size exceeded; split the policy review')
  if (scans.length) {
    const data = git(source, ['cat-file', '--batch'], { encoding: null, input: scans.map(e => e.oid).join('\n') + '\n' })
    let offset = 0
    for (const entry of scans) {
      const end = data.indexOf(10, offset)
      if (end < 0 || data.subarray(offset, end).toString() !== `${entry.oid} blob ${entry.bytes}`) throw new Error('Unexpected Git object response')
      const bytes = data.subarray(end + 1, end + 1 + entry.bytes)
      offset = end + 1 + entry.bytes + 1
      if (bytes.length !== entry.bytes || data[offset - 1] !== 10) throw new Error('Truncated Git object response')
      if (bytes.includes(0)) { entry.findings.push({ kind: 'binary_manual_review' }); continue }
      let text
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
      catch { entry.findings.push({ kind: 'invalid_utf8_manual_review' }); continue }
      // The explicit source projection always removes root repository metadata.
      // Only its private-source locator may be absent from the projected scan;
      // credentials, private keys, gateways and machine paths still scan raw bytes.
      let privateSourceText = text
      if (publicSourceConfig && entry.path === 'package.json') {
        try {
          const root = JSON.parse(text), repository = root.repository
          // Compare original JSON tokens too: duplicate keys or alternate lexical
          // forms must not let parsing hide a private locator outside repository.
          const canonicalTokens = text.match(/"(?:\\.|[^"\\])*"|[^\s]/gu)?.join('') === JSON.stringify(root)
          if (canonicalTokens && root.private === true && (typeof repository === 'string'
            || repository && typeof repository === 'object' && !Array.isArray(repository)
              && typeof repository.url === 'string'
              && (repository.type === undefined || typeof repository.type === 'string')
              && Object.keys(repository).every(key => ['type', 'url'].includes(key)))) {
            delete root.repository
            privateSourceText = JSON.stringify(root)
            if (patterns.find(([kind]) => kind === 'private_source')[1].test(text)
              && !patterns.find(([kind]) => kind === 'private_source')[1].test(privateSourceText)) {
              entry.requiredProjection = 'public-source-config'
            }
          }
        } catch { /* Invalid root JSON is not granted a projection exception. */ }
      }
      const assetLines = distributionAssetLines(entry.path, text)
      text.split('\n').forEach((line, i) => {
        for (const [kind, pattern] of patterns) {
          if (kind === 'credential_like' && assetLines.has(i)) continue
          if (kind === 'private_source' && !pattern.test(privateSourceText)) continue
          if (pattern.test(line)) entry.findings.push({ kind, line: i + 1 })
        }
  })
    }
    if (offset !== data.length) throw new Error('Trailing Git object response')
  }
  const counts = Object.fromEntries([...actions].map(action => [action, entries.filter(e => e.action === action).length]))
  const blocked = entries.filter(e => e.action === 'review' || (e.action === 'include' && e.findings.some(f => !e.reviewedFindings?.includes(f.kind))))
  return {
    schemaVersion: 1, revision, policySha256: createHash('sha256').update(JSON.stringify(policy)).digest('hex'),
    kind: 'read-only-public-snapshot-triage', publicationStatus: 'local-unreviewed', counts, blockedFiles: blocked.length,
    publicSourceConfigRequired: entries.some(entry => entry.requiredProjection === 'public-source-config'),
    classificationComplete: counts.review === 0, automatedChecksPassed: blocked.length === 0,
    releaseApproved: false,
    limitations: ['Heuristic current-commit scan, not a complete security or license audit', 'No Git history, archives, large files, binary payloads or submodule contents scanned', 'No build, installation, dependency or runtime verification', 'Excluded paths are not copied or scanned; no export is performed'],
    entries,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2)
    if (args.length !== 6 || args[0] !== '--source' || args[2] !== '--revision' || args[4] !== '--policy') throw new Error('Usage: --source DIR --revision FULL_COMMIT --policy FILE')
    const result = inspectPublicSnapshot({ source: resolve(args[1]), revision: args[3], policy: JSON.parse(readFileSync(args[5], 'utf8')) })
    console.log(JSON.stringify(result, null, 2))
    if (!result.automatedChecksPassed) process.exitCode = 2
  } catch {
    // Git and JSON errors may include private bytes. Never echo their raw messages.
    console.error('Public snapshot preflight failed. Check arguments, commit, policy and bounded Git-object access; no files were exported.')
    process.exitCode = 1
  }
}
