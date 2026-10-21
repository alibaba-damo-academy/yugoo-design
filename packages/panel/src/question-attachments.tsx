import { useEffect, useRef, useState, type ChangeEvent, type ReactElement, type ReactNode } from 'react'
import type { BinaryArtifactRead } from './client/panels/shared.ts'
import { usePanelI18n, type PanelMessageKey } from './panel-i18n.tsx'
import { QUESTION_MAX_ATTACHMENTS, QUESTION_MAX_ATTACHMENT_BYTES, type StandardQuestionAttachment, type PendingDeclarativeArtifact } from './question-attachment-contract.ts'
export { QUESTION_MAX_ATTACHMENTS, QUESTION_MAX_ATTACHMENT_BYTES, DECLARATIVE_PANEL_ARTIFACTS_KEY, type StandardQuestionAttachment, type PendingDeclarativeArtifact } from './question-attachment-contract.ts'

function safeMime(value: string): string {
  const mime = value.trim().toLowerCase()
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(mime)
    ? mime
    : 'application/octet-stream'
}

function extensionFor(mime: string): string {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  return 'attachment'
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 32 * 1024
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunk, bytes.length)))
  }
  return btoa(binary)
}

export async function prepareDeclarativeQuestionAttachment(
  skill: string,
  questionId: string,
  file: File,
): Promise<{ ref: StandardQuestionAttachment; pending: PendingDeclarativeArtifact }> {
  if (file.size <= 0 || file.size > QUESTION_MAX_ATTACHMENT_BYTES) {
    throw Object.assign(new Error(`附件 ${file.name} 必须大于 0 且不超过 10 MiB`), {
      code: 'QUESTION_ATTACHMENT_SIZE', filename: file.name,
    })
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const digestBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const digest = [...digestBytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
  const mime = safeMime(file.type)
  const path = `${skill}/attachments/${digest}.${extensionFor(mime)}`
  const ref: StandardQuestionAttachment = {
    type: mime.startsWith('image/') ? 'image' : 'file',
    file_md5: digest,
    filename: file.name,
    mime_type: mime,
    size_bytes: bytes.byteLength,
    artifact_file: path,
  }
  return {
    ref,
    pending: { path, content: bytesToBase64(bytes), encoding: 'base64', question_id: questionId, file_md5: digest, filename: file.name, mime_type: mime },
  }
}

function keyOf(attachment: Pick<StandardQuestionAttachment, 'file_md5' | 'filename'>): string {
  return `${attachment.file_md5}/${attachment.filename}`
}

function readableBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

export function QuestionAttachments(props: {
  attachments: readonly StandardQuestionAttachment[]
  editable?: boolean
  children?: ReactNode
  disabled?: boolean
  resolvePreview?: (attachment: StandardQuestionAttachment) => Promise<string | undefined>
  onUploadFiles?: (files: readonly File[]) => Promise<void>
  onChange?: (attachments: readonly StandardQuestionAttachment[]) => void
}): ReactElement | null {
  const { t } = usePanelI18n()
  const input = useRef<HTMLInputElement>(null)
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [failedPreviews, setFailedPreviews] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<{ key: PanelMessageKey; values?: Record<string, string | number> } | { message: string } | null>(null)

  useEffect(() => {
    if (props.resolvePreview === undefined) return
    let cancelled = false
    const candidates = props.attachments.filter(item => item.mime_type.startsWith('image/') && previews[keyOf(item)] === undefined)
    if (candidates.length === 0) return
    void Promise.all(candidates.map(async item => [keyOf(item), await props.resolvePreview?.(item)] as const)).then(entries => {
      if (cancelled) return
      const resolved = entries.filter((entry): entry is readonly [string, string] => typeof entry[1] === 'string')
      if (resolved.length > 0) setPreviews(current => ({ ...current, ...Object.fromEntries(resolved) }))
    }).catch(() => { if (!cancelled) setError({ key: 'questionAttachmentPreviewUnavailable' }) })
    return () => { cancelled = true }
  }, [previews, props.attachments, props.resolvePreview])

  const choose = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    if (files.length === 0 || props.onUploadFiles === undefined) return
    if (files.length + props.attachments.length > QUESTION_MAX_ATTACHMENTS) {
      setError({ key: 'attachmentLimit', values: { count: QUESTION_MAX_ATTACHMENTS } })
      return
    }
    setError(null)
    setUploading(true)
    try { await props.onUploadFiles(files) } catch (failure) {
      if (failure instanceof Error && 'code' in failure && failure.code === 'QUESTION_ATTACHMENT_SIZE'
        && 'filename' in failure && typeof failure.filename === 'string') {
        setError({ key: 'questionAttachmentSizeLimit', values: { filename: failure.filename } })
      } else setError(failure instanceof Error ? { message: failure.message } : { key: 'questionAttachmentReadFailed' })
    } finally { setUploading(false) }
  }

  if (props.attachments.length === 0 && (!props.editable || props.onUploadFiles === undefined)) return props.children ? <>{props.children}</> : null
  return (
    <div className='dsh-question-attachments' data-testid='question-answer-attachments'>
      {props.attachments.length > 0 ? <div className='dsh-question-attachment-list'>
        {props.attachments.map(attachment => {
          const key = keyOf(attachment)
          const resolvedPreview = previews[key]
          const preview = resolvedPreview && failedPreviews[key] !== resolvedPreview ? resolvedPreview : undefined
          const previewable = ['image/png', 'image/jpeg', 'image/webp'].includes(attachment.mime_type)
          return <div className={`dsh-question-attachment ${previewable ? 'is-image' : 'is-file'}`} key={key} title={attachment.filename}>
            {previewable && preview
              ? <img src={preview} alt={attachment.filename} onError={() => { setFailedPreviews(current => ({ ...current, [key]: preview })) }} />
              : <span className='dsh-question-attachment-icon' aria-hidden='true'>{attachment.mime_type.startsWith('image/') ? '▧' : '▤'}</span>}
            <span className={`dsh-question-attachment-name${previewable && preview ? ' dsh-question-visually-hidden' : ''}`}>{attachment.filename}</span>
            {!previewable ? <span className='dsh-question-attachment-size'>{readableBytes(attachment.size_bytes)}</span> : null}
            {props.editable && !props.disabled && props.onChange
              ? <button type='button' aria-label={t('questionAttachmentRemove', { filename: attachment.filename })} onClick={() => { props.onChange?.(props.attachments.filter(candidate => keyOf(candidate) !== key)) }}><svg viewBox='0 0 20 20' aria-hidden='true' focusable='false'><path d='m5 5 10 10M15 5 5 15' /></svg></button>
              : null}
          </div>
        })}
      </div> : null}
      {error ? <p className='dsh-question-attachment-error' role='alert'>{'key' in error ? t(error.key, error.values) : error.message}</p> : null}
      {props.editable && props.onUploadFiles ? <>
        <input ref={input} hidden type='file' multiple disabled={props.disabled || uploading || props.attachments.length >= QUESTION_MAX_ATTACHMENTS} onChange={event => { void choose(event) }} />
        <div className='dsh-question-attachment-controls'>
          {props.children ? <div className='dsh-question-attachment-answer'>{props.children}</div> : <span className='dsh-question-attachment-answer' />}
          <button
          className='dsh-question-attachment-add'
          type='button'
          aria-label={uploading ? t('questionAttachmentReading') : t('questionAttachmentAdd')}
          title={t('questionAttachmentHint', { count: QUESTION_MAX_ATTACHMENTS })}
          disabled={props.disabled || uploading || props.attachments.length >= QUESTION_MAX_ATTACHMENTS}
          onClick={() => { input.current?.click() }}
        >
          {uploading
            ? <span className='dsh-question-attachment-loading' aria-hidden='true'>…</span>
            : (
              <svg viewBox='0 0 20 20' aria-hidden='true' focusable='false'>
                <path d='m7.15 10.95 4.9-4.9a2.45 2.45 0 0 1 3.46 3.47l-6.17 6.17a4 4 0 0 1-5.66-5.66l6.1-6.1' />
              </svg>
            )}
        </button></div>
      </> : props.children}
    </div>
  )
}

export function previewFromArtifact(
  attachment: StandardQuestionAttachment,
  pending: readonly PendingDeclarativeArtifact[],
  readBinaryArtifact?: (path: string) => Promise<BinaryArtifactRead>,
  bundle?: string,
): Promise<string | undefined> {
  const queued = pending.find(item => item.file_md5 === attachment.file_md5 && item.filename === attachment.filename)
  if (queued) return Promise.resolve(`data:${queued.mime_type};base64,${queued.content}`)
  const legacyPath = bundle && /^[a-zA-Z0-9_-]+$/.test(bundle) && /^[0-9a-f]{32}$/.test(attachment.file_md5)
    && ['image/png', 'image/jpeg', 'image/webp'].includes(attachment.mime_type)
    ? `${bundle}/attachments/${attachment.file_md5}.${extensionFor(attachment.mime_type)}` : undefined
  const path = attachment.artifact_file ?? legacyPath
  if (!path || !readBinaryArtifact) return Promise.resolve(undefined)
  return readBinaryArtifact(path).then(result => result.found ? `data:${result.mediaType};base64,${result.base64}` : undefined)
}
