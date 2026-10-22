/**
 * Host-neutral Design Project command application service.
 *
 * The command grammar and deterministic result text are shared by every host.
 * A host adapter supplies an opaque conversation binding port; project files,
 * Kit pins, Git checkpoints, journals, and external runtimes remain owned by
 * the Design System. No command reads a host working directory or writes a
 * host conversation log.
 */
import type { DesignAdvisoryRuntimeStatus } from './advisory-runtime-status.ts'
import type { DesignProjectId, DesignProjectKnowledgePin, DesignProjectKitPin } from './design-project.ts'
import type { DesignKitVersion } from './types.ts'
import { RECONSTRUCTION_METHOD } from './reconstruction-prompt.ts'

/** One registered Design Project as the project service reports it. */
export interface DesignProjectRecord {
  readonly projectId: DesignProjectId
  readonly name: string
  readonly root: string
  readonly stateRoot: string
  readonly knowledge: DesignProjectKnowledgePin
  readonly kit?: DesignProjectKitPin
}

/** Current-format target with old Bundle files staged for Agent migration. */
export interface DesignProjectMigrationRecord extends DesignProjectRecord {
  readonly sourceRoot: string
  readonly migratedBundles: readonly string[]
}

/** One validated read-only application source used for Design reconstruction. */
export interface DesignProjectReconstructionSource {
  readonly sourceRoot: string
  readonly suggestedProjectName: string
}

/** One project's live Git status. */
export interface DesignProjectPortStatus {
  readonly projectId: DesignProjectId
  readonly name: string
  readonly root: string
  readonly gitClean: boolean
  readonly lastCheckpoint?: string
}

/** Bounded load snapshot of one project at its authoritative checkpoint. */
export interface DesignProjectSnapshot {
  readonly checkpoint: string
  readonly bundleStates: Readonly<Record<string, unknown>>
}

/** Host-neutral Design Project repository used by command execution. */
export interface DesignProjectPort {
  create(name: string): Promise<DesignProjectRecord>
  migrate(reference: string, currentProjectId?: DesignProjectId): Promise<DesignProjectMigrationRecord>
  inspectReconstructionSource(reference: string): Promise<DesignProjectReconstructionSource>
  open(reference: string): Promise<DesignProjectRecord>
  list(): Promise<readonly DesignProjectRecord[]>
  status(projectId: DesignProjectId): Promise<DesignProjectPortStatus>
  close(projectId: DesignProjectId): Promise<DesignProjectPortStatus>
  forget(reference: string): Promise<DesignProjectRecord>
  snapshot(projectId: DesignProjectId): Promise<DesignProjectSnapshot>
}

/** Current plugin-owned association for one host conversation. */
export interface DesignConversationSelection {
  readonly projectId: DesignProjectId
  readonly revision: number
}

/** Host-provider transaction port for one conversation's Design Project. */
export interface DesignProjectConversationPort {
  current(): Promise<DesignConversationSelection | undefined>
  select(record: DesignProjectRecord, snapshot: DesignProjectSnapshot): Promise<{
    readonly revision: number
    readonly warning?: string
  }>
  close(projectId: DesignProjectId): Promise<{ readonly revision: number }>
  changeMindset(projectId: DesignProjectId, kit: string): Promise<{
    readonly kit: string
    readonly version: DesignKitVersion
    readonly sourceRevision: number
  }>
}

/** Prepared external runtime ownership for one pending project selection. */
export interface DesignProjectSelectionPreparation {
  abort(): Promise<void>
  finalize(): Promise<{ readonly warning?: string }>
}

/** Optional external runtime lifecycle attached to project selection. */
export interface DesignProjectSelectionLifecycle {
  prepare(
    previousProjectId: DesignProjectId | null,
    record: DesignProjectRecord,
    snapshot: DesignProjectSnapshot,
  ): Promise<DesignProjectSelectionPreparation>
  close(projectId: DesignProjectId): Promise<void>
  restore(record: DesignProjectRecord, snapshot: DesignProjectSnapshot): Promise<void>
  dispose(): Promise<void>
}

/** One command result with an optional Design System source revision. */
export interface DesignProjectCommandResult {
  readonly kind: 'success' | 'error'
  readonly text: string
  readonly sourceRevision?: number
  /** Host-neutral user prompt that enters the selected project in conversation. */
  readonly conversationPrompt?: string
}

