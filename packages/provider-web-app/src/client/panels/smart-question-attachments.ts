/** Browser-side preparation for Smart Question local-file references. */
import type { NativePanelSaveArtifact } from 'dsh-design-panel/client-api'
import type {
  PendingSmartQuestionImageUpload,
  SmartQuestionImageAnswer,
  SmartQuestionsState,
} from '../types.ts'

export const SMART_QUESTION_MAX_ATTACHMENTS = 5
export const SMART_QUESTION_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const SMART_QUESTION_FALLBACK_MIME = 'application/octet-stream'

export function smartQuestionAttachmentMime(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase()
  return normalized !== '' && normalized.length <= 127 && /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(normalized)
    ? normalized
    : SMART_QUESTION_FALLBACK_MIME
}

export function isSmartQuestionPreviewImage(mimeType: string): boolean {
  return mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/webp'
}

export function smartQuestionAttachmentPath(contentDigest: string, mimeType?: string): string {
  if (!/^[0-9a-f]{64}$/u.test(contentDigest)) throw new Error('smart question attachment digest must be 64 lower-case hexadecimal characters')
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'attachment'
  return `smart_questions/attachments/${contentDigest}.${extension}`
}

export function legacySmartQuestionImagePath(contentDigest: string, mimeType: string): string {
  if (!/^[0-9a-f]{32}$/u.test(contentDigest)) throw new Error('legacy smart question attachment digest must be 32 lower-case hexadecimal characters')
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : undefined
  if (extension === undefined) throw new Error('legacy smart question attachment must be PNG, JPEG, or WebP')
  return `smart_questions/attachments/${contentDigest}.${extension}`
}

function uploadKey(upload: Pick<PendingSmartQuestionImageUpload, 'question_id' | 'client_digest' | 'filename'>): string {
  return `${upload.question_id}\0${upload.client_digest}\0${upload.filename}`
}

/** Remove browser-only bytes and hand them to generic Panel Save atomically. */
export function prepareSmartQuestionsPanelSave(draft: unknown): {
  readonly state: SmartQuestionsState
  readonly artifacts?: readonly NativePanelSaveArtifact[]
} {
  if (typeof draft !== 'object' || draft === null || Array.isArray(draft)) return { state: {} }
  const state = draft as SmartQuestionsState
  const pending = state.pending_multimodal_uploads ?? []
  const referenced = new Set<string>()
  for (const [questionId, question] of Object.entries(state.questions ?? {})) {
    for (const attachment of question.multimodal_answer ?? []) {
      referenced.add(uploadKey({ question_id: questionId, client_digest: attachment.file_md5, filename: attachment.filename }))
    }
  }
  const artifacts = pending.map((upload): NativePanelSaveArtifact => {
    if (!referenced.has(uploadKey(upload))) throw new Error(`attachment ${upload.filename} is no longer referenced by its question`)
    if (upload.artifact_file === undefined) throw new Error(`attachment ${upload.filename} has no local artifact path`)
    return { path: upload.artifact_file, content: upload.base64, encoding: 'base64' }
  })
  const prepared: SmartQuestionsState = { ...state }
  delete prepared.pending_multimodal_uploads
  return { state: prepared, ...(artifacts.length === 0 ? {} : { artifacts }) }
}

/** Stable identity used by the panel while a file is waiting for save. */
export function attachmentIdentity(attachment: Pick<SmartQuestionImageAnswer, 'file_md5' | 'filename'>): string {
  return `${attachment.file_md5}/${attachment.filename}`
}
