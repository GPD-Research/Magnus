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

  it('migrates older settings with default interface scale', () => {
    const versionOne = {
      ...DEFAULT_APP_SETTINGS,
      version: 1,
      leftPaneCollapsed: undefined,
      rightPaneCollapsed: undefined,
    }

    expect(loadAppSettings({ getItem: () => JSON.stringify(versionOne) })).toMatchObject({
      version: 3,
      interfaceScale: 100,
      leftPaneCollapsed: false,
      rightPaneCollapsed: false,
    })

    const versionTwo = { ...DEFAULT_APP_SETTINGS, version: 2, interfaceScale: undefined }
    expect(loadAppSettings({ getItem: () => JSON.stringify(versionTwo) })).toMatchObject({
      version: 3,
      interfaceScale: 100,
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

  it('restores and clamps persisted interface scale', () => {
    expect(loadAppSettings({ getItem: () => JSON.stringify({ ...DEFAULT_APP_SETTINGS, interfaceScale: 140 }) }).interfaceScale).toBe(140)
    expect(loadAppSettings({ getItem: () => JSON.stringify({ ...DEFAULT_APP_SETTINGS, interfaceScale: 200 }) }).interfaceScale).toBe(160)
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