import { readFile } from 'node:fs/promises'

const artifactPath = process.argv[2]
if (!artifactPath) {
  console.error('usage: node tools/topology-worker/check-exit-143.mjs <topology.json>')
  process.exit(2)
}

const artifact = JSON.parse(await readFile(artifactPath, 'utf8'))
const roads = artifact.roads ?? []
const intersections = artifact.intersections ?? []
const markings = artifact.markings ?? []
const diagnostics = artifact.diagnostics ?? []

const assertions = [
  ['topology artifact uses feet', artifact.coordinateUnits === 'feet'],
  ['real extract retains normalized roads', roads.length >= 20],
  ['real extract retains normalized intersections', intersections.length >= 1],
  ['bridge evidence survives normalization', roads.some((road) => road.bridge === true)],
  ['grade-separated crossing is diagnosed', diagnostics.some((diagnostic) => diagnostic.kind === 'grade-separated')],
  ['semantic markings are exported', markings.length > 0],
  ['semantic markings retain source way IDs', markings.every((marking) => marking.sourceWayIds?.length > 0)],
]

const failures = assertions.filter(([, passed]) => !passed).map(([label]) => label)
if (failures.length > 0) {
  console.error(`Exit 143 acceptance failed: ${failures.join('; ')}`)
  process.exit(1)
}

console.log(JSON.stringify({
  roads: roads.length,
  intersections: intersections.length,
  markings: markings.length,
  diagnostics: diagnostics.length,
  bridgeRoads: roads.filter((road) => road.bridge === true).length,
  gradeSeparatedDiagnostics: diagnostics.filter((diagnostic) => diagnostic.kind === 'grade-separated').length,
}, null, 2))