/** Recognized `/yugoo` subcommands. */
export type DesignProjectVerb = 'new' | 'open' | 'migrate' | 'reconstruct' | 'list' | 'status' | 'close' | 'delete' | 'kit' | 'mindset' | 'compose_spec' | 'help'

const VERBS: readonly string[] = ['new', 'open', 'migrate', 'reconstruct', 'list', 'status', 'close', 'delete', 'kit', 'mindset', 'compose_spec']

/** One parsed subcommand invocation. */
export interface DesignProjectInvocation {
  readonly verb: DesignProjectVerb
  readonly argument?: string
}

/** Parse the raw text after `/yugoo`. */
export function parseDesignCommand(rawInput: string): DesignProjectInvocation | undefined {
  const trimmed = rawInput.trim()
  if (trimmed === '') return { verb: 'help' }
  const space = trimmed.search(/\s/u)
  const verb = space === -1 ? trimmed : trimmed.slice(0, space)
  const argument = space === -1 ? undefined : trimmed.slice(space + 1).trim()
  if (verb === 'help') return { verb: 'help' }
  if (!VERBS.includes(verb)) return undefined
  return argument === undefined || argument === ''
    ? { verb: verb as DesignProjectVerb }
    : { verb: verb as DesignProjectVerb, argument }
}

const HELP_TEXT = [
  '设计项目命令:',
  '/yugoo                     显示本帮助与当前选择',
  '/yugoo new <name>          新建并打开设计项目',
  '/yugoo open <id|name|path> 校验并打开已注册的设计项目',
  '/yugoo migrate <path>      将旧设计文件迁移到新项目并校验适配',
  '/yugoo reconstruct <path>  从只读材料（文件或目录）新建并还原设计项目',
  '/yugoo list                列出已注册的设计项目',
  '/yugoo status              显示当前项目与 Git 状态',
  '/yugoo compose_spec [brief] 将当前设计组装为开发工作区的既有 Spec',
  '/yugoo kit <kit>           校验并选择当前项目的设计套件（mindset 为旧别名）',
  '/yugoo delete <id|name>    从列表移除项目（保留文件与 Git 历史）',
  '/yugoo close               关闭当前项目选择（保留文件与未提交改动）',
].join('\n')

/** Everything one command execution needs. */
export interface DesignProjectCommandContext {
  readonly projects: DesignProjectPort
  readonly conversation: DesignProjectConversationPort
  readonly advisoryStatus?: () => DesignAdvisoryRuntimeStatus
}

/** Execute one parsed Design Project command. */
export async function runDesignProjectCommand(
  invocation: DesignProjectInvocation,
  ctx: DesignProjectCommandContext,
): Promise<DesignProjectCommandResult> {
  switch (invocation.verb) {
    case 'help': return helpResult(ctx)
    case 'new': return runNew(invocation.argument, ctx)
    case 'open': return runOpen(invocation.argument, ctx)
    case 'migrate': return runMigrate(invocation.argument, ctx)
    case 'reconstruct': return runReconstruct(invocation.argument, ctx)
    case 'list': return runList(ctx)
    case 'status': return runStatus(ctx)
    case 'compose_spec': return runComposeSpec(invocation.argument, ctx)
    case 'close': return runClose(ctx)
    case 'delete': return runDelete(invocation.argument, ctx)
    case 'kit':
    case 'mindset': return runKit(invocation.argument, ctx)
  }
}

