import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')

let totalScore = 0
let maxScore = 0
const results = []

function check(name, weight, condition, detail = '') {
  maxScore += weight
  const pass = Boolean(condition)
  totalScore += pass ? weight : 0
  results.push({ name, weight, earned: pass ? weight : 0, pass, detail })
}

const deckMapPath = path.join(SRC, 'components', 'DeckMapView.jsx')
const deckMapExists = fs.existsSync(deckMapPath)
check('DeckMapView component file exists', 10, deckMapExists)

if (deckMapExists) {
  const src = fs.readFileSync(deckMapPath, 'utf8')
  check('Uses @deck.gl/react DeckGL', 10, src.includes("from '@deck.gl/react'") && src.includes('DeckGL'))
  check('Free MapLibre base map (no API key)', 10, src.includes('maplibre') && src.includes('react-map-gl/maplibre') && !src.includes('mapboxAccessToken'))
  check('HeatmapLayer present', 3, src.includes('HeatmapLayer'))
  check('ScatterplotLayer present', 3, src.includes('ScatterplotLayer'))
  check('HexagonLayer present', 3, src.includes('HexagonLayer'))
  check('GeoJsonLayer present (Future-02)', 3, src.includes('GeoJsonLayer'))
  check('Correct [lng, lat] order for deck.gl', 8, src.includes('[d.lng, d.lat]') || src.includes('[d[1], d[0]]'))
  check('Urgency RGBA color mapping', 8, src.includes('URGENCY_COLOR') && src.includes('CRITICAL'))
  check('Hover tooltip (pickable + onHover)', 5, src.includes('pickable: true') && src.includes('onHover') && src.includes('tooltip'))
  check('onClick handler for ticket selection', 5, src.includes('onClick') && src.includes('onTicketClick'))
  check('Responsive height prop', 5, src.includes('height ='))
}

const hotspotMapPath = path.join(SRC, 'pages', 'admin', 'HotspotMapPage.jsx')
if (fs.existsSync(hotspotMapPath)) {
  const hSrc = fs.readFileSync(hotspotMapPath, 'utf8')
  check('HotspotMapPage uses DeckMapView not MapContainer', 10, hSrc.includes('DeckMapView') && !hSrc.includes('MapContainer'))
  check('HotspotMapPage has 3D Hexagon toggle', 5, hSrc.includes('showHexagon') && hSrc.includes('toggle-hexagon'))
}

const vSrc = fs.readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8')
check('vite.config.js splits deck.gl chunk (PWA)', 8, vSrc.includes('manualChunks') && vSrc.includes('deck'))

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const deps = { ...pkg.dependencies, ...pkg.devDependencies }
check('@deck.gl/core installed', 2, '@deck.gl/core' in deps)
check('@deck.gl/layers installed', 2, '@deck.gl/layers' in deps)
check('@deck.gl/react installed', 2, '@deck.gl/react' in deps)
check('maplibre-gl installed', 1, 'maplibre-gl' in deps)
check('react-map-gl installed', 1, 'react-map-gl' in deps)

console.log('\n' + '='.repeat(72))
console.log('  JanSahayAI — deck.gl Integration Score Report')
console.log('='.repeat(72))
const passed = results.filter(r => r.pass)
const failed = results.filter(r => !r.pass)
console.log('\nPASSED (' + passed.length + '/' + results.length + ')')
passed.forEach(r => console.log('  [+' + String(r.weight).padStart(2) + 'pts] ' + r.name))
if (failed.length) {
  console.log('\nFAILED (' + failed.length + '/' + results.length + ')')
  failed.forEach(r => console.log('  [  0/' + r.weight + 'pts] ' + r.name + (r.detail ? '\n         -> ' + r.detail : '')))
}
const pct = Math.round((totalScore / maxScore) * 100)
const bar = 'X'.repeat(Math.floor(pct/5)) + '.'.repeat(20-Math.floor(pct/5))
console.log('\n' + '='.repeat(72))
console.log('  SCORE: ' + totalScore + '/' + maxScore + '  [' + bar + ']  ' + pct + '%')
if (pct >= 90) console.log('  EXCELLENT — Production-grade civic GPU map')
else if (pct >= 80) console.log('  PASS — deck.gl integration complete')
else if (pct >= 65) console.log('  PARTIAL — Some checks need fixing')
else console.log('  FAIL — Significant issues remain')
console.log('  Threshold: 80/100 required')
console.log('='.repeat(72) + '\n')
process.exit(pct >= 80 ? 0 : 1)
