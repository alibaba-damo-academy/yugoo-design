import { useEffect, useRef, useState, type ChangeEvent, type ReactElement, type ReactNode } from 'react'
import { File, ImageIcon, Loader2, Paperclip, X } from 'lucide-react'
import {
  SMART_QUESTION_MAX_ATTACHMENT_BYTES,
  SMART_QUESTION_MAX_ATTACHMENTS,
  isSmartQuestionPreviewImage,
} from '../../../panels/smart-question-attachments.ts'
import type { IMultimodalAnswer } from './types.ts'

interface Props {
  images: readonly IMultimodalAnswer[]
  disabled?: boolean
  editable?: boolean
  resolvePreview?: (attachment: IMultimodalAnswer) => Promise<string | undefined>
  onUploadFiles?: (files: readonly File[]) => Promise<void>
  onChange?: (attachments: readonly IMultimodalAnswer[]) => void
  /** Answer control sharing the final row with the compact attachment button. */
  children?: ReactNode
}

function attachmentKey(attachment: IMultimodalAnswer): string {
  return `${attachment.file_md5}/${attachment.filename}`
}

function formattedSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

/** Local filesystem-backed answer attachments with image previews and removal. */
export function QuestionImageAttachments({
  images: attachments,
  disabled = false,
  editable = false,
  resolvePreview,
  onUploadFiles,
  onChange,
  children,
}: Props): ReactElement | null {
  const inputRef = useRef<HTMLInputElement>(null)
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (resolvePreview === undefined) return
    let cancelled = false
    const unresolved = attachments.filter((attachment) => isSmartQuestionPreviewImage(attachment.mime_type)
      && previewUrls[attachmentKey(attachment)] === undefined)
    if (unresolved.length === 0) return
    void Promise.all(unresolved.map(async (attachment) => [attachmentKey(attachment), await resolvePreview(attachment)] as const))
      .then((entries) => {
        if (cancelled) return
        const resolved = entries.filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
        if (resolved.length === 0) return
        setPreviewUrls((current) => ({ ...current, ...Object.fromEntries(resolved) }))
      })
      .catch(() => { if (!cancelled) setError('附件预览暂时不可用') })
    return () => { cancelled = true }
  }, [attachments, previewUrls, resolvePreview])

  const selectFiles = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const selected = [...(event.target.files ?? [])]
    event.target.value = ''
    if (selected.length === 0 || onUploadFiles === undefined) return
    const remaining = SMART_QUESTION_MAX_ATTACHMENTS - attachments.length
    if (remaining <= 0 || selected.length > remaining) {
      setError(`每个回答最多上传 ${SMART_QUESTION_MAX_ATTACHMENTS} 个附件`)
      return
    }
    for (const file of selected) {
      if (file.size <= 0 || file.size > SMART_QUESTION_MAX_ATTACHMENT_BYTES) {
        setError(`附件 ${file.name} 必须大于 0 且不超过 10 MiB`)
        return
      }
    }
    setError(null)
    setUploading(true)
    try {
      await onUploadFiles(selected)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '附件读取失败')
    } finally {
      setUploading(false)
    }
  }

  const hasAnswerControl = children !== undefined && children !== null
  if (attachments.length === 0 && !hasAnswerControl && (!editable || onUploadFiles === undefined)) return null
  return (
    <div className='space-y-2' data-testid='question-answer-attachments'>
      {attachments.length > 0
        ? (
          <div className='flex flex-wrap items-center gap-2'>
            {attachments.map((attachment) => {
              const key = attachmentKey(attachment)
              const preview = previewUrls[key]
              const previewable = isSmartQuestionPreviewImage(attachment.mime_type)
              return (
                <div
                  key={key}
                  className={previewable
                    ? 'group/attachment relative h-16 w-16 overflow-hidden rounded-lg border border-[var(--ds-line-1)] bg-[var(--ds-fill-2)]'
                    : 'group/attachment relative flex h-10 max-w-full items-center gap-2 rounded-lg border border-[var(--ds-line-1)] bg-[var(--ds-fill-2)] px-2 pr-8'}
                  title={attachment.filename}
                >
                  {previewable
                    ? (preview === undefined
                        ? <div className='flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-[10px] text-[var(--ds-text-tertiary)]'><ImageIcon className='size-4' /><span className='max-w-full truncate'>{attachment.filename}</span></div>
                        : <img src={preview} alt={attachment.filename} className='h-full w-full object-cover' />)
                    : <><File className='size-4 shrink-0 text-[var(--ds-text-tertiary)]' /><span className='min-w-0 truncate text-xs text-[var(--ds-text-secondary)]'>{attachment.filename}</span><span className='shrink-0 text-[10px] text-[var(--ds-text-tertiary)]'>{formattedSize(attachment.size_bytes)}</span></>}
                  {editable && !disabled && onChange !== undefined
                    ? (
                      <button
                        type='button'
                        aria-label={`移除附件 ${attachment.filename}`}
                        className={previewable
                          ? 'absolute right-0 top-0 rounded-bl-md bg-black/65 p-1 text-white opacity-100 md:opacity-0 md:group-hover/attachment:opacity-100 md:group-focus-within/attachment:opacity-100'
                          : 'absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--ds-text-tertiary)] hover:bg-[var(--ds-fill-4)] hover:text-[var(--ds-text-primary)]'}
                        onClick={() => { onChange(attachments.filter((candidate) => attachmentKey(candidate) !== key)) }}
                      >
                        <X className='size-3.5' />
                      </button>
                    )
                    : null}
                </div>
              )
            })}
          </div>
        )
        : null}
      {editable && onUploadFiles !== undefined
        ? (
          <>
            {error === null ? null : <p className='text-xs text-[var(--ds-error-text-primary)]' role='alert'>{error}</p>}
            <div className='flex min-h-8 items-end gap-1'>
              {!hasAnswerControl ? <span className='flex-1' /> : <div className='min-w-0 flex-1'>{children}</div>}
            <input
              ref={inputRef}
              className='hidden'
              type='file'
              multiple
              disabled={disabled || uploading || attachments.length >= SMART_QUESTION_MAX_ATTACHMENTS}
              onChange={(event) => { void selectFiles(event) }}
            />
            <button
              type='button'
              aria-label='添加附件'
              title={`添加附件，支持任意文件类型；最多 ${SMART_QUESTION_MAX_ATTACHMENTS} 个，每个不超过 10 MiB`}
              disabled={disabled || uploading || attachments.length >= SMART_QUESTION_MAX_ATTACHMENTS}
              className='inline-flex size-8 shrink-0 items-center justify-center rounded-md text-[var(--ds-text-secondary)] transition-colors hover:bg-[var(--ds-fill-3)] hover:text-[var(--ds-brand-8)] disabled:cursor-not-allowed disabled:opacity-50'
              onClick={() => { inputRef.current?.click() }}
            >
              {uploading ? <Loader2 className='size-4 animate-spin' /> : <Paperclip className='size-4' />}
            </button>
            </div>
          </>
        )
        : <>{children}{error === null ? null : <p className='text-xs text-[var(--ds-error-text-primary)]' role='alert'>{error}</p>}</>}
    </div>
  )
}
