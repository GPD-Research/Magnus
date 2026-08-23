import { describe, expect, it } from 'vitest'
import {
  listSavedScenes,
  removeSceneReference,
  saveSceneReference,
  sceneFileBaseName,
} from './savedScenes'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

describe('saved scene library', () => {
  it('normalizes user-selected JSON filenames', () => {
    expect(sceneFileBaseName(' I-95 Exit 143.magnus.json ')).toBe('I-95-Exit-143')
    expect(sceneFileBaseName('scene?.json')).toBe('scene')
    expect(sceneFileBaseName('***')).toBe('magnus-scene')
  })

  it('lists newest scenes first and replaces a matching filename', () => {
    const storage = memoryStorage()
    saveSceneReference(storage, 'First scene', '{"version":1}', '2026-08-22T10:00:00Z')
    saveSceneReference(storage, 'Second scene', '{"version":2}', '2026-08-23T10:00:00Z')
    saveSceneReference(storage, 'first-scene', '{"version":3}', '2026-08-24T10:00:00Z')

    expect(listSavedScenes(storage)).toEqual([
      { name: 'first-scene', savedAt: '2026-08-24T10:00:00Z', document: '{"version":3}' },
      { name: 'Second-scene', savedAt: '2026-08-23T10:00:00Z', document: '{"version":2}' },
    ])
  })

  it('removes a saved scene reference', () => {
    const storage = memoryStorage()
    saveSceneReference(storage, 'Training scene', '{}')

    expect(removeSceneReference(storage, 'Training-scene')).toEqual([])
    expect(listSavedScenes(storage)).toEqual([])
  })
})