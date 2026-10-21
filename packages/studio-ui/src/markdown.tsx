/**
 * Minimal safe Markdown-subset renderer for read-only Studio documents.
 *
 * Renders headings, paragraphs, lists, tables, fenced code, inline code, and emphasis
 * as React elements only — text is never interpreted as HTML, so document
 * content cannot inject markup. Anything outside the subset renders as plain
 * paragraph text. The byte-exact raw source remains available through the
 * viewer's source mode; this renderer is presentation only.
 */
import { Fragment, type ReactElement, type ReactNode } from 'react'

/** Split one leading YAML frontmatter block from the document body. */
export function splitFrontmatter(source: string): { frontmatter?: string; body: string } {
  const opening = /^\uFEFF?---[ \t]*\r?\n/u.exec(source)
  if (opening === null) return { body: source }
  const remaining = source.slice(opening[0].length)
  const closing = /^---[ \t]*(?:\r?\n|$)/mu.exec(remaining)
  if (closing === null) return { body: source }
  return {
    frontmatter: remaining.slice(0, closing.index).replace(/\r?\n$/u, ''),
    body: remaining.slice(closing.index + closing[0].length),
  }
}

/** Shared full-file reading view; source/editing modes retain their original bytes. */
export function renderStudioDocument(source: string, options: { locale: 'zh' | 'en'; ariaLabel?: string }): ReactElement {
  const { frontmatter, body } = splitFrontmatter(source)
  return <>
    {frontmatter === undefined ? null : <details className="ygd-studio-file-metadata">
      <summary>{options.locale === 'zh' ? '文件元信息 · 展开查看' : 'File metadata · expand to view'}</summary>
      <pre className="ygd-studio-frontmatter" aria-label="frontmatter">{frontmatter}</pre>
    </details>}
    <div aria-label={options.ariaLabel}>{renderStudioMarkdown(body)}</div>
  </>
}

