/** Qoder adapter for the shared native Hook inbox. */
import { createNativeHookTransport } from './native-hook-transport.mjs'
import { nativeQoderHookProcess, qoderProcess } from './qoder-connection.mjs'
export const QODER_NOTICE_FILE = '.design-system-qoder-notify'
const transport = createNativeHookTransport({ host: 'qoder', label: 'Qoder', noticeFile: QODER_NOTICE_FILE,
  inspectProcess: async pid => { const result = await qoderProcess(pid); return { ...result, supported: result.qoder } },
  nativeHookProcess: nativeQoderHookProcess })
export const createQoderHookConnection = transport.createConnection
export const receiveQoderHook = transport.receiveHook
export const registerQoderHook = transport.registerHook
