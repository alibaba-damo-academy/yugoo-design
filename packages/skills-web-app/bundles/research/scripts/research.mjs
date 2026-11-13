#!/usr/bin/env node
/** Read-only current-round citation bookkeeping. No retrieval or truth validation.
 * Supported Markdown: ATX/Setext sections, inline/reference/autolinks, fenced and
 * indented code, code spans, images and comments. This is not full CommonMark.
 * HTML uses a tag/attribute lexer, not a URL-shaped-text scan or HTML validator.
 */
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const STATE = 'research/research.json'
const HOST_FILE_USAGE = `Host run_skill_script file input: ${JSON.stringify({ path: 'research.mjs', args: ['validate-round-file'], input_file: STATE, input_files: ['research/R-001/D-001-findings.md', 'research/R-001/conclusion.html'] })}. Replace report paths with the current round's exact references; do not put native CLI options in args.`
const record = value => typeof value === 'object' && value !== null && !Array.isArray(value)
const sourceHeading = (text, custom) => /^(?:sources|信息来源)$/iu.test(text.trim()) || (custom !== undefined && text.trim().toLowerCase() === custom.trim().toLowerCase())
const external = text => /^https?:\/\//iu.test(text)
const sorted = values => [...new Set(values)].sort()
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', sol: '/', num: '#', quest: '?', equals: '=', percnt: '%', period: '.', lpar: '(', rpar: ')', semi: ';', Tab: '\t', NewLine: '\n' }

function decodeEntities(text, diagnostics) {
  return text.replace(/&(#x[\da-f]+|#\d+|[A-Za-z][A-Za-z\d]*);/giu, (whole, name) => {
    if (name[0] === '#') {
      const code = name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))
      if (code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) return String.fromCodePoint(code)
      diagnostics.push(`invalid numeric entity ${whole}`)
      return whole
    }
    if (Object.hasOwn(entities, name)) return entities[name]
    diagnostics.push(`unsupported named URL entity ${whole}; use a literal character or numeric entity`)
    return whole
  })
}
function destination(text, diagnostics, markup = true) {
  const decoded = markup ? decodeEntities(text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/gu, '$1'), diagnostics) : text
  const url = markup ? decoded.trim() : decoded
  if (/[\r\n\t]/u.test(decoded)) { diagnostics.push('control whitespace in a link destination is unsupported'); return undefined }
  if (url.startsWith('//')) { diagnostics.push('protocol-relative source links are unsupported; use an absolute HTTP(S) URL'); return undefined }
  if (/&#(?:x[\da-f]+|\d+)(?![\da-f;])/iu.test(url)) { diagnostics.push('numeric URL entities require a terminating semicolon'); return undefined }
  if (!external(url)) return undefined
  try {
    const parsed = new URL(url)
    if (!parsed.hostname || /[\s\u0000-\u001f\u007f]/u.test(url)) throw new Error('invalid URL')
    return url // Preserve genuine destination spelling; do not drop queries/fragments.
  } catch { diagnostics.push(`malformed external source URL ${JSON.stringify(url)}`); return undefined }
}
function safePath(path) {
  return typeof path === 'string' && path !== '' && !path.startsWith('/') && !/^[a-z]:/iu.test(path)
    && !path.endsWith('/') && !path.includes('\\') && !/[\u0000-\u001f\u007f]/u.test(path)
    && !path.split('/').some(part => ['', '.', '..', '.git'].includes(part))
}
function closingBracket(text, start) {
  let depth = 1
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue }
    if (text[i] === '[') depth++
    if (text[i] === ']' && --depth === 0) return i
  }
  return -1
}
/** Parse one CommonMark-style destination followed by an optional link title. */
function linkDestination(text, start, diagnostics, inline) {
  let i = start
  while (/\s/u.test(text[i] ?? '') && i < text.length) i++
  const begin = i
  let raw = ''
  if (text[i] === '<') {
    i++
    const valueStart = i
    for (; i < text.length && text[i] !== '>'; i++) if (text[i] === '\\') i++
    if (i === text.length) return undefined
    raw = text.slice(valueStart, i++)
  } else {
    let depth = 0
    for (; i < text.length; i++) {
      if (text[i] === '\\' && i + 1 < text.length) { i++; continue }
      if (text[i] === '(') depth++
      else if (text[i] === ')') { if (depth === 0) break; depth-- }
      if (/\s/u.test(text[i])) break
    }
    if (depth !== 0) return undefined
    raw = text.slice(begin, i)
  }
  while (i < text.length && /\s/u.test(text[i])) i++
  if (['"', "'", '('].includes(text[i])) {
    const close = text[i] === '(' ? ')' : text[i]
    i++
    for (; i < text.length && text[i] !== close; i++) if (text[i] === '\\') i++
    if (i === text.length) return undefined
    i++
    while (i < text.length && /\s/u.test(text[i])) i++
  }
  if (inline ? text[i] !== ')' : i !== text.length) return undefined
  return { url: destination(raw, diagnostics), end: inline ? i + 1 : i }
}
function sectionRanges(headings, end, diagnostics) {
  const sources = headings.filter(heading => heading.sources)
  if (sources.length > 1) diagnostics.push('multiple Sources sections are unsupported; use one source list')
  return sources.map(heading => [heading.end, headings.find(next => next.start > heading.start && next.level <= heading.level)?.start ?? end])
}
const inRanges = (offset, ranges) => ranges.some(([start, end]) => offset >= start && offset < end)
const labelKey = text => text.trim().replace(/\s+/gu, ' ').toLowerCase()

