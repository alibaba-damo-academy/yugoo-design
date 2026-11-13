/** Shared import feedback and direct ZIP export. */
import type { DesignKitVersionPin, StudioContentArchive } from 'dsh-design-studio'
import { STUDIO_ARCHIVE_MAX_JSON_BYTES } from 'dsh-design-studio/types'
import { encodeStudioContentZip } from './content-zip.ts'

export interface StudioInstanceExportTarget { id: string; expectedRevision: number; title: string }
export type StudioContentExportInput = { provenance?: { source?: string; license?: string } } & (
  | { kind: 'kit' | 'bundle'; pin: DesignKitVersionPin; id?: never; expectedRevision?: never }
  | { id: string; expectedRevision: number; kind?: never; pin?: never }
)
export interface StudioContentClient {
  export(input: StudioContentExportInput): Promise<string>
  readArchive(input: { source: string }): Promise<StudioContentArchive>
}
const ARCHIVE_BYTES = STUDIO_ARCHIVE_MAX_JSON_BYTES
/** Presentation only: preserve the validator's detail without exposing its virtual root. */
export function formatStudioImportError(error: string, locale: 'zh' | 'en'): string {
  const detail = error.replaceAll('/studio-content-archive-virtual/', '')
  const lines = detail.split('\n').map(line => {
    if (/^Invalid ZIP archive:/i.test(line)) return locale === 'zh' ? '所选文件不是有效的 ZIP 压缩包，请检查文件格式。' : line
    const missing = line.match(/^Missing required file: (.+)$/i) ?? line.match(/^[^\n]*?: missing (?:[^\n]*? )?file (.+)$/i)
    if (missing) return locale === 'zh' ? `缺少必需文件：${missing[1]}` : `Missing required file: ${missing[1]}`
    return line
  }).join('\n')
  return locale === 'zh'
    ? `导入失败：${lines}\n请检查文件后重新导入。`
    : `Import failed: ${lines}\nCheck the file and import it again.`
}
/** Match the archive reader's content limit; host RPC envelopes are host-owned. */
export function assertStudioImportRequestSize(source: string): void {
  if (new TextEncoder().encode(source).byteLength > ARCHIVE_BYTES) throw Error('Archive JSON exceeds 64 MiB. No content was truncated or sent.')
}

/** Download the exact saved content. Export never requests metadata from the user. */
export function downloadStudioContent(source: string, filename: string): void {
  assertStudioImportRequestSize(source)
  const zip = encodeStudioContentZip(source)
  if (zip.byteLength > ARCHIVE_BYTES) throw Error('ZIP exceeds the 64 MiB transport limit.')
  const url = URL.createObjectURL(new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }))
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${filename}.zip`.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
    anchor.click()
  } finally { URL.revokeObjectURL(url) }
}
