import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'
import dts from 'vite-plugin-dts'
import { fileURLToPath, URL } from 'node:url'

const fromRoot = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/**
 * Library build — emits tree-shakeable ESM + type declarations to `dist/`.
 * The stylesheet is built separately via the Tailwind CLI (see `build:css`).
 * React is kept external (declared as a peer dependency).
 */
export default defineConfig({
  plugins: [
    react(),
    svgr({
      include: '**/*.svg?react',
      svgrOptions: { svgProps: { width: '1em', height: '1em' } },
    }),
    dts({
      tsconfigPath: './tsconfig.app.json',
      include: ['src'],
      exclude: [
        'src/demo/**',
        'src/App.tsx',
        'src/main.tsx',
        // icon .d.ts is generated separately (see scripts/gen-icon-types.mjs)
        'src/icons/**',
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/test/**',
      ],
      entryRoot: 'src',
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: {
        index: fromRoot('./src/index.ts'),
        'icons/index': fromRoot('./src/icons/index.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@hugeicons/react',
        '@hugeicons/core-free-icons',
      ],
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
        entryFileNames: '[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
