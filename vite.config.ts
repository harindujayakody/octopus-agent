import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const mock = process.env.VITE_MOCK === "1";
// Dev scaffolding is optional here, so `npm run strip:dev` can delete it and
// this file still builds (overview A3): the mock plugin lives in src/dev.
const MOCK_PLUGIN = here("./src/dev/vite-mock-plugin.mjs");

// The e2e build (E2E_BUILT=1, see playwright.config.ts) lists every source
// module on `window.__e2eModules`, so a spec's `appModule()` can reach the
// same instance the app uses, as it does on the dev server by path. Never set
// for a release or perf build. Unit tests (node --test) are not app modules.
// @ts-expect-error process is a nodejs global
const e2eModules = process.env.VITE_E2E_MODULES === "1";
const E2E_ID = "virtual:e2e-modules";
const e2eModulesPlugin = {
  name: "e2e-modules",
  resolveId: (id: string) => (id === E2E_ID ? "\0" + E2E_ID : undefined),
  load: (id: string) => (id === "\0" + E2E_ID ? 'window.__e2eModules = import.meta.glob(["/src/**/*.{ts,tsx}", "!/src/**/*.test.ts"]);' : undefined),
  transformIndexHtml: {
    order: "pre" as const,
    handler: () => [{ tag: "script", attrs: { type: "module" }, children: `import "${E2E_ID}";`, injectTo: "head-prepend" as const }],
  },
};

// https://vite.dev/config/
export default defineConfig(async () => {
  // A computed specifier: the config bundler must not try to resolve a file that may be gone.
  const mockPlugins = mock && existsSync(MOCK_PLUGIN) ? [(await import(pathToFileURL(MOCK_PLUGIN).href)).mockIpc()] : [];
  return {
    plugins: [tailwindcss(), react(), ...mockPlugins, ...(e2eModules ? [e2eModulesPlugin] : [])],

    resolve: {
      // ui-kit/node_modules holds a second @hugeicons copy; one is enough (PERF-25).
      dedupe: ["@hugeicons/react", "@hugeicons/core-free-icons"],
    },
    build: {
      // Flag files stay files, fetched when a flag is shown; inlined, they
      // would sit in the script as data URIs (PERF-16).
      assetsInlineLimit: (file: string) => (file.includes("/flag-icons/flags/") ? false : undefined),
      rollupOptions: {
        input: {
          main: here("./index.html"),
          // The e2e build also serves the kit test pages (e2e/kit/*.html), as the dev server does.
          ...(e2eModules ? Object.fromEntries(readdirSync(here("./e2e/kit")).filter((f) => f.endsWith(".html")).map((f) => [`e2e-kit-${f}`, here(`./e2e/kit/${f}`)])) : {}),
        },
      },
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: 1420,
      strictPort: true,
      // Bind the literal IPv4 loopback (not `false`, which lets Node resolve
      // `localhost` to `::1` on Windows and listen IPv6-only — then Tauri's
      // health-check hangs forever at "Waiting for your frontend dev server to
      // start"). Must match devUrl in tauri.conf.json.
      host: host || "127.0.0.1",
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        // 3. tell Vite to ignore watching `src-tauri`, and the other Rust and
        // SDK trees: a cargo build writing into team-server/target reloaded
        // the page once per file.
        ignored: ["**/src-tauri/**", "**/team-server/**", "**/sdks/**"],
      },
    },
  };
});
