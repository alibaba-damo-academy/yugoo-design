#!/usr/bin/env node
/**
 * Design dock chrome contract: one Chrome-style tab strip replaces the old
 * "Design" header row — tabs look like browser tabs (rounded top corners,
 * active tab merges into the content below), the + follows the last tab
 * inside the scroll region, and the × closes the dock from the strip's
 * far right.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const styles = await readFile(new URL('./src/client/styles.ts', import.meta.url), 'utf8')
const tabs = await readFile(new URL('./src/client/ported/design/DesignTabsBar.tsx', import.meta.url), 'utf8')
const workspace = await readFile(new URL('./src/client/workspace.tsx', import.meta.url), 'utf8')
const index = await readFile(new URL('./src/client/index.tsx', import.meta.url), 'utf8')

assert.match(styles, /--dsh-host-secondary-nav-height:32px/)
assert.doesNotMatch(styles, /dsh-design-dock-header/, 'the tall Design title header is gone')
assert.match(styles, /\.dsh-design-tabs\{[^}]*align-items:flex-end[^}]*background:var\(--ds-fill-3\)[^}]*padding:6px 6px 0/)
assert.match(styles, /\.dsh-design-tab\{[^}]*border-radius:8px 8px 0 0/)
assert.match(styles, /\.dsh-design-tab\[data-state=active\]\{background:#fff/)
assert.match(styles, /\.dsh-design-dock-close\{[^}]*border-radius:50%/)
assert.match(tabs, /data-testid='chat-design-tabs'[\s\S]*?'dsh-design-tabs'/)
assert.match(tabs, /className='dsh-design-tabs-scroll'/)
assert.match(tabs, /'dsh-design-tab'/)
// + 紧跟最后一个 tab：按钮在滚动区内部，而不是条右端常驻。
assert.match(tabs, /dsh-design-tabs-scroll'[\s\S]*?data-testid='chat-design-tabs-add'/)
assert.doesNotMatch(tabs, /右侧固定 \+ 按钮/)
assert.match(workspace, /data-testid='dsh-design-dock-close'/)
assert.match(workspace, /onClose\?: \(\) => void/)
assert.doesNotMatch(index, /dsh-design-dock-header/, 'dock no longer renders its own title header')
assert.match(
  index,
  /<style>\{DESIGN_TW_CSS\}<\/style>\s*<style>\{DOCK_CSS\}<\/style>\s*<style>\{ICONFONT_CSS\}<\/style>/,
  'the dock must inject scoped Tailwind first, dock chrome second, and icon styles last',
)
assert.match(index, /onClose=\{\(\) => \{ closeDesignDock\(info\.sessionId\) \}\}/)
assert.match(index, /function openDesignDock\([\s\S]*?setRailWidth\(prepareDesignLayout\(\)\)/)
assert.match(index, /snap\.open \? closeDesignDock\(info\.sessionId\) : openDesignDock\(info\.sessionId\)/, 'manual and automatic opening must share the 70\/30 layout path')
assert.match(index, /new MutationObserver[\s\S]*?Any later Host or user transition supersedes our restore ownership/)
const reflow = index.slice(
  index.indexOf('const reconcileDockWidth = (): void => {'),
  index.indexOf('const scheduleReconcile = (): void => {'),
)
assert.match(reflow, /clampDockWidth\(snapshot\.width\)/,
  'an open dock must fit the current Host navigation after session restore or a later expansion')
assert.doesNotMatch(reflow, /prepareDesignLayout|toggleSidebar/,
  'Host reflow must preserve later navigation choices instead of repeating the opening policy')
assert.match(index, /sidebarObserver\?\.observe[\s\S]*?scheduleReconcile\(\)/,
  'Host layout reconciliation must run once on mount instead of waiting for a later resize')
assert.match(index, /releaseSidebarCollapseLease\(true\)/, 'dock close must restore only plugin-owned sidebar collapse')

console.log('DESIGN DOCK CHROME OK')
