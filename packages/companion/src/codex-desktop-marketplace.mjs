/** Prepare only the personal catalog; installation remains a native UI action. */
import { parseArgs } from 'node:util'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { planCodexDesktopMarketplace, saveCodexDesktopMarketplacePlan, applyCodexDesktopMarketplace } from './npm-installer-codex.mjs'

const { values } = parseArgs({ options: { 'receipt-dir': { type: 'string' }, 'previous-receipt': { type: 'string' }, plan: { type: 'string' }, apply: { type: 'boolean' } } })
if (!values['receipt-dir']) throw Error('--receipt-dir outside the plugin closure is required')
const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const receiptDirectory = resolve(values['receipt-dir'])
if (values.apply) {
  if (values['previous-receipt']) throw Error('--apply uses the saved plan previous receipt; do not choose another')
  if (!values.plan) throw Error('--apply requires the exact saved --plan file')
  const plan = JSON.parse(await readFile(resolve(values.plan), 'utf8'))
  if (plan.source !== pluginRoot) throw Error('Desktop plan belongs to another plugin closure')
  const receipt = await applyCodexDesktopMarketplace(plan, { receiptDirectory })
  console.log(JSON.stringify({ selector: receipt.selector, version: receipt.version,
    action: receipt.action,
    marketplacePath: receipt.marketplacePath, receiptPath: receipt.receiptPath,
    marketplacePrepared: true, hostRegistered: false, installed: false, loaded: false, next: receipt.next }))
} else {
  if (values.plan) throw Error('--plan is only accepted with --apply')
  const plan = await planCodexDesktopMarketplace({ pluginRoot, previousReceipt: values['previous-receipt'] })
  const planPath = await saveCodexDesktopMarketplacePlan(plan, { receiptDirectory })
  console.log(JSON.stringify({ selector: plan.selector, version: plan.version, source: plan.source,
    sourceSha256: plan.sourceSha256, marketplacePath: plan.marketplacePath, entry: plan.entry,
    action: plan.action, changes: plan.changes, previousReceipt: plan.previousReceipt,
    planSha256: plan.planSha256, planPath, hostRegistered: false, installed: false, loaded: false }))
}
