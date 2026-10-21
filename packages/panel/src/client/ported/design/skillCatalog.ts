/**
 * skillCatalog.ts (dsh port)
 *
 * 设计子面板「+ 新面板」选择器的纯逻辑：解析当前活跃 mindset、按分层分组技能
 * 卡片、构造 pick→chat 的启动文本。抽成纯函数便于单测（不依赖 DOM）。
 *
 * dsh 适配：目录数据来自 `designPanel.listSkills`（活跃 kit 的技能清单），经
 * `catalogFromListSkills` 归一化为原始的 mindset 分层目录形态。dsh 的 skill.yaml
 * 没有 layer 字段，全部技能归入以 mindset 标题命名的单一分层。标题、描述和点选
 * 文案按当前 UI 语言从 skill.yaml 选择；旧 Bundle 没有双语 description 时回退到
 * SKILL.md routing description。dsh 没有 `[[route:<id>]]` 标记机制。
 */

import { currentLanguage } from '../host.ts'

/** 单个技能卡片（原始 IDesignSkillCard 形态）。 */
export interface IDesignSkillCard {
  /** 稳定 skill id == 目录名。 */
  id: string;
  /** 当前 UI 语言的 skill.yaml title。 */
  title: string;
  /** skill.yaml 图标名，可能为空。 */
  icon: string;
  /** 当前 UI 语言的 Bundle description，或旧 Bundle 的 SKILL.md 描述。 */
  description: string;
  /** 分层 id。 */
  layer: string;
  /** 当前 UI 语言的 skill.yaml picker label，点选时发进聊天的启动文本。 */
  pickLabel: string;
}

/** mindset 目录中的一个分层分组（按展示顺序）。 */
export interface IMindsetLayer {
  /** 分层 id。 */
  id: string;
  /** 面向用户的分层标题。 */
  title: string;
}

/** 单个 mindset 的分层设计技能目录（picker 数据源）。 */
export interface IMindsetCatalog {
  /** mindset id。 */
  name: string;
  /** mindset 描述。 */
  description: string;
  /** 分层分组（展示顺序）。 */
  layers: IMindsetLayer[];
  /** 技能卡片（按 order 排序）。 */
  entries: IDesignSkillCard[];
}

/** mindset 名 → 分层技能目录。null 表示未加载。 */
export type IMindsetCatalogs = Record<string, IMindsetCatalog>;

/** One `designPanel.listSkills` outcome (wire shape). */
export interface SkillCatalogResponse {
  mindset: string | undefined
  skills: { id: string; description: string; manifest: Record<string, unknown> }[]
}

/** UI languages shared with the ported Design chrome. */
export type SkillCatalogLanguage = 'zh_CN' | 'en_US'

