import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import svgr from 'vite-plugin-svgr'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Import `*.svg?react` as React components. Icons keep `fill="currentColor"`
    // so they inherit the surrounding text colour (and therefore the theme),
    // and default to 1em so `className` sizing (e.g. `size-5`) controls them.
    svgr({
      include: '**/*.svg?react',
      svgrOptions: {
        svgProps: { width: '1em', height: '1em' },
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