/** Parse `**bold**` and `` `code` `` segments into React nodes; everything else is plain text. */
function inlineNodes(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/gu
  let lastIndex = 0
  let match: RegExpExecArray | null
  let index = 0
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    const token = match[0]
    if (token.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-b${index}`}>{token.slice(2, -2)}</strong>)
    } else {
      nodes.push(<code key={`${keyPrefix}-c${index}`}>{token.slice(1, -1)}</code>)
    }
    lastIndex = match.index + token.length
    index += 1
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

/** Split a pipe table row, retaining escaped pipes as cell text. */
function tableCells(line: string): string[] | undefined {
  const cells: string[] = []
  let cell = ''
  let separators = 0
  for (const character of line.trim()) {
    if (character === '|') {
      const slashes = /\\+$/u.exec(cell)?.[0].length ?? 0
      if (slashes % 2 === 1) {
        cell = cell.slice(0, -1) + '|'
      } else {
        cells.push(cell.trim())
        cell = ''
        separators += 1
      }
    } else cell += character
  }
  if (separators === 0) return undefined
  cells.push(cell.trim())
  if (line.trimStart().startsWith('|')) cells.shift()
  if (line.trimEnd().endsWith('|') && cell === '') cells.pop()
  return cells
}

function tableHeader(lines: string[], index: number): {
  cells: string[]; alignments: ('left' | 'center' | 'right' | undefined)[]
} | undefined {
  const cells = tableCells(lines[index] ?? '')
  const delimiters = tableCells(lines[index + 1] ?? '')
  if (!cells?.length || delimiters?.length !== cells.length || !delimiters.every(cell => /^:?-+:?$/u.test(cell))) return undefined
  return { cells, alignments: delimiters.map(cell => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : undefined) }
}

/**
 * Render the safe Markdown subset of one read-only document body.
 * @param body - Markdown text without frontmatter.
 * @returns a React element tree; no raw HTML is ever produced.
 */
export function renderStudioMarkdown(body: string): ReactElement {
  const lines = body.split(/\r?\n/u)
  const blocks: ReactElement[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | undefined
  let blockIndex = 0

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return
    const text = paragraph.join(' ')
    blocks.push(<p key={`p${blockIndex}`}>{inlineNodes(text, `p${blockIndex}`)}</p>)
    paragraph = []
    blockIndex += 1
  }
  const flushList = (): void => {
    if (list === undefined) return
    const items = list.items.map((item, itemIndex) => (
      <li key={`li${blockIndex}-${itemIndex}`}>{inlineNodes(item, `li${blockIndex}-${itemIndex}`)}</li>
    ))
    blocks.push(list.ordered
      ? <ol key={`ol${blockIndex}`}>{items}</ol>
      : <ul key={`ul${blockIndex}`}>{items}</ul>)
    list = undefined
    blockIndex += 1
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string
    const fence = /^```/u.exec(line)
    if (fence !== null) {
      flushParagraph()
      flushList()
      const code: string[] = []
      index += 1
      while (index < lines.length && !/^```/u.test(lines[index] as string)) {
        code.push(lines[index] as string)
        index += 1
      }
      blocks.push(<pre key={`pre${blockIndex}`}><code>{code.join('\n')}</code></pre>)
      blockIndex += 1
      continue
    }
    const table = tableHeader(lines, index)
    if (table !== undefined) {
      flushParagraph()
      flushList()
      const rows: string[][] = []
      index += 1 // Skip the delimiter row; it is syntax, not document content.
      while (index + 1 < lines.length) {
        const next = lines[index + 1] as string
        if (/^\s*(?:```|#{1,4}\s|[-*]\s|\d+[.)]\s)/u.test(next)) break
        const cells = tableCells(next)
        if (cells === undefined) break
        rows.push(cells)
        index += 1
      }
      blocks.push(<div key={`table${blockIndex}`} className="ygd-studio-markdown-table-scroll" tabIndex={0}>
        <table>
          <thead><tr>{table.cells.map((cell, column) => <th key={column} scope="col" style={{ textAlign: table.alignments[column] }}>{inlineNodes(cell, `th${blockIndex}-${column}`)}</th>)}</tr></thead>
          <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{table.cells.map((_, column) => <td key={column} style={{ textAlign: table.alignments[column] }}>{inlineNodes(row[column] ?? '', `td${blockIndex}-${rowIndex}-${column}`)}</td>)}</tr>)}</tbody>
        </table>
      </div>)
      blockIndex += 1
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/u.exec(line)
    if (heading !== null) {
      flushParagraph()
      flushList()
      const level = (heading[1] as string).length
      const content = inlineNodes(heading[2] as string, `h${blockIndex}`)
      blocks.push(level === 1
        ? <h1 key={`h${blockIndex}`}>{content}</h1>
        : level === 2
          ? <h2 key={`h${blockIndex}`}>{content}</h2>
          : level === 3
            ? <h3 key={`h${blockIndex}`}>{content}</h3>
            : <h4 key={`h${blockIndex}`}>{content}</h4>)
      blockIndex += 1
      continue
    }
    const unordered = /^\s*[-*]\s+(.*)$/u.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.*)$/u.exec(line)
    if (unordered !== null || ordered !== null) {
      flushParagraph()
      const isOrdered = ordered !== null
      const item = (isOrdered ? ordered : unordered)?.[1] as string
      if (list === undefined || list.ordered !== isOrdered) {
        flushList()
        list = { ordered: isOrdered, items: [] }
      }
      list.items.push(item)
      continue
    }
    if (line.trim() === '') {
      flushParagraph()
      flushList()
      continue
    }
    flushList()
    paragraph.push(line.trim())
  }
  flushParagraph()
  flushList()
  return <div className="ygd-studio-markdown">{blocks.map((block, index) => <Fragment key={`f${index}`}>{block}</Fragment>)}</div>
}
