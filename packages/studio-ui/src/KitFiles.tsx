import { useEffect, useState, type ReactNode } from 'react'
import type { StudioManagementClient } from './types.ts'
import { FileExplorer } from './FileExplorer.tsx'
import { LoadingIndicator } from './LoadingIndicator.tsx'
import { renderStudioDocument } from './markdown.tsx'
import { FileInfoSidebar, FilePurpose } from './FileInfoSidebar.tsx'

/** Installed sources are byte-preserving read-only inputs. Editing happens in copies. */
export function KitFiles({ client, name, version, mindset, description, locale, renderMindset, canNavigate = () => true }: { client: StudioManagementClient; name: string; version: string; mindset: string; description?: string; locale: 'zh' | 'en'; renderMindset?: (sourceToggle: ReactNode) => ReactNode; canNavigate?: () => boolean }) {
  const [paths, setPaths] = useState<readonly string[]>(['mindset.md'])
  const [path, setPath] = useState('mindset.md'), [content, setContent] = useState(mindset)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [read, setRead] = useState(true)
  const zh = locale === 'zh'
  useEffect(() => {
    let active = true
    if (client.readKitFiles) void client.readKitFiles({ name, version }).then(files => { if (active) setPaths(files) }, failure => { if (active) setError(String(failure)) })
    return () => { active = false }
  }, [client, name, version])
  useEffect(() => {
    let active = true
    setError(''); setContent('')
    if (!client.readKitFile) { setContent(path === 'mindset.md' ? mindset : ''); return }
    setBusy(true)
    void client.readKitFile({ name, version, path }).then(value => { if (active) setContent(value.content) }, failure => { if (active) setError(String(failure)) }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [client, name, version, path, mindset])
  const toggle = /\.md$/i.test(path) && <button type="button" className="ygd-studio-doc-toggle" onClick={() => setRead(!read)}>{read ? (zh ? '原文' : 'Source') : (zh ? '阅读' : 'Read')}</button>
  return <div className="ygd-studio-workspace-body ygd-studio-files-layout">
    <aside className="ygd-studio-file-tree-pane"><div className="ygd-studio-file-tree-header">{zh ? '设计套件文件' : 'Kit Files'} · {paths.length}</div><FileExplorer paths={paths} selected={path} openFile={next => { if (next !== path && canNavigate()) setPath(next) }} /></aside>
    <div className="ygd-studio-content-pane">{!busy && !error && read && path === 'mindset.md' && renderMindset ? renderMindset(toggle) : <><div className="ygd-studio-doc-toolbar"><div className="ygd-studio-file-heading"><strong className="ygd-studio-document-name">{path}</strong><FilePurpose path={path} locale={locale} /></div>{toggle}</div>
      <div className="ygd-studio-document-body">{busy ? <LoadingIndicator label={zh ? '正在读取文件' : 'Loading file'} /> : error ? <p role="alert">{error}</p> : read && /\.md$/i.test(path) ? renderStudioDocument(content, { locale, ariaLabel: 'Kit document' }) : <pre aria-label="Kit file source" style={{ padding: 16, whiteSpace: 'pre-wrap', font: '13px/1.7 ui-monospace, monospace' }}>{content}</pre>}</div></>}
      <footer className="ygd-studio-doc-footer"><span>{zh ? '已安装 · 只读' : 'Installed · read-only'}</span><span>{new TextEncoder().encode(content).length} {zh ? '字节' : 'bytes'}</span></footer>
    </div>
    <FileInfoSidebar kind="kit" description={description} locale={locale} />
  </div>
}
