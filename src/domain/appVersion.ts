export function releaseVersionLabel(version: string): string {
  const [release, prerelease] = version.split('-', 2)
  const [major, minor] = release.split('.')
  const label = !minor || minor === '0' ? `v${major}` : `v${major}.${minor}`
  const releaseCandidate = /^rc\.(\d+)$/i.exec(prerelease ?? '')
  return releaseCandidate ? `${label} RC${releaseCandidate[1]}` : label
}