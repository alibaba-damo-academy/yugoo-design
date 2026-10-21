/**
 * Deterministic Page Map grouping and auto-layout. Pages follow the shared
 * navigation's functional groups, while child pages inherit their nearest
 * ancestor's group. Persisted positions remain user-owned.
 */
import type {
  IPageCommonSpec,
  IPageNode,
} from './pageDesignTypes.ts';

/** Page card width used for node and section bounds. */
export const NODE_WIDTH = 320;
/** Page card height used for node and section bounds. */
export const NODE_HEIGHT = 228;
/** Horizontal distance between cards in one functional group. */
export const PAGE_MAP_COLUMN_STEP = 392;
/** Vertical distance between functional groups. */
export const PAGE_MAP_SECTION_STEP = 348;
/** Horizontal inset around cards in a group frame. */
export const PAGE_MAP_SECTION_PADDING_X = 24;
/** Header space above cards in a group frame. */
export const PAGE_MAP_SECTION_HEADER_HEIGHT = 48;
/** Bottom inset below cards in a group frame. */
export const PAGE_MAP_SECTION_PADDING_BOTTOM = 24;

/** Locale-aware fallback labels for pages outside a named navigation group. */
export interface IPageMapGroupLabels {
  /** Navigation entry with no explicit group. */
  primary: string;
  /** Page that cannot inherit a navigation group. */
  other: string;
  /** Sole unnamed group. */
  generic: string;
}

/** One functional section rendered behind its Page cards. */
export interface IPageMapSection {
  /** Stable canvas node id. */
  id: string;
  /** User-visible functional group. */
  label: string;
  /** Page ids in canonical Page order. */
  pageIds: readonly string[];
}

/** Complete deterministic layout projection for the Page Map canvas. */
export interface IPageMapLayout {
  /** Functional sections in first-page order. */
  sections: readonly IPageMapSection[];
  /** Effective positions, including persisted user positions. */
  positions: ReadonlyMap<string, { x: number; y: number }>;
}

/**
 * Group pages using the shared navigation. A child without its own navigation
 * item inherits the nearest ancestor's group; cycles and missing parents fall
 * back to the locale's other-pages group.
 */
function pageMapSections(
  pages: readonly IPageNode[],
  records: Readonly<Record<string, IPageNode>>,
  commonSpec: IPageCommonSpec | null | undefined,
  labels: IPageMapGroupLabels
): readonly IPageMapSection[] {
  const navigationGroups = new Map<string, string>();
  for (const item of commonSpec?.navigation ?? []) {
    if (!item.target_page_id || navigationGroups.has(item.target_page_id)) continue;
    navigationGroups.set(item.target_page_id, item.group?.trim() || labels.primary);
  }

  const resolvedGroups = new Map<string, string>();
  const resolveGroup = (page: IPageNode): string => {
    const cached = resolvedGroups.get(page.id);
    if (cached !== undefined) return cached;
    const seen = new Set<string>();
    let current: IPageNode | undefined = page;
    while (current !== undefined && !seen.has(current.id)) {
      seen.add(current.id);
      const group = navigationGroups.get(current.id);
      if (group !== undefined) {
        resolvedGroups.set(page.id, group);
        return group;
      }
      current = current.parent_id ? records[current.parent_id] : undefined;
    }
    resolvedGroups.set(page.id, labels.other);
    return labels.other;
  };

  const byLabel = new Map<string, { id: string; label: string; pageIds: string[] }>();
  for (const page of pages) {
    const label = resolveGroup(page);
    let section = byLabel.get(label);
    if (section === undefined) {
      section = { id: `__page-map-section-${byLabel.size}`, label, pageIds: [] };
      byLabel.set(label, section);
    }
    section.pageIds.push(page.id);
  }
  const sections = [...byLabel.values()];
  if (sections.length === 1 && sections[0]?.label === labels.other) {
    sections[0] = { ...sections[0], label: labels.generic };
  }
  return Object.freeze(sections.map(section => Object.freeze({
    ...section,
    pageIds: Object.freeze(section.pageIds),
  })));
}

/**
 * Compute the functional-group layout. Each group occupies one horizontal row;
 * user-arranged positions override its default card position.
 */
export function pageMapGroupedLayout(
  pages: readonly IPageNode[],
  records: Readonly<Record<string, IPageNode>>,
  commonSpec: IPageCommonSpec | null | undefined,
  labels: IPageMapGroupLabels
): IPageMapLayout {
  const sections = pageMapSections(pages, records, commonSpec, labels);
  const positions = new Map<string, { x: number; y: number }>();
  sections.forEach((section, sectionIndex) => {
    section.pageIds.forEach((pageId, pageIndex) => {
      const page = records[pageId];
      positions.set(pageId, page?.canvas_position ?? {
        x: pageIndex * PAGE_MAP_COLUMN_STEP,
        y: sectionIndex * PAGE_MAP_SECTION_STEP,
      });
    });
  });
  return Object.freeze({ sections, positions });
}
