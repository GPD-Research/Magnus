export interface OfflineRegionStatus {
  id: 'northern-virginia' | 'virginia'
  label: string
  installed: boolean
  bytes: number
}

export interface OfflineStatus {
  regions: OfflineRegionStatus[]
  cachedScenes: number
  cacheBytes: number
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error ?? `Offline service returned HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

export async function loadOfflineStatus(): Promise<OfflineStatus> {
  return readJsonResponse<OfflineStatus>(await fetch('/api/offline/status'))
}

export async function prepareOfflineRegion(region: OfflineRegionStatus['id']): Promise<OfflineStatus> {
  return readJsonResponse<OfflineStatus>(await fetch('/api/offline/prepare', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ region }),
  }))
}

export function formatStorageSize(bytes: number): string {
  if (bytes <= 0) return 'Not installed'
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}