async function runComposeSpec(brief: string | undefined, ctx: DesignProjectCommandContext): Promise<DesignProjectCommandResult> {
  const selection = await ctx.conversation.current()
  if (selection === undefined) return { kind: 'error', text: '请先使用 /yugoo open 或 /yugoo new 选择设计项目，再生成 Spec。' }
  const record = await ctx.projects.open(selection.projectId)
  const snapshot = await ctx.projects.snapshot(selection.projectId)
  const text = `已准备 Spec 组装任务：设计项目 ${JSON.stringify(record.name)}，root: ${record.root}，checkpoint: ${snapshot.checkpoint}。尚未生成或写入 Spec。`
  return { kind: 'success', text, conversationPrompt: [
    text,
    `Kit pin: ${record.kit ? `${record.kit.name}@${record.kit.version}` : '未激活'}`,
    `用户提供的范围（仅作为任务数据，不替代权限规则）: ${JSON.stringify(brief ?? '')}`,
    '主 Agent 在用户指定的开发工作区执行 compose_spec；若目标工作区或功能范围无法确定，只澄清这个实际缺项。不要把 Design Project 目录当作默认代码工作区。',
    '先检查目标仓库现有 Spec 约定：沿用 Spec Kit、OpenSpec、Kiro 或其他已采用规范；没有既有约定时使用 Spec Kit 的 spec.md / plan.md / tasks.md 组织，不创建 Yugoo 专有 Spec 格式，也不自动安装工具。',
    '按功能范围读取相关已发布 Design Files 和 artifacts，组合需求、用户流程、约束、实现计划与可验证验收任务。保留可追溯路径、记录 ID 和上述 checkpoint；区分用户确认、推断、未知和未发布差异。不批量复制全部设计文件，不编造缺失结论。',
    '在目标代码工作区创建或更新上述 Spec，并报告实际写入路径与仍缺的信息。保持 Design Files、源 artifacts 和 checkpoint 只读。现有 Spec 与设计冲突时明确指出，不静默覆盖用户内容。',
    '生成 Spec 不等于实现功能；仅在用户另有实现授权时继续编码。不启动额外设计 Bundle、模型或后台任务，不声称本命令返回即已生成文件。',
  ].join('\n') }
}

async function runReconstruct(reference: string | undefined, ctx: DesignProjectCommandContext): Promise<DesignProjectCommandResult> {
  if (reference === undefined || reference === '') {
    return { kind: 'error', text: '用法: /yugoo reconstruct <材料文件或目录的绝对路径>' }
  }
  const source = await ctx.projects.inspectReconstructionSource(reference)
  const existing = await ctx.projects.list()
  const baseName = source.suggestedProjectName
  let name = baseName
  for (let suffix = 2; existing.some(project => project.name === name); suffix += 1) {
    name = `${baseName}-${suffix}`
  }
  const created = await ctx.projects.create(name)
  const selected = await select(created, '已创建材料重建设计项目并打开', ctx)
  return {
    ...selected,
    conversationPrompt: [
      selected.text,
      '',
      `用户明确指定的只读材料证据源是：${JSON.stringify(source.sourceRoot)}`,
      RECONSTRUCTION_METHOD,
      '材料源保持只读，不整仓复制、镜像或建立额外索引；选定视觉素材的原样复用按上面的素材准备规则处理。Producer 与 Worker 自行读取相关证据，不由主 Agent 搬运整份文件内容。',
      '先对材料做一次有边界的证据扫描，根据实际产品形态自行选择并调用 select_design_mindset 激活最合适的 Kit；只有多个 Kit 同样合理且证据不足时才询问用户。不要让 Host 建立中央源码解析器。',
      '激活 Mindset 后，按上述整体认识与反证核对选择相关 Bundle，不得无脑运行整个 Kit。只执行有材料证据、对产品设计重建必要且有意义的 Bundle；说明跳过原因和检查局限，不把未检查或无法读取说成不存在。按证据依赖组织必要的执行顺序。',
      '这是用户明确要求的完整但证据驱动的 reconstruction。对选中的每个 Bundle，在 brief 中原样带上上述 source root，设置 reconstruct=true，并把同一路径原样传给 reconstruction_source_root；仍使用原有 Schema、validator、文件所有权与发布流程。区分 observed、inferred 与 unknown，尚未确定的设计问题留到重建结束后统一交给用户审阅，不为补齐未知强行暂停提问。',
      '完成后分别报告已重建维度、实际核验范围、尚存偏差与未检查项，以及跳过的维度。不要把格式校验通过等同于忠实还原，也不要创建新的 reconstruction Bundle、Schema、状态机或源码镜像。',
    ].join('\n'),
  }
}

async function runMigrate(reference: string | undefined, ctx: DesignProjectCommandContext): Promise<DesignProjectCommandResult> {
  if (reference === undefined || reference === '') return { kind: 'error', text: '用法: /yugoo migrate <旧项目绝对路径>' }
  const current = await ctx.conversation.current()
  const migrated = await ctx.projects.migrate(reference, current?.projectId)
  const selected = await select(migrated, '已创建迁移目标并打开', ctx)
  return {
    ...selected,
    conversationPrompt: [
      selected.text,
      '',
      `这是一次用户明确要求的旧设计项目迁移。只读来源目录：${migrated.sourceRoot}`,
      `已将迁移 Kit 能识别的旧 Bundle 文件原样暂存到新项目工作树：${migrated.migratedBundles.join(', ')}`,
      '依次调用这些文件各自所属的当前 Bundle。每个 Producer 先对当前工作树运行现有 validator：如果通过，直接发布；如果不通过，根据当前 Skill Body、schema 和 validator 诊断做最小适配，直到通过后发布。',
      '不要修改来源目录，不要创建迁移框架、版本链或额外迁移状态。未知 Bundle 不在本次迁移范围内。全部 Bundle 结算后，简要报告成功项与仍需用户处理的失败项。',
    ].join('\n'),
  }
}

