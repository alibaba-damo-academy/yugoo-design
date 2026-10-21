#!/usr/bin/env node
import assert from 'node:assert/strict'

import {
  automaticDesignDockWidth,
  clampDesignDockWidth,
  COLLAPSED_NAV_WIDTH,
  CONVERSATION_MIN_WIDTH,
  DESIGN_DOCK_MIN_WIDTH,
} from './lib/index.js'

const wideViewport = 2560
const wideWorkspace = wideViewport - COLLAPSED_NAV_WIDTH
assert.equal(automaticDesignDockWidth(wideViewport), Math.round(wideWorkspace * 0.7))
assert.equal(wideWorkspace - automaticDesignDockWidth(wideViewport), Math.round(wideWorkspace * 0.3))

// Mid-size layouts retain the 70/30 Design-first split when both columns fit.
const constrainedViewport = 1280
assert.equal(
  automaticDesignDockWidth(constrainedViewport),
  Math.round((constrainedViewport - COLLAPSED_NAV_WIDTH) * 0.7),
)
assert.equal(automaticDesignDockWidth(700), DESIGN_DOCK_MIN_WIDTH)
assert.equal(automaticDesignDockWidth(Number.NaN), DESIGN_DOCK_MIN_WIDTH)

const expandedNavigation = 240
const expandedWorkspace = wideViewport - expandedNavigation
assert.equal(automaticDesignDockWidth(wideViewport, expandedNavigation), Math.round(expandedWorkspace * 0.7))

// Dragged width is re-clamped when the Host navigation or viewport changes;
// the default 70/30 calculation remains independent of this safety path.
const maximumCollapsedDock = wideViewport - COLLAPSED_NAV_WIDTH - CONVERSATION_MIN_WIDTH
assert.equal(clampDesignDockWidth(wideViewport, wideViewport, COLLAPSED_NAV_WIDTH), maximumCollapsedDock)
const maximumExpandedDock = wideViewport - expandedNavigation - CONVERSATION_MIN_WIDTH
assert.equal(clampDesignDockWidth(wideViewport, maximumCollapsedDock, expandedNavigation), maximumExpandedDock)
assert.equal(clampDesignDockWidth(1280, 640, COLLAPSED_NAV_WIDTH), 640)
assert.equal(clampDesignDockWidth(700, 500, COLLAPSED_NAV_WIDTH), DESIGN_DOCK_MIN_WIDTH)
assert.equal(clampDesignDockWidth(Number.NaN, Number.NaN), DESIGN_DOCK_MIN_WIDTH)

console.log('DESIGN DOCK LAYOUT OK')
