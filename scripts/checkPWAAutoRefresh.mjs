import { readFileSync } from 'node:fs'

const source = readFileSync('src/components/ui/PWAUpdatePrompt.tsx', 'utf8')
const failures = []

if (!source.includes('updateServiceWorker(true)')) {
  failures.push('PWA update flow must call updateServiceWorker(true).')
}

if (!/useEffect\(\(\)\s*=>\s*\{\s*if \(!needRefresh\) return\s*updateServiceWorker\(true\)/s.test(source)) {
  failures.push('PWA update flow must automatically refresh when needRefresh becomes true.')
}

for (const manualUpdateCopy of ['刷新更新', '稍后再更新', '新版本已准备好']) {
  if (source.includes(manualUpdateCopy)) {
    failures.push(`Manual update copy should not be rendered: ${manualUpdateCopy}`)
  }
}

if (failures.length > 0) {
  console.error(['PWA auto refresh check failed:', ...failures.map((item) => `- ${item}`)].join('\n'))
  process.exit(1)
}

console.log('PWA auto refresh check passed.')
