export type ConnectivityMode = 'online' | 'lan' | 'offline'
export type ThemeId = 'dark' | 'light' | 'custom-1' | 'custom-2' | 'custom-3'

export interface CustomTheme {
  name: string
  color: string
}

export interface AppSettings {
  version: 2
  connectivityMode: ConnectivityMode
  theme: ThemeId
  customThemes: Record<'custom-1' | 'custom-2' | 'custom-3', CustomTheme>
  leftPaneCollapsed: boolean
  rightPaneCollapsed: boolean
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  version: 2,
  connectivityMode: 'online',
  theme: 'dark',
  customThemes: {
    'custom-1': { name: 'Custom 1', color: '#2d6a4f' },
    'custom-2': { name: 'Custom 2', color: '#2f6681' },
    'custom-3': { name: 'Custom 3', color: '#8a5a2b' },
  },
  leftPaneCollapsed: false,
  rightPaneCollapsed: false,
}

const connectivityModes: ConnectivityMode[] = ['online', 'lan', 'offline']
const themeIds: ThemeId[] = ['dark', 'light', 'custom-1', 'custom-2', 'custom-3']
const customThemeIds = ['custom-1', 'custom-2', 'custom-3'] as const

export function loadAppSettings(storage: Pick<Storage, 'getItem'>): AppSettings {
  try {
    const stored = storage.getItem('magnus.settings')
    if (!stored) return DEFAULT_APP_SETTINGS
    const parsed = JSON.parse(stored) as Partial<Omit<AppSettings, 'version'>> & { version?: number }
    if ((parsed.version !== 1 && parsed.version !== 2)
      || !connectivityModes.includes(parsed.connectivityMode!)
      || !themeIds.includes(parsed.theme!)) {
      return DEFAULT_APP_SETTINGS
    }
    const customThemes = { ...DEFAULT_APP_SETTINGS.customThemes }
    for (const id of customThemeIds) {
      const candidate = parsed.customThemes?.[id]
      if (candidate && typeof candidate.name === 'string' && /^#[0-9a-f]{6}$/i.test(candidate.color)) {
        customThemes[id] = candidate
      }
    }
    return {
      version: 2,
      connectivityMode: parsed.connectivityMode!,
      theme: parsed.theme!,
      customThemes,
      leftPaneCollapsed: parsed.version === 2 && parsed.leftPaneCollapsed === true,
      rightPaneCollapsed: parsed.version === 2 && parsed.rightPaneCollapsed === true,
    }
  } catch {
    return DEFAULT_APP_SETTINGS
  }
}

export function saveAppSettings(storage: Pick<Storage, 'setItem'>, settings: AppSettings) {
  storage.setItem('magnus.settings', JSON.stringify(settings))
}

export function connectivityQuery(mode: ConnectivityMode): string {
  return `source=${mode}`
}

export function themeTokens(theme: ThemeId, customThemes: AppSettings['customThemes']) {
  if (theme === 'dark') return { scheme: 'dark', accent: '#2d936b' }
  if (theme === 'light') return { scheme: 'light', accent: '#2d6a4f' }
  return { scheme: 'custom', accent: customThemes[theme].color }
}