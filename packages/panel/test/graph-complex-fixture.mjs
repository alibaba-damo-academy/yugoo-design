/**
 * Synthetic, read-only KAG used to judge the graph presentation.
 * It deliberately mixes structural, inferred and accepted relationships.
 * Nothing in this fixture is project evidence and it must never be persisted.
 */
export function complexGraph() {
  const sources = {
    smart_questions: { file: 'smart_questions/smart_questions.json', panel: '产品背景' },
    function_modules: { file: 'function_modules/function_modules.json', panel: '功能模块' },
    flow_design: { file: 'flow_design/flow_design.json', panel: '业务流程' },
    page_design: { file: 'page_design/page_design.json', panel: '页面设计' },
    design_style: { file: 'design_style/design_style.json', panel: '视觉风格' },
  }
  const records = [
    ['sq:vision', 'smart_questions', '从文献到可执行研究计划', ['服务个人研究者', '将分散证据组织成可执行计划']],
    ['sq:user', 'smart_questions', '个人研究者的持续工作台', ['跨学科使用', '长期积累研究记录']],
    ['sq:authority', 'smart_questions', '关键科研动作需人工确认', ['Agent 可以分析和起草', '对外发布与实验执行需确认']],
    ['sq:privacy', 'smart_questions', '研究材料默认私有', ['未公开论文与数据不外泄', '共享前明确展示范围']],

    ['fn:library', 'function_modules', '文献库', ['导入、去重和分组', '保留原始文献与引用信息']],
    ['fn:reader', 'function_modules', 'AI 文献阅读', ['结构化摘要', '定位原文证据']],
    ['fn:hypothesis', 'function_modules', '研究问题与假设', ['从证据生成候选问题', '标记未验证推断']],
    ['fn:plan', 'function_modules', '研究计划', ['里程碑与阶段产出', '任务与证据链接']],
    ['fn:experiment', 'function_modules', '实验设计与执行', ['参数、数据与运行环境', '失败恢复与人工确认']],
    ['fn:agent', 'function_modules', 'Agent 任务中心', ['展示计划、工具与进度', '可暂停、取消和审批']],
    ['fn:evidence', 'function_modules', '研究证据库', ['结论可追溯到文献或实验', '保留冲突证据']],
    ['fn:export', 'function_modules', '研究报告导出', ['导出时标注引用', '未确认内容不进入正式报告']],

    ['flow:literature', 'flow_design', '文献到研究计划', ['导入→阅读→问题→计划', '每一步保留证据链']],
    ['flow:experiment', 'flow_design', '假设到实验结果', ['假设→实验方案→执行→结果', '失败后返回修订方案']],
    ['flow:approval', 'flow_design', '关键动作审批', ['涉及外部执行时暂停', '用户确认后继续']],
    ['flow:evidence', 'flow_design', '证据同步与冲突处理', ['将产出挂接回证据', '冲突证据不自动覆盖']],

    ['page:dashboard', 'page_design', '研究工作台', ['当前课题与下一步', 'Agent 状态与待确认动作']],
    ['page:library', 'page_design', '文献库页面', ['文献列表与分组', '导入与去重操作']],
    ['page:reader', 'page_design', '文献阅读详情', ['原文与 AI 摘要对照', '证据引用可直接定位']],
    ['page:plan', 'page_design', '研究计划画布', ['里程碑、任务与证据', '拖拽调整计划顺序']],
    ['page:agent', 'page_design', 'Agent 运行中心', ['任务步骤与工具日志', '审批、暂停与取消']],
    ['page:evidence', 'page_design', '证据与结论视图', ['按结论查看支持与冲突证据', '可回到文献或实验']],

    ['style:density', 'design_style', '紧凑但可扫读的信息密度', ['研究记录优先展示', '次要操作降低视觉权重']],
    ['style:action', 'design_style', '紫色仅用于主要操作', ['一个页面不超过两个主按钮', '审批操作保持清晰']],
    ['style:audit', 'design_style', '审批与执行状态始终可见', ['等待、运行、失败有明确区分', '不用颜色作为唯一状态线索']],
  ]

  const nodes = []
  const edges = []
  for (const [id, owner, label, facts] of records) {
    const source = sources[owner]
    nodes.push({ id, label, sourceLabel: label, file: source.file, pointer: `/records/${id.split(':')[1]}`, context: facts.join('\n'), owner, record: true, recordId: id, contentKind: 'container', previewSourcePanel: source.panel })
    for (const [index, fact] of facts.entries()) {
      const child = `${id}:fact:${index + 1}`
      nodes.push({ id: child, label: fact, file: source.file, pointer: `/records/${id.split(':')[1]}/facts/${index}`, context: fact, owner, record: false, recordId: id, parentId: id, contentKind: 'unit', previewSourcePanel: source.panel })
      edges.push({ id: `contains:${child}`, from: id, to: child, kind: 'contains', label: '包含已保存内容单元', evidence: `${source.file}#/records/${id.split(':')[1]}/facts/${index}`, reading: { relationType: 'contains', meaning: 'contains', origin: 'file', direction: 'forward', lifecycle: 'observed' } })
    }
  }
  const relation = (id, from, to, kind, label, evidence, relationType, meaning, origin, direction, lifecycle) => edges.push({
    id, from, to, kind, label, evidence,
    reading: { relationType, meaning, origin, direction, lifecycle },
  })

  // Schema-declared identifiers: navigational wiring, not confirmed business semantics.
  relation('ref:page-library', 'page:library', 'fn:library', 'identifier-match', '页面绑定功能标识符', 'page_design#/pages/library/function_ref = library', 'identifier-match', 'references', 'file', 'forward', 'proposed')
  relation('ref:page-reader', 'page:reader', 'fn:reader', 'identifier-match', '页面绑定功能标识符', 'page_design#/pages/reader/function_ref = reader', 'identifier-match', 'references', 'file', 'forward', 'proposed')
  relation('ref:page-plan', 'page:plan', 'fn:plan', 'identifier-match', '页面绑定功能标识符', 'page_design#/pages/plan/function_ref = plan', 'identifier-match', 'references', 'file', 'forward', 'proposed')
  relation('ref:page-agent', 'page:agent', 'fn:agent', 'identifier-match', '页面绑定功能标识符', 'page_design#/pages/agent/function_ref = agent', 'identifier-match', 'references', 'file', 'forward', 'proposed')
  relation('ref:page-evidence', 'page:evidence', 'fn:evidence', 'identifier-match', '页面绑定功能标识符', 'page_design#/pages/evidence/function_ref = evidence', 'identifier-match', 'references', 'file', 'forward', 'proposed')

  // Embedding only recalls candidates. These edges intentionally do not claim dependency.
  relation('sim:vision-flow', 'sq:vision', 'flow:literature', 'semantic', '内容相似候选', '目标和流程都提及“文献到研究计划”', 'semantic-similarity', 'similar', 'embedding', 'symmetric', 'proposed')
  relation('sim:agent-experiment', 'fn:agent', 'fn:experiment', 'semantic', '内容相似候选', '两条记录都提及执行、失败恢复和确认', 'semantic-similarity', 'similar', 'embedding', 'symmetric', 'proposed')
  relation('sim:approval-audit', 'flow:approval', 'style:audit', 'semantic', '内容相似候选', '审批流程与状态可见性的语义相近', 'semantic-similarity', 'similar', 'embedding', 'symmetric', 'proposed')

  // Agent interpretation. Proposed and accepted states are deliberately mixed.
  relation('support:reader-vision', 'fn:reader', 'sq:vision', 'knowledge', 'AI 阅读为从文献到计划提供证据', '文献摘要与原文定位可支持研究计划', 'evidence-support', 'supports', 'agent', 'forward', 'accepted')
  relation('support:evidence-experiment', 'fn:evidence', 'flow:experiment', 'knowledge', '证据库支持实验结果复核', '实验结果需回指数据、运行和结论证据', 'evidence-support', 'supports', 'agent', 'forward', 'proposed')
  relation('realize:flow-vision', 'flow:literature', 'sq:vision', 'knowledge', '业务流程实现产品目标', '导入→阅读→问题→计划对应产品目标', 'goal-realization', 'realizes', 'agent', 'forward', 'accepted')
  relation('realize:dashboard-workspace', 'page:dashboard', 'sq:user', 'knowledge', '工作台页面实现持续工作场景', '课题、下一步与 Agent 状态共同构成持续工作台', 'goal-realization', 'realizes', 'agent', 'forward', 'proposed')
  relation('constraint:authority-agent', 'sq:authority', 'fn:agent', 'knowledge', '人工确认约束 Agent 执行权限', '产品背景明确外部执行前必须确认', 'product-constraint', 'constrains', 'human', 'forward', 'accepted')
  relation('constraint:privacy-evidence', 'sq:privacy', 'fn:evidence', 'knowledge', '私有性约束证据库共享', '用户已确认研究材料默认私有', 'product-constraint', 'constrains', 'human', 'forward', 'accepted')
  relation('constraint:density-dashboard', 'style:density', 'page:dashboard', 'knowledge', '信息密度约束工作台展示', '主要研究记录优先，次要操作降权', 'presentation-constraint', 'constrains', 'human', 'forward', 'accepted')

  // Process order is explicit, not inferred from screen position.
  relation('order:library-reader', 'fn:library', 'fn:reader', 'knowledge', '文献先入库，再进入 AI 阅读', '业务流程已保存此顺序', 'process-order', 'precedes', 'agent', 'forward', 'accepted')
  relation('order:reader-hypothesis', 'fn:reader', 'fn:hypothesis', 'knowledge', '阅读证据先于问题与假设', '业务流程已保存此顺序', 'process-order', 'precedes', 'agent', 'forward', 'accepted')
  relation('order:hypothesis-plan', 'fn:hypothesis', 'fn:plan', 'knowledge', '先明确假设，再形成研究计划', '业务流程已保存此顺序', 'process-order', 'precedes', 'agent', 'forward', 'accepted')
  relation('order:experiment-evidence', 'fn:experiment', 'fn:evidence', 'knowledge', '实验产出先于证据入库', '实验流程的产出步骤指向证据同步', 'process-order', 'precedes', 'agent', 'forward', 'proposed')
  relation('order:evidence-export', 'fn:evidence', 'fn:export', 'knowledge', '已核验证据先于正式报告', '未确认内容不进入正式报告', 'process-order', 'precedes', 'human', 'forward', 'accepted')

  relation('conflict:autonomy-approval', 'fn:agent', 'sq:authority', 'knowledge', '自动执行边界与人工确认要求冲突', 'Agent 任务中心包含自动执行，但产品背景要求关键动作确认；需澄清边界', 'design-conflict', 'contradicts', 'agent', 'symmetric', 'proposed')
  relation('conflict:density-audit', 'style:density', 'style:audit', 'knowledge', '紧凑布局与审批状态强可见性存在张力', '状态不能被紧凑密度压缩到难以发现', 'design-tension', 'contradicts', 'agent', 'symmetric', 'proposed')

  return {
    checkpoint: 'synthetic-complex-v1',
    projectId: 'synthetic-visual-review-only',
    knowledgeRevision: 'synthetic-complex-v1',
    knowledgeStatus: 'current',
    coverage: { projection: 'synthetic-complete', embedding: 'synthetic-complete', review: 'synthetic-mixed' },
    semantic: { state: 'ready', completed: records.length, total: records.length, model: 'synthetic-fixture', message: '演示数据，未调用实际 Embedding', cache: 'memory' },
    warnings: [
      '合成演示数据：用于评估复杂 KAG 的可视化，不是任何设计项目的事实。',
      '关系状态故意混合了已观测、候选解释和已采纳，请点击连线查看区别。',
    ],
    nodes,
    edges,
  }
}