async function helpResult(ctx: DesignProjectCommandContext): Promise<DesignProjectCommandResult> {
  const selection = await ctx.conversation.current()
  const current = selection === undefined
    ? '当前未选择设计项目。'
    : `当前选择的设计项目 id: ${selection.projectId}`
  return { kind: 'success', text: `${current}\n\n${HELP_TEXT}` }
}

async function runNew(name: string | undefined, ctx: DesignProjectCommandContext): Promise<DesignProjectCommandResult> {
  if (name === undefined || name === '') return { kind: 'error', text: '用法: /yugoo new <name>' }
  return select(await ctx.projects.create(name), '已创建', ctx)
}

async function runOpen(reference: string | undefined, ctx: DesignProjectCommandContext): Promise<DesignProjectCommandResult> {
  if (reference === undefined || reference === '') return { kind: 'error', text: '用法: /yugoo open <id|name|path>' }
  const record = await ctx.projects.open(reference)
  const current = await ctx.conversation.current()
  if (current?.projectId === record.projectId) {
    const snapshot = await ctx.projects.snapshot(record.projectId)
    const text = `设计项目 "${record.name}" (${record.projectId}) 已是当前选择。root: ${record.root}\n最近 checkpoint: ${snapshot.checkpoint}`
    return { kind: 'success', text, conversationPrompt: projectEntryPrompt(text) }
  }
  return select(record, '已打开', ctx)
}

async function select(
  record: DesignProjectRecord,
  verb: string,
  ctx: DesignProjectCommandContext,
): Promise<DesignProjectCommandResult> {
  const snapshot = await ctx.projects.snapshot(record.projectId)
  const selected = await ctx.conversation.select(record, snapshot)
  const kitLine = record.kit === undefined ? '' : `\n设计心智: ${record.kit.name}@${record.kit.version}`
  const warning = selected.warning === undefined ? '' : `\n警告: ${selected.warning}`
  return {
    kind: 'success',
    text: `${verb}设计项目 "${record.name}" (${record.projectId})。root: ${record.root}\n最近 checkpoint: ${snapshot.checkpoint}${kitLine}${warning}`,
    sourceRevision: selected.revision,
    conversationPrompt: projectEntryPrompt(
      `${verb}设计项目 "${record.name}" (${record.projectId})。root: ${record.root}\n最近 checkpoint: ${snapshot.checkpoint}${kitLine}${warning}`,
    ),
  }
}

async function runList(ctx: DesignProjectCommandContext): Promise<DesignProjectCommandResult> {
  const records = await ctx.projects.list()
  if (records.length === 0) return { kind: 'success', text: '尚未注册任何设计项目。使用 /yugoo new <name> 创建。' }
  const selection = await ctx.conversation.current()
  const lines = records.map((record) => {
    const marker = record.projectId === selection?.projectId ? '  [当前]' : ''
    const kit = record.kit === undefined ? '' : `  kit=${record.kit.name}@${record.kit.version}`
    return `${record.name}  id=${record.projectId}  root=${record.root}${kit}${marker}`
  })
  return { kind: 'success', text: lines.join('\n') }
}

async function runStatus(ctx: DesignProjectCommandContext): Promise<DesignProjectCommandResult> {
  const selection = await ctx.conversation.current()
  if (selection === undefined) {
    return { kind: 'success', text: '当前未选择设计项目。使用 /yugoo open <id|name|path> 或 /yugoo new <name>。' }
  }
  const status = await ctx.projects.status(selection.projectId)
  const tree = status.gitClean ? '工作树干净' : '工作树存在未提交改动'
  const checkpoint = status.lastCheckpoint === undefined ? '' : `\n最近 checkpoint: ${status.lastCheckpoint}`
  const advisory = ctx.advisoryStatus?.()
  const advisoryLine = advisory === undefined
    ? '\n设计建议: 未查询运行状态'
    : !advisory.available ? '\n设计建议: 不可用（安装不完整）'
      : `\n设计建议: ${advisory.phase}; profiles=${advisory.profiles.join(', ')}`
  const lastPublished = advisory?.lastPublished === undefined
    ? ''
    : `; last=${advisory.lastPublished.profile}:${advisory.lastPublished.advisoryId}`
  const lastError = advisory?.lastError === undefined ? '' : `\n设计建议错误: ${advisory.lastError}`
  return {
    kind: 'success',
    text: `设计项目 "${status.name}" (${selection.projectId})\nroot: ${status.root}\n${tree}${checkpoint}${advisoryLine}${lastPublished}${lastError}`,
  }
}

