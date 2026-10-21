import React, { ReactNode } from 'react';
import { cn } from './cn.ts';
import { EMPTY_IMAGE, SEARCH_EMPTY_IMAGE } from './assets.ts';
import { useLang } from '../host.ts';
import { Button } from './button.tsx';

interface IEmptyPageProps {
  title?: string;
  description?: string | ReactNode;
  className?: string;
  isSearch?: boolean;
  isSmall?: boolean;
  btnText?: string;
  onBtnClick?: () => void;
}

const EmptyPage: React.FC<IEmptyPageProps> = ({
  title = '',
  description,
  className,
  isSearch = false,
  btnText = '',
  onBtnClick = () => {},
  isSmall = false,
}) => {
  const t = useLang();

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-[12px] h-[100%]',
        className
      )}
    >
      <img
        src={isSearch ? SEARCH_EMPTY_IMAGE : EMPTY_IMAGE}
        className={isSmall ? 'w-[80px] h-[80px]' : 'w-[120px] h-[120px]'}
      />
      {title && (
        <h2
          className={`${isSmall ? 'text-xs' : 'text-xl'} font-semibold text-foreground`}
        >
          {title}
        </h2>
      )}
      <p
        className={`text-[var(--ds-text-secondary)] text-center  max-w-md ${isSmall ? 'text-xs' : 'text-sm'} `}
      >
        {description ?? t.console_no_data}
      </p>
      {btnText ? (
        <Button type='button' onClick={onBtnClick}>
          {btnText}
        </Button>
      ) : (
        ''
      )}
    </div>
  );
};

export default EmptyPage;
