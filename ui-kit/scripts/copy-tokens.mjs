// Copies the raw tokens stylesheet into dist so Tailwind-based host projects
// can @import it (variables + typography) and generate the kit's utilities
// with their own single Tailwind instance (via @source).
import { copyFileSync } from 'node:fs'

copyFileSync('src/styles/tokens.css', 'dist/tokens.css')
console.log('Copied dist/tokens.css')
