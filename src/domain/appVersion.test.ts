import { describe, expect, it } from 'vitest'
import { releaseVersionLabel } from './appVersion'

describe('application version label', () => {
  it('shows the current major and minor release', () => {
    expect(releaseVersionLabel('4.5.0')).toBe('v4.5')
  })

  it('simplifies a new major milestone', () => {
    expect(releaseVersionLabel('5.0.0')).toBe('v5')
  })

  it('identifies release candidates', () => {
    expect(releaseVersionLabel('5.0.0-rc.1')).toBe('v5 RC1')
  })

  it('shows later Version 5 minor releases', () => {
    expect(releaseVersionLabel('5.1.0')).toBe('v5.1')
  })
})