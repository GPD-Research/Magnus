export function releaseVersionLabel(version: string): string {
  const [major, minor] = version.split('.')
  return !minor || minor === '0' ? `v${major}` : `v${major}.${minor}`
}