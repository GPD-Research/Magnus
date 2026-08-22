import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  connectivityQuery,
  loadAppSettings,
  themeTokens,
} from './appSettings'

describe('application settings', () => {
  it('defaults to online mode and the dark theme', () => {
    expect(loadAppSettings({ getItem: () => null })).toEqual(DEFAULT_APP_SETTINGS)
  })

  it('rejects invalid persisted settings', () => {
    expect(loadAppSettings({ getItem: () => '{"version":1,"connectivityMode":"airplane"}' }))
      .toEqual(DEFAULT_APP_SETTINGS)
  })

  it('migrates version 1 settings with both workspace panes open', () => {
    const versionOne = {
      ...DEFAULT_APP_SETTINGS,
      version: 1,
      leftPaneCollapsed: undefined,
      rightPaneCollapsed: undefined,
    }

    expect(loadAppSettings({ getItem: () => JSON.stringify(versionOne) })).toMatchObject({
      version: 2,
      leftPaneCollapsed: false,
      rightPaneCollapsed: false,
    })
  })

  it('restores persisted workspace pane state', () => {
    const stored = {
      ...DEFAULT_APP_SETTINGS,
      leftPaneCollapsed: true,
      rightPaneCollapsed: true,
    }

    expect(loadAppSettings({ getItem: () => JSON.stringify(stored) })).toEqual(stored)
  })

  it('encodes the selected connectivity source for road requests', () => {
    expect(connectivityQuery('offline')).toBe('source=offline')
    expect(connectivityQuery('lan')).toBe('source=lan')
  })

  it('derives custom theme tokens from the saved color', () => {
    expect(themeTokens('custom-2', DEFAULT_APP_SETTINGS.customThemes)).toEqual({
      scheme: 'custom',
      accent: '#2f6681',
    })
  })
})