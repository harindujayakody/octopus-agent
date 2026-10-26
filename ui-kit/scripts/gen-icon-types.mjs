// Generates dist/icons/index.d.ts — clean type declarations for every icon
// component, so consumers get types without needing the .svg files or SVGR.
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs'

const svgDir = 'src/icons/svg'
const files = readdirSync(svgDir)
  .filter((f) => f.endsWith('.svg'))
  .sort()

const pascal = (name) =>
  'Ri' +
  name
    .slice(0, -4)
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join('')

const seen = new Set()
let out =
  "import type { FC, SVGProps } from 'react'\n\n" +
  'export type IconComponent = FC<SVGProps<SVGSVGElement>>\n\n'

for (const f of files) {
  const comp = pascal(f)
  if (seen.has(comp)) continue
  seen.add(comp)
  out += `export declare const ${comp}: IconComponent\n`
}

mkdirSync('dist/icons', { recursive: true })
writeFileSync('dist/icons/index.d.ts', out)
console.log(`Generated dist/icons/index.d.ts (${seen.size} icons)`)
