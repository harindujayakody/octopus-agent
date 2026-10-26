// Lint for the launcher app. Redesign guard rails: raw form controls and
// native title= tooltips are banned in src/ so UI code uses kit components,
// and the frozen old UI's kit alias stays out of the live app.
// See docs/ui-redesign/spec.md.
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import allowlist from "./eslint.allowlist.json" with { type: "json" };

const RAW_CONTROLS = ["button", "input", "select", "textarea"].map((tag) => ({
  selector: `JSXOpeningElement[name.name="${tag}"]`,
  message: `Raw <${tag}> is banned in the app: use the kit component instead.`,
}));
const TITLE_MESSAGE = "Native title= is banned: use IconButton's label or the kit Tooltip.";
const NATIVE_TITLE = [
  { selector: 'JSXOpeningElement[name.name=/^[a-z]/] > JSXAttribute[name.name="title"]', message: TITLE_MESSAGE },
  // Kit components that pass `title` straight to a DOM element. (Modal,
  // DialogModal, Alert, EmptyState and PageHeader take `title` as their heading.)
  {
    selector: 'JSXOpeningElement[name.name=/^(Button|IconButton|Badge|Chip|Tag|Checkbox|Radio|Switch|Input|Textarea|Slider)$/] > JSXAttribute[name.name="title"]',
    message: TITLE_MESSAGE,
  },
];

// WIG-01: a <label> around a segment picker or a Select passes a click on
// the caption to the control and changes the value.
const LABEL_WRAPS = ["SegmentControl", "SelectField", "Select"].map((name) => ({
  selector: `JSXElement[openingElement.name.name="label"] JSXOpeningElement[name.name="${name}"]`,
  message: `A <label> must not wrap a ${name}: a click on the caption would change the value (WIG-01). Use FieldGroup, or a <div> for a Select that has its own label.`,
}));

const onlyRaw = allowlist.rawControls.filter((f) => !allowlist.nativeTitle.includes(f));
const onlyTitle = allowlist.nativeTitle.filter((f) => !allowlist.rawControls.includes(f));
const both = allowlist.rawControls.filter((f) => allowlist.nativeTitle.includes(f));
// ESLint rejects an empty `files` list, so a block disappears once its list is empty.
const block = (files, rule) => (files.length > 0 ? [{ files, rules: { "no-restricted-syntax": rule } }] : []);

export default defineConfig(
  {
    ignores: [
      "dist/**", "dist-mock/**", "ui-kit/**", "src-tauri/**", "sdks/**",
      "mcp/**", "e2e/**", "scripts/**", "src/dev/**", "*.config.*",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    // Registered only so existing `eslint-disable … react-hooks/…` comments
    // resolve; none of its rules are switched on yet.
    plugins: { "react-hooks": reactHooks },
    // Those comments would otherwise be reported as unused.
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      "no-restricted-syntax": ["error", ...RAW_CONTROLS, ...NATIVE_TITLE, ...LABEL_WRAPS],
      "no-restricted-imports": ["error", {
        paths: [{ name: "@tauri-apps/plugin-opener", importNames: ["openPath"], message: "openPath runs what it opens. Use revealItemInDir (SEC-04)." }],
      }],
    },
  },
  // Files that still hold banned patterns, per rule. The lists only shrink:
  // scripts/check-allowlist.mjs fails when a listed file is already clean.
  ...block(onlyRaw, ["error", ...NATIVE_TITLE, ...LABEL_WRAPS]),
  ...block(onlyTitle, ["error", ...RAW_CONTROLS, ...LABEL_WRAPS]),
  ...block(both, "off"),
);
