/**
 * Collapsed-answer display row (strict port of the original
 * Design/AnswerInfo.tsx).
 */
import React from 'react';

export const AnswerInfo = ({
  data,
  className = '',
  variant = 'default',
}: {
  data: string;
  className?: string;
  variant?: 'default' | 'muted';
}) => {
  const textColorClass =
    variant === 'muted'
      ? 'text-[var(--ds-text-6)]'
      : 'text-[var(--ds-text-primary)]';

  return (
    <div
      className={`min-h-[32px] rounded-[8px] border border-[var(--ds-line-1)] bg-[#FFFFFF] px-[10px] py-[7px] text-[14px] ${textColorClass} ${className}`}
    >
      {data}
    </div>
  );
};
