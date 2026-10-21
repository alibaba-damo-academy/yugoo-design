import type { IResearchRound } from './researchTypes.ts';

/**
 * A round badge summarizes its directions rather than forming a second,
 * independent lifecycle. Queued and working directions make the round active.
 */
export const deriveRoundDisplayStage = (round: IResearchRound): string => {
  const directions = round.directions ?? [];
  if (
    directions.some(
      direction =>
        direction.status === 'queued'
        || direction.status === 'working'
    )
  ) {
    return 'researching';
  }
  return round.stage;
};

export const isRoundActivelyResearching = (round: IResearchRound): boolean =>
  deriveRoundDisplayStage(round) === 'researching';
