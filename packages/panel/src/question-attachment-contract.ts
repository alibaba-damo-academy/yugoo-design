/** Attachment transport data shared by the Host save boundary and browser UI. */
export const QUESTION_MAX_ATTACHMENTS = 5
export const QUESTION_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const DECLARATIVE_PANEL_ARTIFACTS_KEY = '__dsh_panel_artifacts'

export interface StandardQuestionAttachment {
  type: 'file' | 'image'
  file_md5: string
  filename: string
  mime_type: string
  size_bytes: number
  artifact_file?: string
}

/** Browser-only bytes; stripped before schema validation and atomic Panel Save. */
export interface PendingDeclarativeArtifact {
  path: string
  content: string
  encoding: 'base64'
  question_id: string
  file_md5: string
  filename: string
  mime_type: string
}
