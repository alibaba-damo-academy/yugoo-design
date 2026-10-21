/**
 * page_design panel adapter: projects durable artifact settlements onto the
 * view-only Page status/file fields, hydrates accepted HTML for previews, and
 * removes those transient fields from every authored edit. HTML re-hydrates
 * whenever the host-confirmed original flips identity (save echo / agent
 * write); artifact reads are cached per path and tolerate missing files.
 */
import {
  useCallback,
  useMemo,
  type ReactElement,
} from 'react';
import { isRecord } from '../types.ts';
import { PageDesignPanel as PageDesignPanelView } from '../ported/design/PageDesignPanel/index.ts';
import type {
  IPageDesignState,
  IPageNode,
} from '../ported/design/PageDesignPanel/pageDesignTypes.ts';
import type { SkillPanelProps } from './shared.ts';
import { projectTextArtifactView, useTextArtifactContents } from './artifact-text-hydration.ts';
import { projectPageDesignPanelState } from './artifact-activity-projection.ts';
import { projectArtifactReceipt } from './artifact-status-projection.ts';
import { useHtmlImageContents } from './artifact-html-images.ts';

export { projectPageDesignPanelState } from './artifact-activity-projection.ts';

/** Adapter props: artifacts, including tokens.css, use the shared file reader. */
export interface IPageDesignPanelAdapterProps extends SkillPanelProps {
  /** Prevent edits while the host is saving the current draft set. */
  running?: boolean;
}

/**
 * (page id, UI-only artifact_file alias) pairs for every page with an accepted artifact. Walks the
 * same order/records union as the `ordered` helper, so a page missing from a
 * present-but-incomplete `page_order` still hydrates.
 */
function pageArtifactFiles(
  state: IPageDesignState,
  attempts: NonNullable<SkillPanelProps['executionAttempts']> = [],
): { id: string; path: string; cacheKey: string }[] {
  const pages = state.pages ?? {};
  const preferred = state.page_order ?? [];
  const seen = new Set(preferred);
  const ids = [...preferred, ...Object.keys(pages).filter((id) => !seen.has(id))];
  const entries: { id: string; path: string; cacheKey: string }[] = [];
  for (const id of ids) {
    const file = pages[id]?.artifact_file;
    if (file) {
      const receipt = projectArtifactReceipt(id, attempts, 'page_html', file);
      entries.push({ id, path: file, cacheKey: receipt === undefined ? `path:${file}` : `receipt:${receipt.sha256}` });
    }
  }
  return entries;
}

/** Merge hydrated HTML onto each page (inline HTML, if any, wins). */
/** Merge hydration load state onto pages without turning a miss into content. */
export function hydratePages(
  pages: Record<string, IPageNode>,
  htmls: Record<string, string | null>
): Record<string, IPageNode> {
  const next: Record<string, IPageNode> = {};
  for (const [id, page] of Object.entries(pages)) {
    const view = projectTextArtifactView(page.artifact_file, page.html, htmls[id]);
    next[id] = {
      ...page,
      ...(view.content === undefined ? {} : { html: view.content }),
      artifact_loading: view.loading,
      artifact_available: view.available,
    };
  }
  return next;
}

/** Drop only hydrated HTML before canonical Page state ships back to the host. */
function dehydratePages(
  pages: Record<string, IPageNode>
): Record<string, IPageNode> {
  const next: Record<string, IPageNode> = {};
  for (const [id, page] of Object.entries(pages)) {
    const copy = { ...page };
    delete copy.html;
    delete copy.evidence_digest;
    delete copy.artifact_loading;
    delete copy.artifact_available;
    delete copy.generation_status;
    delete copy.generation_error;
    next[id] = copy;
  }
  return next;
}

/** The page_design panel body bound to the dsh flat state. */
export function PageDesignPanel(
  props: IPageDesignPanelAdapterProps
): ReactElement {
  const rawState = isRecord(props.draft) ? props.draft : {};
  const state = useMemo(
    () => projectPageDesignPanelState(rawState, props.executionAttempts, props.artifactFiles),
    [props.executionAttempts, props.artifactFiles, rawState]
  );
  const files = useMemo(
    () => pageArtifactFiles(state, props.executionAttempts ?? []),
    [props.executionAttempts, state],
  );
  const htmls = useTextArtifactContents(
    files,
    props.readArtifact,
    props.originalState,
    props.artifactFiles
  );
  const previewHtmls = useHtmlImageContents(files, htmls, props.readBinaryArtifact, props.originalState, props.artifactFiles);
  const styles = useTextArtifactContents(
    [{ id: 'tokens', path: 'design_style/tokens.css' }],
    props.readArtifact,
    props.originalState,
    props.artifactFiles,
  );

  const data = useMemo<IPageDesignState>(
    () => ({ ...state, pages: hydratePages(state.pages ?? {}, previewHtmls) }),
    [state, previewHtmls]
  );
  const previewResetIdentity = useMemo(
    () => ({}),
    [props.readArtifact, props.readBinaryArtifact, props.originalState, props.artifactFiles],
  );

  // Edit flush: merge map updates over the draft and retain direct canonical
  // Page progress fields. Only hydrated HTML is a panel projection.
  const handleChange = useCallback(
    (next: IPageDesignState) => {
      const current = (
        isRecord(props.draft) ? props.draft : {}
      ) as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...current, ...next };
      if (next.pages !== undefined) {
        merged.pages = dehydratePages(next.pages);
      }
      props.onChange(merged);
    },
    [props]
  );

  return (
    <PageDesignPanelView
      data={data}
      previewResetIdentity={previewResetIdentity}
      styleCss={styles.tokens ?? undefined}
      disabled={props.running}
      readExecutionLog={props.readExecutionLog}
      onChange={handleChange}
    />
  );
}

export default PageDesignPanel;
