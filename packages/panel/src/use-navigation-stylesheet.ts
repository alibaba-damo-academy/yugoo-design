import { useEffect, useState } from 'react'
import type { RenderOptions } from './interpreter.ts'
import { confinedEditableArtifact } from './text-artifact-edit.ts'

export interface NavigationStylesheet {
  readonly path?: string
  readonly content?: string
  readonly loading: boolean
}

/** One parent-owned read shared by all cards. No cross-project/global cache. */
export function useNavigationStylesheet(raw: string | undefined, options?: RenderOptions): NavigationStylesheet {
  const path = raw && confinedEditableArtifact(raw, raw.split('/')[0] ?? '') && /\.css$/u.test(raw) ? raw : undefined
  const read = options?.readArtifact
  const hash = path ? options?.artifactFiles?.[path] : undefined
  const available = !!path && (options?.artifactFiles === undefined || hash !== undefined)
  const key = JSON.stringify([path, hash, options?.sourceRevision, options?.collapseToken])
  const [result, setResult] = useState<{ key: string; read: typeof read; content?: string }>()
  useEffect(() => {
    let active = true
    if (!available || !read || !path) return
    void read(path).then(file => {
      if (active) setResult({ key, read, ...(file.found ? { content: file.content } : {}) })
    }).catch(() => { if (active) setResult({ key, read }) })
    return () => { active = false }
  }, [available, path, read, key])
  const current = result?.key === key && result.read === read ? result : undefined
  return { path, content: available ? current?.content : undefined, loading: available && !!read && !current }
}
