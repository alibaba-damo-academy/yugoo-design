#!/usr/bin/env node
/** Smart Question panel prepares local Bundle artifacts without persisting transport bytes. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const { register } = await import('tsx/esm/api')
register()

const {
  prepareSmartQuestionsPanelSave,
  smartQuestionAttachmentPath,
} = await import('./src/client/panels/smart-question-attachments.ts')

const bytes = Buffer.from('arbitrary attachment content\n')
const digest = createHash('sha256').update(bytes).digest('hex')
const compatibilityDigest = digest.slice(0, 32)
const artifactPath = smartQuestionAttachmentPath(digest, 'application/octet-stream')
const attachment = {
  type: 'file',
  file_md5: compatibilityDigest,
  filename: 'requirements.anything',
  mime_type: 'application/octet-stream',
  size_bytes: bytes.byteLength,
  artifact_file: artifactPath,
}
const prepared = prepareSmartQuestionsPanelSave({
  questions: {
    visual_reference: {
      prompt: '请上传参考文件',
      kind: 'text',
      multimodal_answer: [attachment],
    },
  },
  pending_multimodal_uploads: [{
    ...attachment,
    question_id: 'visual_reference',
    client_digest: compatibilityDigest,
    base64: bytes.toString('base64'),
  }],
})

assert.equal(prepared.state.pending_multimodal_uploads, undefined, 'transport bytes never enter canonical JSON')
assert.equal(prepared.state.questions.visual_reference.multimodal_answer[0].artifact_file, artifactPath)
assert.deepEqual(prepared.artifacts, [{ path: artifactPath, content: bytes.toString('base64'), encoding: 'base64' }])
assert.throws(() => prepareSmartQuestionsPanelSave({
  questions: { visual_reference: { prompt: 'missing ref', kind: 'text', multimodal_answer: [] } },
  pending_multimodal_uploads: [{
    ...attachment,
    question_id: 'visual_reference',
    client_digest: compatibilityDigest,
    base64: bytes.toString('base64'),
  }],
}), /no longer referenced/)

console.log('SMART QUESTION LOCAL ATTACHMENTS OK')
