/** Companion adapter over the shared Studio feedback and theme. No Host or data operations. */
import { Component, type ReactNode } from 'react'
import { StudioFeedback } from '../../studio-ui/src/StudioFeedback.tsx'
import { LoadingIndicator } from '../../studio-ui/src/LoadingIndicator.tsx'
import { STUDIO_WORKSPACE_CSS } from '../../studio-ui/src/styles.ts'

export function StudioEntryFeedback({ error, onRetry, onOpenCatalog, locale = 'zh' }: {
  error?: string; onRetry?: () => void; onOpenCatalog?: () => void; locale?: 'zh' | 'en'
}) {
  const zh = locale === 'zh'
  return <div className="ygd-studio-workspace"><style>{STUDIO_WORKSPACE_CSS}</style><main className="ygd-studio-main">
    {error ? <StudioFeedback feedbackId={`studio-entry:${error}`} tone="error" autoOpen={false} locale={locale}
      title={zh ? '暂时无法打开修改建议' : 'The proposed changes could not be opened'}
      message={zh ? '请核对原对话的连接后重试，或返回 Studio 目录。已保存内容不受影响。' : 'Check the original conversation connection and retry, or return to the Studio catalog. Saved content is unchanged.'}
      details={[{ message: error }]} actions={[
        ...(onRetry ? [{ label: zh ? '重新核对连接' : 'Check connection again', onClick: onRetry, primary: true }] : []),
        ...(onOpenCatalog ? [{ label: zh ? '打开 Studio 目录' : 'Open Studio catalog', onClick: onOpenCatalog }] : []),
      ]} /> : <LoadingIndicator label={zh ? '正在核对原对话的工作副本' : 'Checking the working copy in its original conversation'} />}
  </main></div>
}

export class StudioExampleBoundary extends Component<{ children: ReactNode; locale: 'zh' | 'en'; exampleId: string }, { error?: string }> {
  state: { error?: string } = {}
  static getDerivedStateFromError(error: unknown) { return { error: (error instanceof Error ? error.message || error.name : String(error)) || 'Unknown component example error.' } }
  render() {
    if (!this.state.error) return this.props.children
    const zh = this.props.locale === 'zh'
    return <StudioFeedback feedbackId={`example:${this.props.exampleId}:${this.state.error}`} tone="error" autoOpen={false} locale={this.props.locale}
      title={zh ? '组件示例暂时无法显示' : 'The component example could not be displayed'}
      message={zh ? '仅此示例受到影响。你仍可查看组件的声明与用法，也可重新载入示例。' : 'Only this example is affected. You can still read its declaration and usage, or reload the example.'}
      details={[{ message: this.state.error }]}
      actions={[{ label: zh ? '重新载入示例' : 'Reload example', onClick: () => this.setState({ error: undefined }), primary: true }]} />
  }
}