function codeSpanEnd(text, start, run) {
  for (let at = start + run.length; at < text.length;) {
    const next = text.indexOf('`', at)
    if (next < 0) return -1
    const width = /^`+/u.exec(text.slice(next))[0].length
    if (width === run.length) return next + width
    at = next + width
  }
  return -1
}
function markdownLinks(text, sourcesHeading) {
  const diagnostics = [], definitions = new Map(), headings = [], lines = text.split(/(?<=\n)/u)
  let offset = 0, fence, inComment = false, codeUntil = 0
  const kept = []
  // Mask block code/comments and definitions without moving source offsets.
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index], bare = line.replace(/\r?\n$/u, '')
    let masked = line
    if (fence) {
      if (new RegExp(`^ {0,3}${fence.char}{${fence.size},}\\s*$`, 'u').test(bare)) fence = undefined
      masked = line.replace(/[^\n]/gu, ' ')
    } else {
      const opening = /^ {0,3}(`{3,}|~{3,})/u.exec(bare)
      if (opening) { fence = { char: opening[1][0], size: opening[1].length }; masked = line.replace(/[^\n]/gu, ' ') }
      else if (/^(?: {4}|\t)/u.test(line)) masked = line.replace(/[^\n]/gu, ' ')
    }
    let cleaned = ''
    for (let i = 0; i < masked.length;) {
      if (offset + i < codeUntil) {
        const stop = Math.min(masked.length, codeUntil - offset)
        cleaned += masked.slice(i, stop); i = stop
      } else if (inComment) {
        const end = masked.indexOf('-->', i)
        const stop = end < 0 ? masked.length : end + 3
        cleaned += masked.slice(i, stop).replace(/[^\n]/gu, ' '); i = stop
        if (end >= 0) inComment = false
      } else if (masked[i] === '`') {
        const run = /^`+/u.exec(masked.slice(i))[0], end = codeSpanEnd(text, offset + i, run)
        if (end >= 0) codeUntil = end
        cleaned += run; i += run.length
      } else if (masked.startsWith('<!--', i)) { inComment = true; cleaned += '    '; i += 4 }
      else cleaned += masked[i++]
    }
    const definition = /^ {0,3}\[([^\]\n]+)\]:[ \t]*(.*?)(?:\r?\n)?$/u.exec(cleaned)
    if (definition) {
      const parsed = linkDestination(definition[2], 0, diagnostics, false)
      if (!parsed) diagnostics.push(`unparseable Markdown reference definition ${JSON.stringify(definition[1])}`)
      else {
        const key = labelKey(definition[1])
        if (definitions.has(key)) diagnostics.push(`duplicate Markdown reference definition ${JSON.stringify(key)}`)
        definitions.set(key, parsed.url)
      }
      cleaned = cleaned.replace(/[^\n]/gu, ' ')
    }
    kept.push(cleaned)
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+|$)(.*?)(?:[ \t]+#+[ \t]*)?\r?\n?$/u.exec(cleaned)
    if (atx) headings.push({ start: offset, end: offset + line.length, level: atx[1].length, sources: sourceHeading(atx[2], sourcesHeading) })
    else if (index > 0 && /^ {0,3}(?:=+|-+)[ \t]*\r?\n?$/u.test(cleaned) && kept[index - 1].trim()) {
      const previous = kept[index - 1]
      headings.push({ start: offset - previous.length, end: offset + line.length, level: cleaned.trim()[0] === '=' ? 1 : 2, sources: sourceHeading(previous, sourcesHeading) })
    }
    offset += line.length
  }
  if (fence) diagnostics.push('unclosed Markdown code fence; citation scope cannot be determined')
  if (inComment) diagnostics.push('unclosed Markdown HTML comment')
  const visible = kept.join(''), ranges = sectionRanges(headings, text.length, diagnostics), body = [], sources = []
  const add = (url, start) => { if (url) (inRanges(start, ranges) ? sources : body).push(url) }
  for (let i = 0; i < visible.length;) {
    if (visible[i] === '\\') { i += 2; continue }
    if (visible[i] === '`') {
      const run = /^`+/u.exec(visible.slice(i))[0], end = codeSpanEnd(visible, i, run)
      if (end >= 0) { i = end; continue }
      i += run.length; continue
    }
    const image = visible.startsWith('![', i), start = image ? i + 1 : i
    if (visible[start] === '[') {
      const close = closingBracket(visible, start)
      if (close < 0) { i++; continue }
      const label = visible.slice(start + 1, close)
      let end = close + 1, url
      if (visible[end] === '(') {
        const parsed = linkDestination(visible, end + 1, image ? [] : diagnostics, true)
        if (!parsed) { diagnostics.push(`unclosed Markdown link near offset ${i}`); i = close + 2; continue }
        end = parsed.end; url = parsed.url
      } else if (visible[end] === '[') {
        const referenceEnd = closingBracket(visible, end)
        if (referenceEnd >= 0) { url = definitions.get(labelKey(visible.slice(end + 1, referenceEnd) || label)); end = referenceEnd + 1 }
      } else url = definitions.get(labelKey(label))
      if (!image) add(url, i)
      i = end; continue
    }
    if (visible[i] === '<') {
      const end = visible.indexOf('>', i + 1)
      if (end >= 0) {
        const inside = visible.slice(i + 1, end)
        if (external(inside)) { add(destination(inside, diagnostics), i); i = end + 1; continue }
        if (/^\/?[a-z][\s/>]/iu.test(inside) || /^\/?[a-z][\w:-]*(?:\s|$)/iu.test(inside)) {
          diagnostics.push(`raw HTML in Markdown is unsupported near offset ${i}; use Markdown citations`)
          const raw = /^([a-z][\w:-]*)\b/iu.exec(inside)?.[1]?.toLowerCase()
          const close = raw && new RegExp(`</${raw}\\s*>`, 'giu')
          if (close && ['script', 'style', 'textarea', 'pre', 'template'].includes(raw)) { close.lastIndex = end + 1; const match = close.exec(visible); if (match) { i = match.index + match[0].length; continue } }
          i = end + 1; continue
        }
      }
    }
    if (external(visible.slice(i)) && (i === 0 || !/[\w]/u.test(visible[i - 1]))) {
      diagnostics.push(`bare URL near offset ${i} is unsupported; use an inline link or <autolink>`)
      while (i < visible.length && !/\s/u.test(visible[i])) i++
      continue
    }
    i++
  }
  return { body: sorted(body), sources: sorted(sources), diagnostics }
}

/** Tokenize real HTML tags/attributes; quoted '>' and raw-text contents stay inert. */
function htmlLinks(text, sourcesHeading) {
  const diagnostics = [], anchors = [], headings = []
  let i = 0, heading, templateDepth = 0
  while (i < text.length) {
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4)
      if (end < 0) { diagnostics.push('unterminated HTML comment'); break }
      i = end + 3; continue
    }
    if (text[i] !== '<') {
      const end = text.indexOf('<', i)
      if (heading) heading.text += text.slice(i, end < 0 ? text.length : end)
      i = end < 0 ? text.length : end; continue
    }
    const start = i, lead = /^<(\/?)([A-Za-z][\w:-]*)/u.exec(text.slice(i))
    if (!lead) {
      if (text.startsWith('<!', i) || text.startsWith('<?', i)) { const end = text.indexOf('>', i + 2); if (end < 0) diagnostics.push('unterminated HTML declaration'); i = end < 0 ? text.length : end + 1; continue }
      i++; continue
    }
    i += lead[0].length
    const tag = lead[2].toLowerCase(), closing = lead[1] === '/', attrs = Object.create(null)
    let ended = false
    while (i < text.length) {
      while (/\s/u.test(text[i] ?? '') && i < text.length) i++
      if (text[i] === '>' || (text[i] === '/' && text[i + 1] === '>')) { i += text[i] === '/' ? 2 : 1; ended = true; break }
      const name = /^[^\s=/>]+/u.exec(text.slice(i))?.[0]
      if (!name) { diagnostics.push(`unparseable HTML tag near offset ${start}`); i++; continue }
      i += name.length
      while (/\s/u.test(text[i] ?? '') && i < text.length) i++
      let value = ''
      if (text[i] === '=') {
        i++
        while (/\s/u.test(text[i] ?? '') && i < text.length) i++
        if (text[i] === '"' || text[i] === "'") {
          const quote = text[i++], end = text.indexOf(quote, i)
          if (end < 0) { diagnostics.push(`unterminated HTML attribute near offset ${start}`); i = text.length; break }
          value = text.slice(i, end); i = end + 1
        } else { const match = /^[^\s>]+/u.exec(text.slice(i)); value = match?.[0] ?? ''; i += value.length }
      }
      const key = name.toLowerCase()
      if (Object.hasOwn(attrs, key)) diagnostics.push(`duplicate HTML attribute ${key} near offset ${start}`)
      else attrs[key] = value
    }
    if (!ended) { diagnostics.push(`unterminated HTML tag near offset ${start}`); break }
    if (tag === 'template') { templateDepth += closing ? -1 : 1; templateDepth = Math.max(0, templateDepth); continue }
    if (!closing && ['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes'].includes(tag)) {
      const close = new RegExp(`</${tag}\\s*>`, 'giu'); close.lastIndex = i
      const match = close.exec(text)
      if (!match) { diagnostics.push(`unterminated HTML raw-text element ${tag}`); break }
      i = match.index + match[0].length; continue
    }
    if (templateDepth > 0) continue
    if (/^h[1-6]$/u.test(tag)) {
      if (!closing) {
        if (heading) diagnostics.push('unclosed HTML heading; Sources boundary is ambiguous')
        heading = { start, end: i, level: Number(tag[1]), text: '', explicit: attrs.id?.toLowerCase() === 'sources' }
      } else if (heading && heading.level === Number(tag[1])) {
        headings.push({ ...heading, end: i, sources: heading.explicit || sourceHeading(decodeEntities(heading.text, []), sourcesHeading) }); heading = undefined
      }
    }
    if (tag === 'a' && !closing && Object.hasOwn(attrs, 'href')) {
      const url = destination(attrs.href, diagnostics)
      if (url) anchors.push({ url, start })
    }
  }
  if (heading) diagnostics.push('unclosed HTML heading; Sources boundary is ambiguous')
  const ranges = sectionRanges(headings, text.length, diagnostics)
  return { body: sorted(anchors.filter(anchor => !inRanges(anchor.start, ranges)).map(anchor => anchor.url)), sources: sorted(anchors.filter(anchor => inRanges(anchor.start, ranges)).map(anchor => anchor.url)), diagnostics }
}

function selectedRound(state) {
  if (!record(state) || typeof state.current_round_id !== 'string' || !record(state.rounds) || !record(state.rounds[state.current_round_id])) throw new Error('current_round_id must identify a current round in canonical state')
  const round = state.rounds[state.current_round_id]
  if (!record(round.directions)) throw new Error('current round directions must be a JSON object')
  return { id: state.current_round_id, round }
}
function referencePaths(state) {
  const { round } = selectedRound(state)
  return [...Object.values(round.directions).filter(record).map(direction => direction.findings_file), round.conclusion_file].filter(path => path !== undefined && path !== null && path !== '')
}
/** Pure check over exact canonical and file bytes. Never changes its arguments. */
export function checkResearchEvidence(state, files, options = {}) {
  const diagnostics = [], counts = { directions: {}, findings: 0, conclusion: 0, total: 0 }, all = new Set(), findings = new Set()
  let id = null, inputError = false
  const input = message => { inputError = true; diagnostics.push(message) }
  const compare = (used, listed, label) => {
    for (const url of used) if (!listed.includes(url)) diagnostics.push(`${label}: missing cited source ${url}`)
    for (const url of listed) if (!used.includes(url)) diagnostics.push(`${label}: unused source ${url}`)
  }
  try {
    if (options.maxSources !== undefined && (!Number.isSafeInteger(options.maxSources) || options.maxSources < 0)) throw new Error('maxSources must be a non-negative safe integer')
    if (options.sourcesHeading !== undefined && (typeof options.sourcesHeading !== 'string' || !options.sourcesHeading.trim())) throw new Error('sourcesHeading must be non-empty text when supplied')
    const selected = selectedRound(state); id = selected.id
    const read = path => {
      if (!safePath(path) || !path.startsWith('research/') || path === STATE) { input(`expected a safe research artifact path relative to Design Files: ${String(path)}`); return undefined }
      if (!record(files)) { input('input_files text reader/map is required for referenced reports'); return undefined }
      if (!Object.hasOwn(files, path) || typeof files[path] !== 'string') { input(`missing required input_files text: ${path}`); return undefined }
      if (files[path].trim() === '') { input(`referenced report is empty: ${path}`); return undefined }
      return files[path]
    }
    for (const [directionId, direction] of Object.entries(selected.round.directions)) {
      if (!record(direction)) { input(`direction ${directionId} must be a JSON object`); continue }
      if ([undefined, null, ''].includes(direction.findings_file)) continue
      const text = read(direction.findings_file)
      if (text === undefined) continue
      const label = `direction ${directionId} (${direction.findings_file})`, links = markdownLinks(text, options.sourcesHeading)
      diagnostics.push(...links.diagnostics.map(message => `${label}: ${message}`))
      const canonical = []
      if (direction.source_urls !== undefined && !Array.isArray(direction.source_urls)) input(`${label}: source_urls must be an array when supplied`)
      else for (const value of direction.source_urls ?? []) {
        if (typeof value !== 'string' || !external(value)) diagnostics.push(`${label}: source_urls contains a non-HTTP(S) source ${JSON.stringify(value)}`)
        else { const url = destination(value, diagnostics, false); if (url) canonical.push(url) }
      }
      const accepted = sorted(canonical)
      Object.defineProperty(counts.directions, directionId, { enumerable: true, value: { body: links.body.length, sources: links.sources.length, canonical: accepted.length } })
      compare(links.body, links.sources, `${label} Sources`)
      compare(links.body, accepted, `${label} source_urls`)
      for (const url of links.body) findings.add(url)
      for (const url of [...links.body, ...links.sources]) all.add(url)
    }
    if (![undefined, null, ''].includes(selected.round.conclusion_file)) {
      const text = read(selected.round.conclusion_file)
      if (text !== undefined) {
        const label = `conclusion (${selected.round.conclusion_file})`, links = htmlLinks(text, options.sourcesHeading)
        diagnostics.push(...links.diagnostics.map(message => `${label}: ${message}`))
        compare(links.body, links.sources, `${label} Sources`)
        const combined = sorted([...links.body, ...links.sources]); counts.conclusion = combined.length
        for (const url of combined) { all.add(url); if (!findings.has(url)) diagnostics.push(`${label}: source not present in accepted findings: ${url}`) }
      }
    }
    counts.findings = findings.size; counts.total = all.size
    if (options.maxSources !== undefined && all.size > options.maxSources) diagnostics.push(`maxSources ${options.maxSources} exceeded: ${all.size} distinct cited document URLs in the current round`)
  } catch (error) { input(error instanceof Error ? error.message : String(error)) }
  return { valid: diagnostics.length === 0, ...(inputError ? { kind: 'input_error' } : {}), round_id: id, source_urls: sorted(all), counts, diagnostics }
}

function readConfined(root, path) {
  if (!safePath(path)) throw new Error(`input path must be safe and relative to Design Files: ${String(path)}`)
  const target = realpathSync(resolve(root, path)), rel = relative(root, target)
  if (rel === '' || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) throw new Error(`input realpath escapes design_files/: ${path}`)
  if (!statSync(target).isFile()) throw new Error(`input must be a regular file: ${path}`)
  return readFileSync(target, 'utf8')
}
function cli(argv) {
  try {
    if (argv[0] !== 'validate-round-file') throw new Error(`usage: research.mjs validate-round-file [--design-files ROOT --input-file research/research.json] [--max-sources N]. ${HOST_FILE_USAGE}`)
    let state, files, maxSources, sourcesHeading
    // Native CLI and Host file input are separate authorities. Reading native
    // disk while ignoring a supplied WorkingCopy can validate stale reports.
    const raw = argv.length === 1 || !process.stdin.isTTY ? readFileSync(0, 'utf8') : ''
    if (argv.length > 1 && raw.trim() !== '') throw new Error(`cannot combine native CLI options with file input on stdin; use either the Host file input or the native CLI. ${HOST_FILE_USAGE}`)
    if (argv.length === 1) {
      const newline = raw.indexOf('\n')
      if (newline < 0) throw new Error('file input must include one-line structured context, newline, and canonical JSON bytes')
      const context = JSON.parse(raw.slice(0, newline))
      if (!record(context)) throw new Error('file input context must be a JSON object')
      if (context.script_io !== undefined && (!record(context.script_io) || context.script_io.input_file !== STATE || context.script_io.output_file !== null)) throw new Error(`script_io must identify ${STATE} and output_file:null; validation never writes files`)
      state = JSON.parse(raw.slice(newline + 1)); files = context.input_files; maxSources = context.maxSources; sourcesHeading = context.sourcesHeading
    } else {
      const { values } = parseArgs({ args: argv.slice(1), options: { 'design-files': { type: 'string' }, 'input-file': { type: 'string' }, 'max-sources': { type: 'string' }, 'sources-heading': { type: 'string' } } })
      if (!values['design-files'] || values['input-file'] !== STATE) throw new Error(`native file mode requires --design-files ROOT --input-file ${STATE}`)
      const root = realpathSync(values['design-files'])
      state = JSON.parse(readConfined(root, STATE))
      files = Object.fromEntries(referencePaths(state).map(path => [path, readConfined(root, path)]))
      if (values['max-sources'] !== undefined) { if (!/^(?:0|[1-9]\d*)$/u.test(values['max-sources'])) throw new Error('maxSources must be a non-negative safe integer'); maxSources = Number(values['max-sources']) }
      sourcesHeading = values['sources-heading']
    }
    const value = checkResearchEvidence(state, files, { maxSources, sourcesHeading })
    process.stdout.write(`${JSON.stringify(value)}\n`)
    process.exitCode = value.valid ? 0 : value.kind === 'input_error' ? 2 : 1
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ valid: false, kind: 'input_error', diagnostics: [error instanceof Error ? error.message : String(error)] })}\n`)
    process.exitCode = 2
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli(process.argv.slice(2))
