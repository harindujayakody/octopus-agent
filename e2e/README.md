# End-to-end tests

- Quick runs while editing (dev server, port 1420 or `E2E_PORT`): `npx playwright test e2e/x.spec.ts`
- Full run (production build of the mock, 15 s per test): `E2E_PORT=<free port> npm run e2e:built -- --workers=3 --grep-invert @visual`. The build needs `E2E_PORT`; never use 1420 or 4173.
- Re-run only what failed, in either mode: add `--last-failed` (reads `test-results/.last-run.json`).
- A test that checks dev-only behavior is tagged `@devserver` and skipped in built mode. One that needs more than 15 s uses `test.slow()` with a reason.
