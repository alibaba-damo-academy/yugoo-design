import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';

export const DESIGN_LEFT_PANEL_DEFAULT_WIDTH = 220;
export const DESIGN_LEFT_PANEL_MIN_WIDTH = 160;
export const DESIGN_LEFT_PANEL_MAX_WIDTH = 460;

const FALLBACK_CONTAINER_WIDTH = 900;
const NARROW_CONTAINER_MIN_PANEL_SHARE = 25;
const NARROW_CONTAINER_MIN_WIDTH_MAX_SHARE = 50;
const NARROW_CONTAINER_MAX_PANEL_SHARE = 75;

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

const widthToPercent = (width: number, containerWidth: number) =>
  clampPercent((width / containerWidth) * 100);

export const getDesignLeftPanelSizes = (containerWidth: number) => {
  const safeContainerWidth =
    containerWidth > 0 ? containerWidth : FALLBACK_CONTAINER_WIDTH;
  const minSize = Math.min(
    NARROW_CONTAINER_MIN_WIDTH_MAX_SHARE,
    widthToPercent(DESIGN_LEFT_PANEL_MIN_WIDTH, safeContainerWidth)
  );
  const maxSize = Math.max(
    minSize,
    Math.min(
      NARROW_CONTAINER_MAX_PANEL_SHARE,
      Math.max(
        NARROW_CONTAINER_MIN_PANEL_SHARE,
        widthToPercent(DESIGN_LEFT_PANEL_MAX_WIDTH, safeContainerWidth)
      )
    )
  );
  const defaultSize = Math.max(
    minSize,
    Math.min(
      maxSize,
      widthToPercent(
        Math.min(DESIGN_LEFT_PANEL_DEFAULT_WIDTH, safeContainerWidth),
        safeContainerWidth
      )
    )
  );

  return {
    defaultSize,
    minSize,
    maxSize,
    rightDefaultSize: 100 - defaultSize,
    rightMinSize: 100 - maxSize,
  };
};

export const useDesignLeftPanelSizes = (
  containerRef: RefObject<HTMLElement>
) => {
  const [sizes, setSizes] = useState(() =>
    getDesignLeftPanelSizes(FALLBACK_CONTAINER_WIDTH)
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const updateSizes = () => {
      const width = container.getBoundingClientRect().width;
      if (width <= 0) return;

      setSizes(getDesignLeftPanelSizes(width));
    };

    updateSizes();

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const resizeObserver = new ResizeObserver(updateSizes);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [containerRef]);

  return sizes;
};
