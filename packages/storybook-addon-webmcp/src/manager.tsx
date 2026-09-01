/**
 * Manager entry (spec §24, §33). Registers the addon with the Storybook
 * Manager. The WebMCP service is started unconditionally, before the panel
 * is even added — its lifetime is the Manager's lifetime, not the panel's.
 * A service failure is caught so it can never prevent the Manager from
 * booting; the panel still renders (in an "unsupported"/idle state) either way.
 */
import * as React from 'react'
import { addons, types } from 'storybook/manager-api'

import { ADDON_ID, ADDON_TITLE, PANEL_ID } from './core/constants.js'
import { WebMCPPanel } from './panel/Panel.js'
import { setPanelService } from './panel/panel-store.js'
import { startWebMCPService } from './webmcp/service.js'

addons.register(ADDON_ID, (api) => {
  try {
    const service = startWebMCPService(api)
    setPanelService(service)
  } catch (error) {
    // `process` is not guaranteed to exist in a browser Manager bundle. Keep
    // diagnostics development-only without making the progressive-enhancement
    // path depend on a Node global.
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.error('[storybook-addon-webmcp] failed to start WebMCP service', error)
    }
  }

  addons.add(PANEL_ID, {
    type: types.PANEL,
    title: ADDON_TITLE,
    match: ({ viewMode }) => viewMode === 'story' || viewMode === 'docs',
    render: ({ active }) => <WebMCPPanel active={!!active} />,
  })
})
