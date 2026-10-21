/** Label and badge helpers shared by the page_design panel family. */
import type { IPageConnection, IPageNode } from './pageDesignTypes.ts';

/**
 * `page_type` → i18n label. Unknown or absent types fall back to the `other`
 * key; unknown keys resolve to the key itself (host.ts `useLang` contract).
 *
 * @param t - active language dictionary from `useLang()`.
 * @param page - page whose type label is rendered.
 * @returns the localized (or fallback-key) type label.
 */
export function pageTypeLabel(
  t: Record<string, string>,
  page: IPageNode
): string {
  return t[`page_design_type_${page.page_type ?? 'other'}`];
}

/**
 * Generation lifecycle → i18n label. An absent status renders as `stale` when
 * the page already has an artifact file, else `pending` (upstream contract).
 *
 * @param t - active language dictionary from `useLang()`.
 * @param page - page whose status label is rendered.
 * @returns the localized (or fallback-key) status label.
 */
export function pageStatusLabel(
  t: Record<string, string>,
  page: IPageNode
): string {
  switch (page.generation_status) {
    case 'completed':
      return t.page_design_status_completed;
    case 'failed':
      return t.page_design_status_failed;
    case 'queued':
      return t.page_design_status_queued;
    case 'working':
      return t.page_design_status_generating;
    case 'pending':
      return t.page_design_status_pending;
    default:
      return page.artifact_file
        ? t.page_design_status_stale
        : t.page_design_status_pending;
  }
}

/**
 * Visual geometry issue code → localized readout. The preview host script
 * emits `code:detail` codes (`document-root`, `body-empty`, `region-missing`,
 * `region-invisible`, `horizontal-overflow`); bound-hotspot codes resolve the
 * element id to its bound-connection label when one exists. Unknown codes
 * render verbatim so a new code degrades to its raw text, never a crash.
 *
 * @param t - active language dictionary from `useLang()`.
 * @param issue - issue code emitted by the preview geometry report.
 * @param connections - outgoing connections of the checked page.
 * @returns the localized issue readout.
 */
export function visualCheckIssueLabel(
  t: Record<string, string>,
  issue: string,
  connections: readonly IPageConnection[]
): string {
  const separator = issue.indexOf(':');
  const code = separator === -1 ? issue : issue.slice(0, separator);
  const detail = separator === -1 ? '' : issue.slice(separator + 1);
  switch (code) {
    case 'document-root':
      return t.page_design_visual_issue_document_root.replace('{counts}', detail);
    case 'body-empty':
      return t.page_design_visual_issue_body_empty;
    case 'horizontal-overflow':
      return t.page_design_visual_issue_overflow.replace('{w}', detail);
    case 'region-missing':
    case 'region-invisible': {
      const bound = connections.find(
        (connection) => connection.source_element_id === detail
      );
      const name = bound?.source_element_label || bound?.label || detail;
      const template =
        code === 'region-missing'
          ? t.page_design_visual_issue_region_missing
          : t.page_design_visual_issue_region_invisible;
      return template.replace('{id}', name);
    }
    default:
      return issue;
  }
}
