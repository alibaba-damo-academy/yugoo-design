/** UI-only fixture. Never evidence of real native execution. */
import { createRoot } from 'react-dom/client'
import { BundleTrial } from '../src/BundleTrial.tsx'
import { STUDIO_WORKSPACE_CSS } from '../src/styles.ts'
import type { StudioTrialClient, StudioTrialRecord } from '../src/trial-controller.ts'
const source = { kind: 'installed' as const, kit: { name: 'sample-kit', version: '1' }, bundle: { name: 'sample-bundle', version: '1' } }
let record: StudioTrialRecord | undefined
const client: StudioTrialClient = {
  checkConnection: async () => ({ status: 'available' }), // fixture only, not native readiness
  list: async () => record ? [record] : [],
  start: async input => record = { id: 'ui-fixture-only', source: input.source, status: 'queued', sourceLabel: 'UI fixture · NOT native execution', projectLabel: 'UI fixture' },
  read: async () => { if (!record) throw new Error('Missing'); return record },
  stop: async () => { throw new Error('Fixture: host interruption unavailable') },
  remove: async () => { record = undefined },
}
createRoot(document.getElementById('root')!).render(<div className="ygd-studio-workspace"><style>{STUDIO_WORKSPACE_CSS}</style><main style={{ padding: 16, width: '100%' }}>
  <h2>试运行 UI 交互测试（模拟接口）</h2><BundleTrial client={client} source={source} locale="zh" />
</main></div>)
