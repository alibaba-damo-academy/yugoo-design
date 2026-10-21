/** Only a confirmed normal delivery can dismiss itself; recovery stays visible. */
export function notificationAutoDismiss(result) {
  return result?.accepted === true && ['user_input_accepted', 'queued'].includes(result.status)
}

export function requireNotificationAccepted(result, hostLabel) {
  if (result?.accepted === true && result.status === 'submitted_unverified') return `${hostLabel} 消息接口已接收；请在原会话确认回复，不要重复发送。`
  if (result?.accepted === true && result.status === "user_input_accepted") return `${hostLabel} 已接收用户消息；请等待原会话回复。`
  if (result?.accepted === true && result.status === 'queued_for_resume') return `通知已保留，等待 ${hostLabel} 原会话恢复；请在原会话发一条消息，恢复后会读取待处理事件。无需再次保存。`
  if (result?.accepted === true && hostLabel === 'QwenWork') return '这是事件通知，尚未作为用户消息提交；请回到 QwenWork 原会话继续。若需自动发送，请以桌面输入模式重开面板。'
  if (result?.accepted === true && result.status === 'hook_received') return `${hostLabel} 原生 Hook 已接收通知；不表示 Agent 已执行或完成。`
  if (result?.accepted === true) return `${hostLabel} 已将通知入队；这不表示 Agent 已开始或完成工作。`
  const statuses = {
    busy: '原会话正在处理任务，本条消息尚未提交。请等当前任务结束后再发送；已保存文件不受影响。',
    held: '通知等待原生审批。请在 Qoder 的 /peers 中处理；不要重复发送。',
    denied: '原生会话拒绝了通知；已保存文件不受影响。请检查原生接收策略。',
    expired: '原生通知审批已过期；已保存文件不受影响。',
    unavailable: '原生会话当前不可连接；已保存文件不受影响。',
    unknown: '通知送达未确认。请先核对原生会话，不能认为未收到，也不要盲目重发。',
  }
  throw new Error(statuses[result?.status] ?? statuses.unknown)
}