/** Select one bilingual manifest field in UI-locale order. */
function localizedOf(
  manifest: Record<string, unknown>,
  key: string,
  language: SkillCatalogLanguage,
): string | undefined {
  const value = manifest[key]
  if (typeof value === 'object' && value !== null) {
    const pair = value as Record<string, unknown>
    const first = language === 'zh_CN' ? pair.zh : pair.en
    const fallback = language === 'zh_CN' ? pair.en : pair.zh
    if (typeof first === 'string' && first !== '') return first
    if (typeof fallback === 'string' && fallback !== '') return fallback
  }
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Normalize one `listSkills` outcome into the original mindset catalog
 * shape: a single layer named after the mindset (dsh skill.yaml carries no
 * layer grouping). Returns null when no kit is installed.
 * @param response - the remote outcome.
 * @param language - UI language; defaults to the same browser-locale choice as the panel chrome.
 * @returns the picker catalog keyed by mindset name.
 */
export function catalogFromListSkills(
  response: SkillCatalogResponse,
  language: SkillCatalogLanguage = currentLanguage(),
): IMindsetCatalogs | null {
  if (response.mindset === undefined) return null
  const entries: IDesignSkillCard[] = response.skills.map((skill) => {
    const title = localizedOf(skill.manifest, 'title', language) ?? skill.id
    return {
      id: skill.id,
      title,
      icon: typeof skill.manifest.icon === 'string' ? skill.manifest.icon : '',
      description: localizedOf(skill.manifest, 'description', language) ?? skill.description,
      layer: 'all',
      pickLabel: localizedOf(skill.manifest, 'label', language) ?? title,
    }
  })
  return {
    [response.mindset]: {
      name: response.mindset,
      description: '',
      layers: [{ id: 'all', title: response.mindset }],
      entries,
    },
  }
}

/**
 * 由当前已打开面板的类型集合反推活跃 mindset。
 *
 * 规则：
 * - 逐 mindset 统计其 entries 与 `panelTypes` 的交集大小，取交集最大者。
 * - 交集并列时按 mindset 名字典序取第一个，保证确定性。
 * - 没有任何交集（如尚无面板）时：只有一个 mindset 则返回它；否则返回按名字
 *   典序的第一个作为兜底，避免选择器完全空白。
 * - mindsets 为空返回 null。
 */
export const resolveActiveMindset = (
  panelTypes: readonly string[],
  mindsets: IMindsetCatalogs | null
): string | null => {
  if (!mindsets) return null;
  const names = Object.keys(mindsets).sort();
  if (names.length === 0) return null;

  const typeSet = new Set(panelTypes);
  let best: { name: string; overlap: number } | null = null;
  for (const name of names) {
    const overlap = mindsets[name].entries.reduce(
      (acc, entry) => acc + (typeSet.has(entry.id) ? 1 : 0),
      0
    );
    if (overlap > 0 && (best === null || overlap > best.overlap)) {
      best = { name, overlap };
    }
  }
  if (best) return best.name;
  // 无交集兜底：单 mindset 直接用它，多 mindset 用字典序第一个。
  return names[0];
};

/**
 * 在 mindset 技能目录里查技能卡片的展示标题（skill.yaml 双语 title）。
 * 查不到返回 undefined，由调用方决定兜底（通常保留原始 skill id 不静默）。
 */
export const findSkillCatalogTitle = (
  mindsets: IMindsetCatalogs | null,
  skillId: string
): string | undefined => {
  if (!mindsets) return undefined;
  for (const catalog of Object.values(mindsets)) {
    const card = catalog.entries.find(entry => entry.id === skillId);
    if (card && card.title) return card.title;
  }
  return undefined;
};

/** 一个分层分组：分层元信息 + 属于它的技能卡片（按 entries 原始顺序）。 */
export interface ISkillLayerGroup {
  layer: IMindsetLayer;
  entries: IDesignSkillCard[];
}

/**
 * 把一个 mindset 的技能卡片按分层分组，保持 `catalog.layers` 的展示顺序与
 * `catalog.entries` 的原始（skill.yaml order）顺序。
 *
 * - 只保留至少含一张卡片的分层。
 * - entries 里出现了 `layers` 未声明的 layer（脏数据）时，追加一个以该 layer
 *   id 兜底标题的分组，避免卡片被丢弃。
 */
export const groupEntriesByLayer = (
  catalog: IMindsetCatalog
): ISkillLayerGroup[] => {
  const byLayer = new Map<string, IDesignSkillCard[]>();
  for (const entry of catalog.entries) {
    const list = byLayer.get(entry.layer) ?? [];
    list.push(entry);
    byLayer.set(entry.layer, list);
  }

  const groups: ISkillLayerGroup[] = [];
  const consumed = new Set<string>();
  for (const layer of catalog.layers) {
    const entries = byLayer.get(layer.id);
    if (entries && entries.length > 0) {
      groups.push({ layer, entries });
      consumed.add(layer.id);
    }
  }
  // 兜底：entries 引用了未在 layers 声明的分层。
  for (const [layerId, entries] of byLayer) {
    if (consumed.has(layerId) || entries.length === 0) continue;
    groups.push({ layer: { id: layerId, title: layerId }, entries });
  }
  return groups;
};

/**
 * 构造「点击技能卡片」发往聊天的文本：skill.yaml 的 picker label（zh 优先）。
 * dsh 中该消息由 agent 的技能目录消费并 engage 对应技能。
 */
export const buildSkillRouteText = (card: IDesignSkillCard): string =>
  card.pickLabel;
