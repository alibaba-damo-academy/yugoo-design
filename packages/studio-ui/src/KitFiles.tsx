import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { StudioManagementClient } from './types.ts'
import { FileExplorer } from './FileExplorer.tsx'
import { LoadingIndicator } from './LoadingIndicator.tsx'
import { StudioFeedback } from './StudioFeedback.tsx'
import { renderStudioDocument } from './markdown.tsx'
import { FileInfoSidebar, FileName } from './FileInfoSidebar.tsx'

type KitFilesProps = { client: StudioManagementClient; name: string; version: string; mindset: string; description?: string; locale: 'zh' | 'en'; renderMindset?: (sourceToggle: ReactNode) => ReactNode; canNavigate?: () => boolean }
/** Installed sources are byte-preserving read-only inputs. Editing happens in copies. */
export function KitFiles(props: KitFilesProps) {
  return <Files key={JSON.stringify([props.name, props.version])} {...props} />
}
function Files({ client, name, version, mindset, description, locale, renderMindset, canNavigate = () => true }: KitFilesProps) {
  const owner = useMemo(() => ({ client, name, version }), [client, name, version])
  const current = useRef(owner); current.current = owner
  const [path, setPath] = useState('mindset.md'), [read, setRead] = useState(true)
  const [listRetry, retryList] = useState(0), [fileRetry, retryFile] = useState(0)
  const [listing, setListing] = useState<{ owner: typeof owner; busy: boolean; paths: readonly string[]; error?: string }>()
  const [reading, setReading] = useState<{ owner: typeof owner; path: string; busy: boolean; content: string; error?: string }>()
  const zh = locale === 'zh'
  const list = listing?.owner === owner ? listing : undefined
  const paths = list?.paths ?? ['mindset.md']
  const file = reading?.owner === owner && reading.path === path ? reading : undefined
  const busy = file?.busy ?? !!client.readKitFile
  const content = file?.content ?? (!client.readKitFile && path === 'mindset.md' ? mindset : '')
  useEffect(() => {
    let active = true
    setListing(old => ({ owner, busy: !!client.readKitFiles, paths: old?.owner === owner ? old.paths : ['mindset.md'] }))
    if (client.readKitFiles) void Promise.resolve().then(() => client.readKitFiles!({ name, version })).then(files => {
      if (active && current.current === owner) { setListing({ owner, busy: false, paths: files }) }
    }, failure => { if (active && current.current === owner) setListing(old => ({ owner, busy: false, error: String(failure), paths: old?.owner === owner ? old.paths : ['mindset.md'] })) })
    return () => { active = false }
  }, [owner, listRetry])
  useEffect(() => {
    let active = true
    if (!client.readKitFile) { setReading({ owner, path, busy: false, content: path === 'mindset.md' ? mindset : '' }); return }
    setReading({ owner, path, busy: true, content: '' })
    void Promise.resolve().then(() => client.readKitFile!({ name, version, path })).then(value => {
      if (active && current.current === owner) setReading({ owner, path, busy: false, content: value.content })
    }, failure => { if (active && current.current === owner) setReading({ owner, path, busy: false, content: '', error: String(failure) }) })
    return () => { active = false }
  }, [owner, path, mindset, fileRetry])
  const toggle = /\.md$/i.test(path) && <button type="button" className="ygd-studio-doc-toggle" onClick={() => setRead(!read)}>{read ? (zh ? '原文' : 'Source') : (zh ? '阅读' : 'Read')}</button>
  return <div className="ygd-studio-workspace-body ygd-studio-files-layout">
    <aside className="ygd-studio-file-tree-pane"><div className="ygd-studio-file-tree-header">{zh ? '设计套件文件' : 'Kit Files'} · {paths.length}</div>
      {(list?.busy ?? !!client.readKitFiles) && <LoadingIndicator label={zh ? '正在读取文件列表' : 'Loading file list'} />}
      {list?.error && <StudioFeedback feedbackId={`list:${listRetry}:${list.error}`} tone="error" locale={locale} title={zh ? '未能读取文件列表' : 'Could not load the file list'} message={list.error}
        actions={[{ label: zh ? '重试文件列表' : 'Retry file list', onClick: () => retryList(value => value + 1) }]} />}
      <FileExplorer paths={paths} selected={path} openFile={next => { if (next !== path && canNavigate()) setPath(next) }} /></aside>
    <div className="ygd-studio-content-pane">{!busy && !file?.error && read && path === 'mindset.md' && renderMindset ? renderMindset(toggle) : <><div className="ygd-studio-doc-toolbar"><div className="ygd-studio-file-heading"><FileName path={path} locale={locale} /></div>{toggle}</div>
      <div className="ygd-studio-document-body">{busy ? <LoadingIndicator label={zh ? '正在读取文件' : 'Loading file'} /> : file?.error ? <StudioFeedback feedbackId={`file:${path}:${fileRetry}:${file.error}`} tone="error" locale={locale} title={zh ? '未能读取此文件' : 'Could not load this file'} message={file.error}
        actions={[{ label: zh ? '重试此文件' : 'Retry file', onClick: () => retryFile(value => value + 1) }]} /> : read && /\.md$/i.test(path) ? renderStudioDocument(content, { locale, ariaLabel: 'Kit document' }) : <pre aria-label="Kit file source" className="ygd-studio-kit-file-source">{content}</pre>}</div></>}
      <footer className="ygd-studio-doc-footer"><span>{zh ? '已安装 · 只读' : 'Installed · read-only'}</span><span>{new TextEncoder().encode(content).length} {zh ? '字节' : 'bytes'}</span></footer>
    </div>
    <FileInfoSidebar kind="kit" description={description} locale={locale} />
  </div>
}
