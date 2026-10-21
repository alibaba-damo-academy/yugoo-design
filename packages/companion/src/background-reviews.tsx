import type { RecordedConversation } from './conversation.tsx'

export interface BackgroundReviews {
  reviews: { profile:string; status:string; revisionChanged?:boolean; scopeChanged?:boolean; error?:string; executionAvailability?:string; executionMode?:string }[]
  rows: RecordedConversation['rows']
}
const names: Record<string,string> = { grounding:'事实一致性', reflection:'反思评审', alignment:'意图对齐', clarity:'清晰度评估' }
const labels: Record<string,string> = { due:'待评估', prepared:'等待原生绑定', running:'后台运行中', completed:'已完成',
  unsubmitted:'子代理已结束，结果未提交', failed:'评审失败', interrupted:'已中断', unknown:'后台执行状态未知', unavailable:'原生状态暂不可读', stale:'结果已过期' }
const foregroundLabels: Record<string,string> = { prepared:'等待主对话同步评审', running:'主对话同步评审中', unknown:'同步评审状态未知', unsubmitted:'评审结果尚未提交', unavailable:'同步评审暂不可用' }

export function BackgroundReviewPanel({value,disconnected}:{value?:BackgroundReviews;disconnected:boolean}) {
  return <section aria-label="评审状态">
    <p>GRA 结果进入设计建议；U/S/T 由主对话评估。同步评审须经你确认，会占用主对话；此处不启动或重跑评审。</p>
    {disconnected && <p role="status">状态同步已断开，以下为上次记录。</p>}
    <ul className="companion-review-statuses">{(value?.reviews ?? []).map(review=><li key={review.profile}>
      <strong>{names[review.profile] ?? review.profile}</strong>
      <span>{!disconnected && review.status==='running' && <span className="companion-spinner" aria-hidden="true"/>}{(review.executionMode==='foreground' ? foregroundLabels[review.status] : undefined) ?? labels[review.status] ?? review.status}</span>
      {review.executionAvailability === 'unavailable' && <small>本次评审暂不可执行，已有记录保留。后台不可用时，可在原对话选择关闭自动评审，或确认本次同步检查；手动检查仍可用。</small>}
      {(review.revisionChanged || review.scopeChanged) && <small>依据或工作范围已变化</small>}
      {review.error && <small>{review.error}</small>}
    </li>)}</ul>
    {!value?.reviews.length && <p>暂无评审状态。</p>}
    <details><summary>后台操作记录 · {value?.rows.length ?? 0} 项</summary>
      <ul>{value?.rows.map(row=><li key={row.id}>{row.label} · {row.status}</li>)}</ul>
    </details>
  </section>
}
