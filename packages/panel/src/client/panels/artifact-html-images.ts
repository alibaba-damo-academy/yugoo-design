import { useCallback, useRef } from 'react'
import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5'
import type { SkillPanelProps } from './shared.ts'
import { useTextArtifactContents, type TextArtifactEntry } from './artifact-text-hydration.ts'

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']
// Match the existing binary RPC's supported lower-case extensions.
const IMAGE_EXTENSION = /\.(?:png|jpe?g|webp)$/u

/** Resolve only relative image references, without allowing traversal above Design Files. */
export function projectImagePath(htmlPath: string, source: string): string | undefined {
  let relative: string
  try { relative = decodeURIComponent(source.split(/[?#]/u)[0] ?? '') } catch { return undefined }
  if (!relative || /^[\/\\]/u.test(relative) || /[:\\\u0000-\u001f]/u.test(relative)) return undefined
  const parts = htmlPath.split('/').slice(0, -1)
  for (const part of relative.split('/')) {
    if (part === '..') { if (parts.length === 0) return undefined; parts.pop() }
    else if (part !== '.' && part !== '') parts.push(part)
  }
  const path = parts.join('/')
  return IMAGE_EXTENSION.test(path) ? path : undefined
}

function images(node: Node): Element[] {
  const own = 'tagName' in node && node.tagName === 'img' ? [node as Element] : []
  return 'childNodes' in node ? own.concat(node.childNodes.flatMap(images)) : own
}

/** Parse without browser resource execution; only the preview projection is changed. */
export function prepareHtmlImages(path: string, html: string) {
  const doc = parse(html)
  const refs = images(doc).flatMap(element => {
    const src = element.attrs.find(attr => attr.name === 'src')
    const file = src === undefined ? undefined : projectImagePath(path, src.value)
    return src === undefined || file === undefined ? [] : [{ element, src, file }]
  })
  let previous: readonly (string | null | undefined)[] | undefined
  let rendered = html
  return {
    paths: [...new Set(refs.map(ref => ref.file))],
    render(contents: Readonly<Record<string, string | null>>): string {
      if (refs.length === 0) return html
      const values = refs.map(ref => contents[ref.file])
      if (previous !== undefined && values.every((value, index) => value === previous![index])) return rendered
      previous = values
      for (const { element, src, file } of refs) {
        src.value = contents[file] ?? ''
        // Select the ordinary fallback for this static image projection.
        element.attrs = element.attrs.filter(attr => attr.name !== 'srcset' && attr.name !== 'data-design-missing-image')
        if (!contents[file]) element.attrs.push({ name: 'data-design-missing-image', value: file })
      }
      rendered = serialize(doc)
      return rendered
    },
  }
}

/**
 * Images hydrate independently from valid HTML using the existing file hook.
 * No image miss can make a readable Page unavailable; hashes, cancellation,
 * deduplication and bounded retries are owned by the shared hydration mechanism.
 */
export function useHtmlImageContents(
  entries: readonly TextArtifactEntry[],
  htmls: Readonly<Record<string, string | null>>,
  readBinary: SkillPanelProps['readBinaryArtifact'],
  originalState: unknown,
  files?: Readonly<Record<string, string>>,
): Readonly<Record<string, string | null>> {
  const projections = useRef(new Map<string, {
    path: string; html: string; projection: ReturnType<typeof prepareHtmlImages>
  }>())
  const active = new Set(entries.map(entry => entry.id))
  for (const id of projections.current.keys()) if (!active.has(id)) projections.current.delete(id)
  for (const { id, path } of entries) {
    const html = htmls[id]
    if (typeof html !== 'string') { projections.current.delete(id); continue }
    const previous = projections.current.get(id)
    if (previous?.path !== path || previous.html !== html) {
      projections.current.set(id, { path, html, projection: prepareHtmlImages(path, html) })
    }
  }
  const paths = [...new Set([...projections.current.values()].flatMap(value => value.projection.paths))]
  const read = useCallback(async (path: string) => {
    const result = await readBinary(path)
    return result.found && ['image/png', 'image/jpeg', 'image/webp'].includes(result.mediaType)
      ? { found: true, content: `data:${result.mediaType};base64,${result.base64}` }
      : { found: false, content: '' }
  }, [readBinary])
  const data = useTextArtifactContents(paths.map(path => ({ id: path, path })), read, originalState, files)
  return Object.fromEntries(Object.entries(htmls).map(([id, html]) =>
    [id, projections.current.get(id)?.projection.render(data) ?? html]))
}
