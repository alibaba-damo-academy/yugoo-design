import React, { useState } from 'react';
import { IconFont } from '../../ui/icon-font.tsx';
import type { IResearchDirectionItem, IResearchRound } from './researchTypes.ts';
import { deriveRoundDisplayStage } from './researchStatus.ts';
import {
  DesignPanelNavGroup,
  DesignPanelNavItem,
  DesignPanelSidebar,
} from '../OfficialWebAppPanels/panelPrimitives.tsx';
import {
  DesignExecutionStatusIcon,
  type DesignExecutionVisualStatus,
} from '../OfficialWebAppPanels/DesignExecutionStatusIcon.tsx';

/** Special direction_id meaning "this round's root node is selected". */
export const ROOT_DIRECTION_ID = '__root__';

/** Selection state — round-root-selected is `directionId === ROOT_DIRECTION_ID`. */
export interface ISelectedNode {
  roundId: string;
  directionId: string;
}

export interface IResearchNavTreeProps {
  rounds: IResearchRound[];
  currentRoundId?: string | null;
  selected: ISelectedNode | null;
  onSelect: (node: ISelectedNode) => void;
  /** Header title shown above the tree (e.g. "调研"). Mirrors the
   *  function-module nav's "应用功能脑图" header. */
  title?: string;
}

type IDirectionStatus = IResearchDirectionItem['status'];

const DIRECTION_STATUS_VISUALS: Record<IDirectionStatus, DesignExecutionVisualStatus> = {
  pending: 'pending',
  queued: 'queued',
  working: 'working',
  completed: 'completed',
  failed: 'failed',
};

const roundVisual = (round: IResearchRound): DesignExecutionVisualStatus => {
  if (round.producer_status === 'queued') return 'queued';
  if (round.producer_status === 'working') return 'working';
  if (round.producer_status === 'failed') return 'failed';
  const stage = deriveRoundDisplayStage(round);
  if (stage === 'researching') {
    return 'working';
  }
  if (stage === 'partial') {
    return 'pending';
  }
  if (stage === 'completed' || round.conclusion_file) return 'completed';
  return 'pending';
};

/**
 * Visual status indicator for tree nodes.
 *
 * Sized to ~12px so titles next to it stay legible at the 14px body size.
 * The spinner reuses the theme purple token ring-with-transparent-top pattern
 * used in `ResearchRootDetail` — keeps the in-progress feel consistent across the
 * panel.
 */
const StatusIndicator: React.FC<{ visual: DesignExecutionVisualStatus }> = ({ visual }) => (
  <DesignExecutionStatusIcon status={visual} label={visual} />
);

interface IRoundSectionProps {
  round: IResearchRound;
  selected: ISelectedNode | null;
  onSelect: (node: ISelectedNode) => void;
  defaultExpanded: boolean;
}

/**
 * One round = a first-tier (epic-like) node with its directions nested as
 * second-tier (module-like) leaves. Visuals mirror `FunctionModulesTree`:
 * a lucide chevron, `rounded-lg` row buttons, `--ds-text-*` tokens, and the
 * `└` connector lines (vertical spine + elbow) drawn with absolutely-
 * positioned borders. Research-specific behaviour is preserved on top of that
 * skin: a status indicator on the right of every row, and directions that are
 * nav-locked until they finish researching.
 */
const RoundSection: React.FC<IRoundSectionProps> = ({
  round,
  selected,
  onSelect,
  defaultExpanded,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const rootSelected =
    selected?.roundId === round.round_id &&
    selected.directionId === ROOT_DIRECTION_ID;
  const visual = roundVisual(round);

  return (
    <DesignPanelNavGroup
      expanded={expanded}
      selected={rootSelected}
      label={round.topic || round.round_id}
      trailing={<StatusIndicator visual={visual} />}
      onToggle={() => setExpanded(value => !value)}
      onSelect={() => {
        onSelect({
          roundId: round.round_id,
          directionId: ROOT_DIRECTION_ID,
        });
      }}
    >
      {round.directions.map(direction => {
        const leafSelected =
          selected?.roundId === round.round_id &&
          selected.directionId === direction.direction_id;
        const leafVisual =
          DIRECTION_STATUS_VISUALS[direction.status] ??
          DIRECTION_STATUS_VISUALS.pending;
        const isClickable = Boolean(
          direction.findings?.trim() || direction.findings_file
        );
        return (
          <DesignPanelNavItem
            key={direction.direction_id}
            disabled={!isClickable}
            aria-disabled={!isClickable}
            selected={leafSelected}
            className={
              leafSelected
                ? 'font-normal'
                : 'font-normal text-[var(--ds-text-secondary)]'
            }
            onMouseDown={event => event.preventDefault()}
            onClick={
              isClickable
                ? () =>
                    onSelect({
                      roundId: round.round_id,
                      directionId: direction.direction_id,
                    })
                : undefined
            }
          >
            <span className='min-w-0 flex-1 truncate' title={direction.title}>
              {direction.title}
            </span>
            <span className='ml-1 flex shrink-0 items-center'>
              <StatusIndicator visual={leafVisual} />
            </span>
          </DesignPanelNavItem>
        );
      })}
    </DesignPanelNavGroup>
  );
};

export const ResearchNavTree: React.FC<IResearchNavTreeProps> = ({
  rounds,
  currentRoundId,
  selected,
  onSelect,
  title,
}) => {
  const tree = [...rounds]
    .reverse()
    .map(round => (
      <RoundSection
        key={round.round_id}
        round={round}
        selected={selected}
        onSelect={onSelect}
        defaultExpanded={round.round_id === currentRoundId}
      />
    ));
  if (!title) return <>{tree}</>;
  return (
    <DesignPanelSidebar
      icon={
        <IconFont
          type='icon-line-operation-unfold'
          className='text-[var(--ds-text-7)]'
        />
      }
      title={title}
      ariaLabel={title}
    >
      {tree}
    </DesignPanelSidebar>
  );
};

// Back-compat alias — old component name kept so any import in the
// module hierarchy doesn't break during the transition.
export const ResearchDirectionList = ResearchNavTree;