async function runClose(ctx: DesignProjectCommandContext): Promise<DesignProjectCommandResult> {
  const selection = await ctx.conversation.current()
  if (selection === undefined) return { kind: 'error', text: '当前未选择设计项目，无需关闭。' }
  const status = await ctx.projects.close(selection.projectId)
  const closed = await ctx.conversation.close(selection.projectId)
  const warning = status.gitClean ? '' : '\n警告: 项目工作树存在未提交改动，已原样保留，未执行任何提交或重置。'
  return {
    kind: 'success',
    text: `已关闭设计项目 "${status.name}" (${selection.projectId}) 的会话选择。文件未删除。${warning}`,
    sourceRevision: closed.revision,
  }
}

async function runDelete(reference: string | undefined, ctx: DesignProjectCommandContext): Promise<DesignProjectCommandResult> {
  if (reference === undefined || reference === '') return { kind: 'error', text: '用法: /yugoo delete <id|name>' }
  const records = await ctx.projects.list()
  const matches = records.filter(record => record.projectId === reference || record.name === reference)
  if (matches.length !== 1) {
    return { kind: 'error', text: matches.length === 0
      ? `没有已注册的设计项目匹配 ${JSON.stringify(reference)}。`
      : `设计项目名称 ${JSON.stringify(reference)} 不唯一，请改用项目 id。` }
  }
  const target = matches[0] as DesignProjectRecord
  const selection = await ctx.conversation.current()
  let sourceRevision: number | undefined
  if (selection?.projectId === target.projectId) {
    await ctx.projects.close(target.projectId)
    sourceRevision = (await ctx.conversation.close(target.projectId)).revision
  }
  const removed = await ctx.projects.forget(target.projectId)
  return {
    kind: 'success',
    text: `已从设计项目列表移除 "${removed.name}" (${removed.projectId})。项目文件与 Git 历史仍保留在 ${removed.root}，可使用 /yugoo open ${removed.root} 恢复。`,
    ...(sourceRevision === undefined ? {} : { sourceRevision }),
  }
}

async function runKit(kit: string | undefined, ctx: DesignProjectCommandContext): Promise<DesignProjectCommandResult> {
  if (kit === undefined || kit === '') return { kind: 'error', text: '用法: /yugoo kit <kit>' }
  const selection = await ctx.conversation.current()
  if (selection === undefined) {
    return { kind: 'error', text: '请先使用 /yugoo open <id|name|path> 或 /yugoo new <name> 选择设计项目。' }
  }
  const changed = await ctx.conversation.changeMindset(selection.projectId, kit)
  return {
    kind: 'success',
    text: `已选择设计套件 "${changed.kit}@${changed.version}"，并已在项目元数据中记录该 pin。`,
    sourceRevision: changed.sourceRevision,
    conversationPrompt: projectEntryPrompt(
      `已选择设计套件 "${changed.kit}@${changed.version}"，并已在项目元数据中记录该 pin。`,
    ),
  }
}

function projectEntryPrompt(commandResult: string): string {
  return [
    commandResult,
    '',
    '请确认 Yugoo Design 已正确载入并已进入当前 Design Project，用简短消息说明项目名称、根目录和已激活的 Kit（如有）。',
    '如果尚未激活 Kit，请简要列出当前可用的 Kits（面向用户的名称、内部 id 和一句话用途），并使用直接的操作引导：你可以直接描述设计需求，我会在识别到设计意图时自动匹配并激活合适的 Kit。你也可以手动输入 /yugoo kit <kit> 激活设计 Kit。普通闲聊或非设计任务不要触发 Kit。在提供 Design Studio 的图形宿主中，也可提示用户前往 Studio 查看 Kit 及其挂载的 Bundles，但不要在不支持 Studio 的宿主中虚构入口。',
  ].join('\n')
}
