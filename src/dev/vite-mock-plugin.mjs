// `npm run dev:mock` and `npm run preview:mock`: runs the frontend in a plain
// browser against an in-page stand-in for the Tauri IPC bridge
// (src/dev/mock), with seeded profiles, proxies and fingerprints. The shim script is injected ahead of the app entry so
// `invoke` finds it on first call. Plain JS, so vite.config.ts can load it
// without a TypeScript loader; `npm run strip:dev` deletes it with the rest of
// src/dev. Never active in `tauri dev` or a release build.
export function mockIpc() {
  return {
    name: "shardx-mock-ipc",
    transformIndexHtml: {
      // "pre" so a mock build (`npm run preview:mock`) bundles the shim too.
      order: "pre",
      handler(html) {
        return {
          html,
          tags: [{ tag: "script", attrs: { type: "module", src: "/src/dev/mock/install.ts" }, injectTo: "head" }],
        };
      },
    },
  };
}
