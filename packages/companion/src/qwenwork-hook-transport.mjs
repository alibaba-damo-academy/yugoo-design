/** QwenWork uses the shared notification protocol with its own native identity. */
import { createNativeHookTransport } from './native-hook-transport.mjs'
import { nativeQwenWorkHookProcess, qwenworkProcess } from './qwenwork-connection.mjs'
export const QWENWORK_NOTICE_FILE = '.design-system-qwenwork-notify'
const transport = createNativeHookTransport({ host: 'qwenwork', label: 'QwenWork', noticeFile: QWENWORK_NOTICE_FILE,
  inspectProcess: qwenworkProcess, nativeHookProcess: nativeQwenWorkHookProcess,
  registrationEvents: ['SessionStart', 'PostToolUse'], requireTranscript: true, resumeEvents: ['SessionStart', 'PostToolUse'] })
export const createQwenWorkHookConnection = transport.createConnection
export const receiveQwenWorkHook = transport.receiveHook
export const registerQwenWorkHook = transport.registerHook
