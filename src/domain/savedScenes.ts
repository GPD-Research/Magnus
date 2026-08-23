export interface SavedSceneEntry {
  name: string
  savedAt: string
  document: string
}

interface SceneLibraryStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const SAVED_SCENES_KEY = 'magnus.saved-scenes'

export function sceneFileBaseName(value: string): string {
  const withoutExtension = value.trim().replace(/(?:\.magnus)?\.json$/i, '')
  return withoutExtension
    .replace(/[^a-z0-9 _-]+/gi, '')
    .trim()
    .replace(/\s+/g, '-') || 'magnus-scene'
}

export function listSavedScenes(storage: SceneLibraryStorage): SavedSceneEntry[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SAVED_SCENES_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry: unknown): entry is SavedSceneEntry => {
        if (!entry || typeof entry !== 'object') return false
        const candidate = entry as Partial<SavedSceneEntry>
        return typeof candidate.name === 'string'
          && typeof candidate.savedAt === 'string'
          && typeof candidate.document === 'string'
      })
      .sort((first, second) => second.savedAt.localeCompare(first.savedAt))
  } catch {
    return []
  }
}

export function saveSceneReference(
  storage: SceneLibraryStorage,
  name: string,
  document: string,
  savedAt = new Date().toISOString(),
): SavedSceneEntry[] {
  const normalizedName = sceneFileBaseName(name)
  const entries = listSavedScenes(storage).filter(
    (entry) => entry.name.toLowerCase() !== normalizedName.toLowerCase(),
  )
  const updated = [{ name: normalizedName, savedAt, document }, ...entries]
  storage.setItem(SAVED_SCENES_KEY, JSON.stringify(updated))
  return updated
}

export function removeSceneReference(
  storage: SceneLibraryStorage,
  name: string,
): SavedSceneEntry[] {
  const updated = listSavedScenes(storage).filter((entry) => entry.name !== name)
  storage.setItem(SAVED_SCENES_KEY, JSON.stringify(updated))
  return updated
}