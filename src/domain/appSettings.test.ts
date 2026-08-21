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