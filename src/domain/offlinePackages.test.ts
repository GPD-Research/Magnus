import { describe, expect, it } from 'vitest'
import { formatStorageSize } from './offlinePackages'

describe('offline package presentation', () => {
  it('formats missing and installed package sizes', () => {
    expect(formatStorageSize(0)).toBe('Not installed')
    expect(formatStorageSize(2048)).toBe('2 KB')
    expect(formatStorageSize(12 * 1024 * 1024)).toBe('12 MB')
  })
})