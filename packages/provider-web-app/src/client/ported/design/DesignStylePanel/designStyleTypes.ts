/**
 * Local copy of the extend-design-skill delta types the ported design_style
 * family consumes (`@/lib/delta/types`). Kept verbatim in field shape so the
 * components stay a strict port; dsh persists the flat
 * `DesignStyleState.config` record and the panel adapter converts.
 */

/** 侧边栏布局子配置（仅当 layout.mode === 'sidebar' 时使用） */
export interface ISidebarConfig {
  /** 'left' | 'right' */
  position: string;
  /** 'fixed' | 'collapsible' */
  style: string;
}

/**
 * 布局配置
 *
 * 模式枚举（与后端 LayoutConfig.mode 对齐）：
 *   - sidebar: 经典管理后台/SaaS 布局（侧边栏）
 *   - topbar: 营销/文档站点（顶栏）
 *   - bottom-nav: 移动优先（底部导航）
 *   - dashboard: 数据看板（卡片网格、无 chrome）
 *   - minimal: 作品集/落地页（仅内容）
 */
export interface ILayoutConfig {
  /** 'sidebar' | 'topbar' | 'bottom-nav' | 'dashboard' | 'minimal' */
  mode: string;
  /** 仅在 mode === 'sidebar' 时存在 */
  sidebar?: ISidebarConfig;
  /** 'narrow' | 'medium' | 'wide' | 'full' */
  content_width: string;
  /** 'compact' | 'comfortable' | 'spacious' */
  density: string;
}

/**
 * 预览页面配置
 *
 * 视觉风格 skill 会从项目上下文中挑选最具代表性的一页并生成自包含的
 * HTML+JS 文件，FE 用 iframe 渲染它。持久化状态只保存 `html_file` 路径，
 * `html` 在发射前注入（原始实现为 server-hydrate；dsh 由面板适配层经
 * `readArtifact` 水合），写回时再剥离（原始 post_edit_dehydrate 契约）。
 */
export interface IPreviewPage {
  /** 稳定标识符（如 'group_buy_product_detail'），用于文件名与缓存 key */
  name: string;
  /** 人类可读标题（如 '拼团商品详情'） */
  title: string;
  /** 选这个页面的理由 — 让用户理解 AI 的判断 */
  rationale: string;
  /** design_files/design_style/ 下的相对路径 */
  html_file?: string | null;
  /** 水合的原型 HTML；null/undefined 表示页面尚未生成 */
  html?: string | null;
}

/**
 * 视觉风格配置
 */
export interface IDesignStyleConfig {
  /** 主题名称 */
  theme: string;
  /** 布局配置（嵌套对象） */
  layout: ILayoutConfig;
  /** 配色方案。推荐 keys：primary, primaryLight, primaryDark, secondary,
   *  accent, background, surface, text, textSecondary, border */
  colors: Record<string, string>;
  /** 字体配置。推荐 keys：headingFont, bodyFont, monoFont, baseFontSize,
   *  headingWeight, lineHeight */
  typography: Record<string, string>;
  /** 组件风格。推荐 keys：borderRadius, shadowDepth, buttonStyle,
   *  inputStyle, cardStyle */
  components: Record<string, string>;
  /** 语义化颜色（成功/警告/错误/信息） */
  semantic_colors?: Record<string, string>;
  /** 深色模式配置 */
  dark_mode?: {
    colors: Record<string, string>;
  };
  /** AI 生成的代表性页面原型 */
  preview_page?: IPreviewPage | null;
  /** 补充说明 */
  notes: string;
}

/**
 * 视觉风格面板。dsh keeps one skill state per panel, so the adapter always
 * produces a single panel with a fixed `panel_id`.
 */
export interface IDesignStylePanel {
  /** 面板唯一标识 */
  panel_id: string;
  /** 面板类型 */
  type: 'design_style';
  /** 风格配置 */
  config: IDesignStyleConfig | null;
}
