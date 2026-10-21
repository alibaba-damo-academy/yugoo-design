/** Pure document relocation proposal; no writes, export or publication. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { posix } from 'node:path'

const relocations = new Map([
  ['release/README.public.md', 'README.md'],
  ['release/CONTRIBUTING.public.md', 'CONTRIBUTING.md'],
  ['release/SECURITY.public.md', 'SECURITY.md'],
])
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
function safe(path) {
  assert.ok(typeof path === 'string' && path.length && !path.startsWith('/')
    && !/[\\\0\r\n]/u.test(path) && path.split('/').every(p => p && p !== '.' && p !== '..'),
  'Expected a repository-relative document path')
}

/**
 * Relocate only the three explicit public drafts and their inline Markdown
 * links. Every local link must resolve to an explicitly selected output file.
 * Unsupported local HTML/reference-link forms fail instead of silently
 * producing a broken root document. Anchors are preserved, not validated.
 */
export function proposePublicDocuments({ drafts, includedPaths }) {
  assert.ok(drafts && typeof drafts === 'object' && !Array.isArray(drafts))
  assert.deepEqual(Object.keys(drafts).sort(), [...relocations.keys()].sort())
  assert.ok(Array.isArray(includedPaths))
  includedPaths.forEach(safe)
  assert.equal(new Set(includedPaths).size, includedPaths.length)
  const selected = new Set(includedPaths)
  for (const target of relocations.values()) {
    assert.ok(!selected.has(target), 'An existing root document needs a separate replacement decision')
    selected.add(target)
  }
  const files = [], missing = []
  for (const [origin, destination] of relocations) {
    const text = drafts[origin]
    assert.equal(typeof text, 'string')
    assert.ok(!/<(?:a|img)\b[^>]*(?:href|src)\s*=|^\s*\[[^\]]+\]:/imu.test(text),
      'Local HTML/reference links require separate review')
    const links = []
    const output = text.replace(/(!?\[[^\]\n]*\])\(([^)\n]+)\)/gu, (match, label, href) => {
      assert.ok(!/[\s<>]/u.test(href), 'Link titles or encoded syntax require separate review')
      if (href.startsWith('#') || /^(?:https?:|mailto:)/iu.test(href)) return match
      assert.ok(!/^[a-z][a-z0-9+.-]*:|^\/\//iu.test(href), 'Unsupported link scheme')
      const hash = href.indexOf('#'), path = hash < 0 ? href : href.slice(0, hash)
      const anchor = hash < 0 ? '' : href.slice(hash)
      assert.ok(path && !path.startsWith('/') && !/[?%\\]/u.test(path), 'Ambiguous local link')
      const sourceTarget = posix.normalize(posix.join(posix.dirname(origin), path))
      safe(sourceTarget)
      const outputTarget = relocations.get(sourceTarget) ?? sourceTarget
      if (!selected.has(outputTarget)) missing.push({ origin, href, target: outputTarget })
      const relocated = (posix.relative(posix.dirname(destination), outputTarget) || posix.basename(outputTarget)) + anchor
      links.push({ original: href, output: relocated, target: outputTarget })
      return `${label}(${relocated})`
    })
    files.push({ origin, destination, sourceSHA256: sha(text), outputSHA256: sha(output), text: output, links })
  }
  return { kind: 'public-document-relocation-proposal', files, missing,
    localFileLinksClosed: missing.length === 0, anchorsValidated: false,
    targetUpdated: false, releaseApproved: false }
}

// Canonical documents stay at their source paths. This is a read-only link
// check over an explicit snapshot selection, not another document authority.
function outsideFences(text) {
  let fence
  return text.split('\n').filter(line => {
    const match = /^\s{0,3}(`{3,}|~{3,})/u.exec(line)
    if (match) {
      if (!fence) fence = match[1]
      else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = undefined
      return false
    }
    return !fence
  }).join('\n')
}

function headingAnchors(text) {
  const anchors = new Set(), counts = new Map()
  for (const line of outsideFences(text).split('\n')) {
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line)
    if (!heading) continue
    const base = heading[1].replace(/<[^>]*>/gu, '')
      .replace(/!?\[([^\]]+)\]\([^)]+\)/gu, '$1').toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').trim().replace(/\s/gu, '-')
    const count = counts.get(base) ?? 0
    anchors.add(count ? `${base}-${count}` : base)
    counts.set(base, count + 1)
  }
  return anchors
}

function inlineLinks(text) {
  const links = []
  // One nested label supports linked image badges without missing their outer
  // local destination. Recursion also checks any image inside that label.
  for (const match of text.matchAll(/(!?\[(?:[^\[\]\n]|\[[^\]\n]*\])*\])\(([^)\n]+)\)/gu)) {
    links.push(match[2])
    if (match[1].includes('![')) links.push(...inlineLinks(match[1].replace(/^!?\[|\]$/gu, '')))
  }
  return links
}

export function validateCanonicalDocumentLinks({ documents, includedPaths, readTarget }) {
  assert.ok(documents && typeof documents === 'object' && !Array.isArray(documents))
  assert.ok(Array.isArray(includedPaths) && new Set(includedPaths).size === includedPaths.length)
  includedPaths.forEach(safe)
  const selected = new Set(includedPaths), missing = [], links = []
  const anchors = new Map()
  for (const [origin, text] of Object.entries(documents)) {
    safe(origin)
    assert.ok(selected.has(origin), 'Canonical document must be explicitly selected')
    assert.equal(typeof text, 'string')
    const prose = outsideFences(text).replace(/`[^`\n]+`/gu, '')
    assert.ok(!/<(?:a|img)\b[^>]*(?:href|src)\s*=|^\s*\[[^\]]+\]:/imu.test(prose),
      'Local HTML/reference links require separate review')
    for (const href of inlineLinks(prose)) {
      if (/^(?:https?:|mailto:)/iu.test(href)) continue
      assert.ok(!/\s|[<>?%\\]|^[a-z][a-z0-9+.-]*:|^\//iu.test(href), 'Unsupported canonical document link')
      const hash = href.indexOf('#'), path = hash < 0 ? href : href.slice(0, hash)
      const anchor = hash < 0 ? '' : href.slice(hash + 1)
      let target = path ? posix.normalize(posix.join(posix.dirname(origin), path)) : origin
      if (path.endsWith('/')) {
        const directory = target.replace(/\/$/u, '')
        safe(directory)
        const readme = posix.join(directory, 'README.md')
        if (selected.has(readme)) target = readme
        else {
          // GitHub can browse a selected source directory without a README.
          // An excluded/empty directory has no corresponding exported entry.
          links.push({ origin, href, target: directory })
          if (anchor || !includedPaths.some(value => value.startsWith(`${directory}/`))) {
            missing.push({ origin, href, target: directory, reason: 'directory_not_selected' })
          }
          continue
        }
      }
      safe(target)
      links.push({ origin, href, target })
      if (!selected.has(target)) {
        missing.push({ origin, href, target, reason: 'file_not_selected' })
        continue
      }
      if (anchor) {
        assert.ok(target.endsWith('.md'), 'Anchors require a Markdown target')
        if (!anchors.has(target)) {
          const value = documents[target] ?? readTarget?.(target)
          assert.equal(typeof value, 'string', 'Selected Markdown target must be readable')
          anchors.set(target, headingAnchors(value))
        }
        if (!anchors.get(target).has(anchor)) missing.push({ origin, href, target, reason: 'anchor_not_found' })
      }
    }
  }
  return { links, missing, localFileLinksClosed: missing.length === 0, anchorsValidated: true }
}
