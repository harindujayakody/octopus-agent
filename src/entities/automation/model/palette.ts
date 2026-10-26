/** The block library: what an operator can add by hand, grouped the way the
 *  picker shows it. Recording from the live browser adds the same kinds.
 *
 *  `label`, `about` and `hint` hold TRANSLATION KEYS, not text — the English
 *  lives in shared/i18n/locales/en.json under the same key. Whatever renders
 *  one puts it through t() first; searching does the same, so a person types
 *  what they see. */

import {
  ApiIcon,
  ArrowLeft02Icon,
  ArrowRight02Icon,
  StopCircleIcon,
  ArrowReloadHorizontalIcon,
  ArrowTurnForwardIcon,
  Calculator01Icon,
  Camera01Icon,
  CancelCircleIcon,
  Clock01Icon,
  CodeIcon,
  CodeSquareIcon,
  ConsoleIcon,
  Cursor01Icon,
  CursorHold01Icon,
  CursorPointer01Icon,
  CursorRectangleSelection01Icon,
  Database01Icon,
  DatabaseIcon,
  DatabaseLockedIcon,
  DatabaseSearchIcon,
  DatabaseZapIcon,
  DicesIcon,
  Download04Icon,
  DragDropHorizontalIcon,
  DragDropIcon,
  Edit02Icon,
  Eraser01Icon,
  FileAddIcon,
  FloppyDiskIcon,
  GitBranchIcon,
  Globe02Icon,
  HandGripIcon,
  HourglassIcon,
  KeyboardIcon,
  Link01Icon,
  Link04Icon,
  Loading03Icon,
  Login01Icon,
  Logout01Icon,
  MousePointerClickIcon,
  MousePointerIcon,
  MouseRightClick01Icon,
  MouseScroll01Icon,
  MoveDiagonalIcon,
  NetworkIcon,
  ScanEyeIcon,
  Shield01Icon,
  SmartphoneIcon,
  SplitIcon,
  Table01Icon,
  TextAlignLeftIcon,
  TextCheckIcon,
  TextFontIcon,
  TextNumberSignIcon,
  TextSearchIcon,
  TextSelectIcon,
  Touch01Icon,
  TouchInteraction01Icon,
  Upload04Icon,
  User03Icon,
  UserAdd01Icon,
  UserIcon,
  UserRemove01Icon,
  VariableIcon,
  ViewIcon,
  ViewOffSlashIcon,
  WorkflowSquare03Icon,
  PuzzleIcon,
  Layers01Icon,
} from "@hugeicons/core-free-icons";

/** A Hugeicons stroke glyph (data, drawn by StepIcon). */
export type StepIconData = typeof Globe02Icon;


export type ParamKind =
  | "text"
  /** A number, or a `{{variable}}` the runner expands into one before it
   *  parses it (runner.rs, `param_f64`) — every number below is read that
   *  way, so every one of them may hold a reference instead. */
  | "number"
  | "url"
  | "key"
  | "select"
  | "textarea"
  /** A saved project, chosen from a list. */
  | "project"
  /** An entry point inside the project another param names. */
  | "projectStep";

export type ParamSpec = {
  name: string;
  label: string;
  kind: ParamKind;
  /** Shown when the field is empty. */
  hint?: string;
  /** A number setting's digits after the point: 0 for px, ms and counts,
   *  so "1,000" reads as 1000 (F11 fix round 3). Unset keeps 2, for seconds,
   *  a scale and a module's own settings. */
  decimals?: number;
  /** A number setting's range, brought into when the field is left. */
  min?: number;
  max?: number;
  options?: string[];
  default?: string | number;
  /** For a dependent picker: the sibling param whose value it reads. */
  of?: string;
  /** Can hold something that must not leave the machine — a password, a token,
   *  a proxy with credentials in it. Only these fields offer "secret", which
   *  blanks the value on export. A folder name or a CSS selector does not. */
  secret?: boolean;
};

export type BlockSpec = {
  kind: string;
  /** The glyph beside the step everywhere it shows (blockIcon reads it). */
  icon?: StepIconData;
  label: string;
  /** One line, shown under the name in the picker. */
  about: string;
  params: ParamSpec[];
};

export type Category = { id: string; label: string; icon?: StepIconData; blocks: BlockSpec[] };

export const PALETTE: Category[] = [
  {
    id: "profile",
    icon: UserIcon,
    label: "palette.cat.profile",
    blocks: [
      {
        kind: "profile.temp",
        icon: Clock01Icon,
        label: "palette.profileTemp.label",
        about: "palette.profileTemp.about",
        params: [
          { name: "platform", label: "palette.profileTemp.platform.label", kind: "select", options: ["", "windows", "macos", "linux", "android"] },
          { name: "proxy", label: "palette.profileTemp.proxy.label", kind: "text", hint: "palette.profileTemp.proxy.hint", secret: true },
          { name: "into", label: "palette.profileTemp.into.label", kind: "text", hint: "palette.profileTemp.into.hint" },
        ],
      },
      {
        kind: "profile.create",
        icon: UserAdd01Icon,
        label: "palette.profileCreate.label",
        about: "palette.profileCreate.about",
        params: [
          { name: "name", label: "palette.profileCreate.name.label", kind: "text", hint: "palette.profileCreate.name.hint" },
          { name: "folder", label: "palette.profileCreate.folder.label", kind: "text", default: "Automation" },
          { name: "platform", label: "palette.profileCreate.platform.label", kind: "select", options: ["", "windows", "macos", "linux", "android"] },
          { name: "proxy", label: "palette.profileCreate.proxy.label", kind: "text", hint: "palette.profileCreate.proxy.hint", secret: true },
          { name: "into", label: "palette.profileCreate.into.label", kind: "text", hint: "palette.profileCreate.into.hint" },
        ],
      },
      {
        kind: "proxy.swap",
        icon: ArrowReloadHorizontalIcon,
        label: "palette.proxySwap.label",
        about: "blockPicker.about.proxySwap",
        params: [
          { name: "proxy", label: "palette.proxySwap.proxy.label", kind: "text", hint: "palette.proxySwap.proxy.hint", secret: true },
        ],
      },
      {
        kind: "profile.use",
        icon: UserIcon,
        label: "palette.profileUse.label",
        about: "palette.profileUse.about",
        params: [{ name: "id", label: "palette.profileUse.id.label", kind: "text", hint: "palette.profileUse.id.hint" }],
      },
      {
        kind: "profile.keep",
        icon: FloppyDiskIcon,
        label: "palette.profileKeep.label",
        about: "palette.profileKeep.about",
        params: [{ name: "folder", label: "palette.profileKeep.folder.label", kind: "text", hint: "palette.profileKeep.folder.hint" }],
      },
      {
        kind: "profile.read",
        icon: ViewIcon,
        label: "blockPicker.step.profileRead",
        about: "palette.profileRead.about",
        params: [
          {
            name: "path",
            label: "palette.profileRead.label",
            kind: "text",
            hint: "palette.text.path.hint",
          },
          { name: "into", label: "palette.text.into.label", kind: "text", hint: "palette.text.into.hint" },
        ],
      },
      {
        kind: "profile.delete",
        icon: UserRemove01Icon,
        label: "palette.profileDelete.label",
        about: "palette.profileDelete.about",
        params: [{ name: "id", label: "palette.profileDelete.id.label", kind: "text", hint: "palette.profileDelete.id.hint" }],
      },
    ],
  },
  {
    id: "proxy",
    icon: Shield01Icon,
    label: "palette.cat.proxy",
    blocks: [
      {
        kind: "proxy.set",
        icon: Shield01Icon,
        label: "palette.proxySet.label",
        about: "palette.proxySet.about",
        params: [{ name: "proxy", label: "palette.proxySet.proxy.label", kind: "text", hint: "palette.proxySet.proxy.hint", secret: true }],
      },
    ],
  },
  {
    id: "navigation",
    icon: Globe02Icon,
    label: "palette.cat.navigation",
    blocks: [
      {
        kind: "goto",
        icon: Globe02Icon,
        label: "palette.goto.label",
        about: "palette.goto.about",
        params: [{ name: "url", label: "palette.goto.url.label", kind: "url", hint: "palette.goto.url.hint" }],
      },
      { kind: "back", icon: ArrowLeft02Icon, label: "palette.back.label", about: "palette.back.about", params: [] },
      { kind: "forward", icon: ArrowRight02Icon, label: "palette.forward.label", about: "palette.forward.about", params: [] },
      { kind: "reload", icon: ArrowReloadHorizontalIcon, label: "palette.reload.label", about: "palette.reload.about", params: [] },
      {
        kind: "waitLoad",
        icon: Loading03Icon,
        label: "palette.waitload.label",
        about: "palette.waitload.about",
        params: [{ name: "timeout", label: "palette.waitload.timeout.label", kind: "number", default: 30 }],
      },
    ],
  },
  {
    // The phone-only steps: gestures a cursor cannot make, plus turning the
    // handset. The ordinary Pointer steps already become touches on a phone
    // profile — these are the ones with no desktop twin at all.
    id: "touch",
    icon: Touch01Icon,
    label: "palette.cat.touch",
    blocks: [
      {
        kind: "touch.tap",
        icon: Touch01Icon,
        label: "palette.touchTap.label",
        about: "palette.touchTap.about",
        params: [
          { name: "selector", label: "palette.touchTap.selector.label", kind: "text", hint: "palette.touchTap.selector.hint" },
          { name: "x", label: "palette.touchTap.x.label", kind: "number", decimals: 0 },
          { name: "y", label: "palette.touchTap.y.label", kind: "number", decimals: 0 },
          { name: "tapCount", label: "palette.touchTap.tapcount.label", kind: "number", decimals: 0, default: 1 },
          { name: "timeout", label: "palette.touchTap.timeout.label", kind: "number", default: 5 },
        ],
      },
      {
        kind: "touch.longPress",
        icon: CursorHold01Icon,
        label: "palette.touchLongPress.label",
        about: "palette.touchLongPress.about",
        params: [
          { name: "selector", label: "palette.touchLongPress.selector.label", kind: "text", hint: "palette.touchLongPress.selector.hint" },
          { name: "x", label: "palette.touchLongPress.x.label", kind: "number", decimals: 0 },
          { name: "y", label: "palette.touchLongPress.y.label", kind: "number", decimals: 0 },
          { name: "timeout", label: "palette.touchLongPress.timeout.label", kind: "number", default: 5 },
        ],
      },
      {
        kind: "touch.swipe",
        icon: TouchInteraction01Icon,
        label: "palette.touchSwipe.label",
        about: "palette.touchSwipe.about",
        params: [
          { name: "selector", label: "palette.touchSwipe.selector.label", kind: "text", hint: "palette.touchSwipe.selector.hint" },
          { name: "dx", label: "palette.touchSwipe.dx.label", kind: "number", decimals: 0, default: 0 },
          { name: "dy", label: "palette.touchSwipe.dy.label", kind: "number", decimals: 0, default: 0 },
          { name: "timeout", label: "palette.touchSwipe.timeout.label", kind: "number", default: 5 },
        ],
      },
      {
        kind: "touch.drag",
        icon: DragDropIcon,
        label: "palette.touchDrag.label",
        about: "palette.touchDrag.about",
        params: [
          { name: "selector", label: "palette.touchDrag.selector.label", kind: "text", hint: "palette.touchDrag.selector.hint" },
          { name: "to", label: "palette.touchDrag.to.label", kind: "text", hint: "palette.touchDrag.to.hint" },
          { name: "holdMs", label: "palette.touchDrag.holdms.label", kind: "number", decimals: 0, hint: "palette.touchDrag.holdms.hint" },
          { name: "timeout", label: "palette.touchDrag.timeout.label", kind: "number", default: 5 },
        ],
      },
      {
        kind: "touch.pinch",
        icon: MoveDiagonalIcon,
        label: "palette.touchPinch.label",
        about: "palette.touchPinch.about",
        params: [
          { name: "scale", label: "palette.touchPinch.scale.label", kind: "number", default: 2 },
          { name: "selector", label: "palette.touchPinch.selector.label", kind: "text", hint: "palette.touchPinch.selector.hint" },
          { name: "x", label: "palette.touchPinch.x.label", kind: "number", decimals: 0 },
          { name: "y", label: "palette.touchPinch.y.label", kind: "number", decimals: 0 },
        ],
      },
      {
        kind: "screen.rotate",
        icon: SmartphoneIcon,
        label: "palette.screenRotate.label",
        about: "palette.screenRotate.about",
        params: [
          { name: "angle", label: "palette.screenRotate.angle.label", kind: "number", decimals: 0, default: 90, hint: "palette.screenRotate.angle.hint" },
          { name: "turnMs", label: "palette.screenRotate.turnms.label", kind: "number", decimals: 0, hint: "palette.screenRotate.turnms.hint" },
          { name: "into", label: "palette.screenRotate.into.label", kind: "text", hint: "palette.screenRotate.into.hint" },
        ],
      },
    ],
  },
  {
    id: "pointer",
    icon: MousePointerIcon,
    label: "palette.cat.pointer",
    blocks: [
      {
        kind: "click",
        icon: MousePointerClickIcon,
        label: "palette.click.label",
        about: "palette.click.about",
        params: [{ name: "selector", label: "palette.click.selector.label", kind: "text", hint: "palette.click.selector.hint" },
          { name: "timeout", label: "palette.click.timeout.label", kind: "number", default: 5 },
        ],
      },
      {
        kind: "doubleClick",
        icon: CursorPointer01Icon,
        label: "palette.doubleclick.label",
        about: "palette.doubleclick.about",
        params: [{ name: "selector", label: "palette.doubleclick.selector.label", kind: "text", hint: "palette.doubleclick.selector.hint" },
          { name: "timeout", label: "palette.doubleclick.timeout.label", kind: "number", default: 5 },
        ],
      },
      {
        kind: "rightClick",
        icon: MouseRightClick01Icon,
        label: "palette.rightclick.label",
        about: "palette.rightclick.about",
        params: [{ name: "selector", label: "palette.rightclick.selector.label", kind: "text", hint: "palette.rightclick.selector.hint" },
          { name: "timeout", label: "palette.rightclick.timeout.label", kind: "number", default: 5 },
        ],
      },
      {
        kind: "hover",
        icon: Cursor01Icon,
        label: "palette.hover.label",
        about: "palette.hover.about",
        params: [{ name: "selector", label: "palette.hover.selector.label", kind: "text", hint: "palette.hover.selector.hint" },
          { name: "timeout", label: "palette.hover.timeout.label", kind: "number", default: 5 },
        ],
      },
      {
        kind: "drag",
        icon: DragDropHorizontalIcon,
        label: "blockPicker.step.drag",
        about: "palette.drag.about",
        params: [
          { name: "selector", label: "palette.drag.selector.label", kind: "text", hint: "palette.drag.selector.hint" },
          { name: "to", label: "palette.drag.to.label", kind: "text", hint: "palette.drag.to.hint" },
          {
            name: "button",
            label: "palette.drag.label",
            kind: "select",
            options: ["left", "middle", "right"],
            default: "left",
          },
          { name: "holdMs", label: "palette.select.holdms.label", kind: "number", decimals: 0, hint: "palette.select.holdms.hint" },
          { name: "timeout", label: "palette.select.timeout.label", kind: "number", default: 5 },
        ],
      },
      {
        kind: "swipe",
        icon: HandGripIcon,
        label: "blockPicker.step.swipe",
        about: "blockPicker.about.swipe",
        params: [
          { name: "selector", label: "palette.swipe.selector.label", kind: "text", hint: "palette.swipe.selector.hint" },
          { name: "dx", label: "palette.swipe.dx.label", kind: "number", decimals: 0, default: 0 },
          { name: "dy", label: "palette.swipe.dy.label", kind: "number", decimals: 0, default: 0 },
          {
            name: "button",
            label: "palette.swipe.label",
            kind: "select",
            options: ["left", "middle", "right"],
            default: "left",
          },
          { name: "timeout", label: "palette.select.timeout.label", kind: "number", default: 5 },
        ],
      },
      {
        kind: "scroll",
        icon: MouseScroll01Icon,
        label: "palette.scroll.label",
        about: "palette.scroll.about",
        params: [
          { name: "deltaY", label: "palette.scroll.deltay.label", kind: "number", decimals: 0, default: 600 },
          { name: "deltaX", label: "palette.scroll.deltax.label", kind: "number", decimals: 0, default: 0 },
          { name: "timeout", label: "palette.scroll.timeout.label", kind: "number", default: 5 },
        ],
      },
    ],
  },
  {
    id: "keyboard",
    icon: KeyboardIcon,
    label: "palette.cat.keyboard",
    blocks: [
      {
        kind: "type",
        icon: TextFontIcon,
        label: "palette.type.label",
        about: "palette.type.about",
        params: [
          { name: "text", label: "palette.type.text.label", kind: "text", hint: "palette.type.text.hint", secret: true },
          { name: "selector", label: "palette.type.selector.label", kind: "text", hint: "palette.type.selector.hint" },
          { name: "timeout", label: "palette.type.timeout.label", kind: "number", default: 5 },
        ],
      },
      {
        kind: "press",
        icon: KeyboardIcon,
        label: "palette.press.label",
        about: "palette.press.about",
        params: [
          { name: "key", label: "palette.press.key.label", kind: "key", hint: "palette.press.key.hint" },
          { name: "modifiers", label: "palette.press.modifiers.label", kind: "text", hint: "palette.press.modifiers.hint" },
        ],
      },
      {
        kind: "clear",
        icon: Eraser01Icon,
        label: "palette.clear.label",
        about: "palette.clear.about",
        params: [{ name: "selector", label: "palette.clear.selector.label", kind: "text", hint: "palette.clear.selector.hint" },
          { name: "timeout", label: "palette.clear.timeout.label", kind: "number", default: 5 },
        ],
      },
    ],
  },
  {
    id: "flow",
    icon: WorkflowSquare03Icon,
    label: "palette.cat.flow",
    blocks: [
      {
        kind: "flow.call",
        icon: WorkflowSquare03Icon,
        label: "palette.flowCall.label",
        about: "palette.flowCall.about",
        params: [
          { name: "project", label: "palette.flowCall.project.label", kind: "project" },
          { name: "entry", label: "palette.flowCall.entry.label", kind: "projectStep", of: "project", hint: "palette.flowCall.entry.hint" },
          { name: "in", label: "palette.flowCall.in.label", kind: "textarea", hint: "palette.flowCall.in.hint" },
          { name: "out", label: "palette.flowCall.out.label", kind: "text", hint: "palette.flowCall.out.hint" },
        ],
      },
      {
        kind: "flow.entry",
        icon: Login01Icon,
        label: "palette.flowEntry.label",
        about: "palette.flowEntry.about",
        params: [
          { name: "name", label: "palette.flowEntry.name.label", kind: "text", hint: "palette.flowEntry.name.hint" },
          { name: "about", label: "palette.flowEntry.about.label", kind: "text" },
        ],
      },
      {
        kind: "wait",
        icon: HourglassIcon,
        label: "palette.wait.label",
        about: "palette.wait.about",
        params: [{ name: "seconds", label: "palette.wait.seconds.label", kind: "number", default: 2 }],
      },
      {
        kind: "waitFor",
        icon: ScanEyeIcon,
        label: "palette.waitfor.label",
        about: "palette.waitfor.about",
        params: [
          { name: "selector", label: "palette.waitfor.selector.label", kind: "text", hint: "palette.waitfor.selector.hint" },
          { name: "timeout", label: "palette.waitfor.timeout.label", kind: "number", default: 15 },
        ],
      },
      {
        kind: "waitGone",
        icon: ViewOffSlashIcon,
        label: "palette.waitgone.label",
        about: "palette.waitgone.about",
        params: [
          { name: "selector", label: "palette.waitgone.selector.label", kind: "text", hint: "palette.waitgone.selector.hint" },
          { name: "timeout", label: "palette.waitgone.timeout.label", kind: "number", default: 15 },
        ],
      },
      {
        kind: "waitText",
        icon: TextSearchIcon,
        label: "palette.waittext.label",
        about: "palette.waittext.about",
        params: [
          { name: "selector", label: "palette.waittext.selector.label", kind: "text", hint: "palette.waittext.selector.hint" },
          { name: "text", label: "palette.waittext.text.label", kind: "text", hint: "palette.waittext.text.hint" },
          { name: "timeout", label: "palette.waittext.timeout.label", kind: "number", default: 15 },
        ],
      },
      {
        kind: "waitUrl",
        icon: Link04Icon,
        label: "palette.waiturl.label",
        about: "palette.waiturl.about",
        params: [
          { name: "url", label: "palette.waiturl.url.label", kind: "text", hint: "palette.waiturl.url.hint" },
          { name: "timeout", label: "palette.waiturl.timeout.label", kind: "number", default: 30 },
        ],
      },
      {
        kind: "ifExists",
        icon: SplitIcon,
        label: "palette.ifexists.label",
        about: "palette.ifexists.about",
        params: [{ name: "selector", label: "palette.ifexists.selector.label", kind: "text", hint: "palette.ifexists.selector.hint" }],
      },
      {
        kind: "if.value",
        icon: GitBranchIcon,
        label: "blockPicker.step.ifValue",
        about: "blockPicker.about.ifValue",
        params: [
          { name: "a", label: "palette.ifValue.a.label", kind: "text", hint: "palette.ifValue.a.hint" },
          {
            name: "op",
            label: "palette.ifValue.label",
            kind: "select",
            options: ["=", "≠", "contains", "not contains", "starts with", "ends with", "is empty", "is not empty", ">", ">=", "<", "<="],
            default: "=",
          },
          { name: "b", label: "palette.select.b.label", kind: "text", hint: "palette.select.b.hint" },
        ],
      },
      {
        kind: "if.exists",
        icon: CursorRectangleSelection01Icon,
        label: "palette.ifExists.label",
        about: "palette.ifExists.about",
        params: [{ name: "selector", label: "palette.ifExists.selector.label", kind: "text", hint: "palette.ifExists.selector.hint" }],
      },
      {
        kind: "if.text",
        icon: TextCheckIcon,
        label: "blockPicker.step.ifText",
        about: "palette.ifText.about",
        params: [
          { name: "selector", label: "palette.ifText.selector.label", kind: "text", hint: "palette.ifText.selector.hint" },
          {
            name: "op",
            label: "palette.ifText.label",
            kind: "select",
            options: ["contains", "not contains", "=", "≠", "starts with", "ends with", "is empty", "is not empty"],
            default: "contains",
          },
          { name: "text", label: "palette.select.text.label", kind: "text", hint: "palette.select.text.hint" },
        ],
      },
      {
        kind: "if.url",
        icon: Link01Icon,
        label: "blockPicker.step.ifUrl",
        about: "palette.ifUrl.about",
        params: [
          {
            name: "op",
            label: "palette.ifUrl.label",
            kind: "select",
            options: ["contains", "not contains", "starts with", "ends with", "="],
            default: "contains",
          },
          { name: "text", label: "palette.select.text.label", kind: "text", hint: "palette.select.text.hint" },
        ],
      },
      { kind: "stop", icon: StopCircleIcon, label: "palette.stop.label", about: "palette.stop.about", params: [] },
    ],
  },
  {
    id: "requests",
    icon: ApiIcon,
    label: "palette.cat.requests",
    blocks: [
      {
        kind: "script.run",
        icon: ConsoleIcon,
        label: "palette.scriptRun.label",
        about: "blockPicker.about.scriptRun",
        params: [
          { name: "source", label: "palette.scriptRun.source.label", kind: "textarea", hint: "palette.scriptRun.source.hint" },
          { name: "file", label: "palette.scriptRun.file.label", kind: "text", hint: "palette.scriptRun.file.hint" },
          { name: "world", label: "palette.scriptRun.world.label", kind: "select", options: ["isolated", "main"], default: "isolated" },
          { name: "into", label: "palette.scriptRun.into.label", kind: "text", hint: "palette.scriptRun.into.hint" },
        ],
      },
      {
        kind: "http.request",
        icon: ApiIcon,
        label: "blockPicker.step.httpRequest",
        about: "blockPicker.about.httpRequest",
        params: [
          {
            name: "method",
            label: "palette.httpRequest.label",
            kind: "select",
            options: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
            default: "GET",
          },
          { name: "url", label: "palette.select.url.label", kind: "url", hint: "palette.select.url.hint" },
          {
            name: "headers",
            label: "palette.select.label",
            kind: "text",
            hint: "palette.text.headers.hint",
          },
          { name: "body", label: "palette.text.body.label", kind: "text", hint: "palette.text.body.hint", secret: true },
          {
            name: "fingerprint",
            label: "palette.text.label",
            kind: "select",
            hint: "palette.select.fingerprint.hint",
            options: [
              "",
              "chrome_149", "chrome_148", "chrome_147", "chrome_146", "chrome_145",
              "chrome_144", "chrome_143", "chrome_142", "chrome_141", "chrome_140",
              "firefox_151", "firefox_150", "firefox_149", "firefox_148", "firefox_147",
              "firefox_146", "firefox_145", "firefox_144", "firefox_143", "firefox_142",
              "safari_26.4", "safari_26", "safari_18.5", "safari_18.3.1", "safari_18",
              "safari_ios_26.2", "safari_ios_18.1.1", "safari_ipad_26.2",
              "edge_148", "edge_147", "edge_146", "edge_145", "edge_144",
              "edge_143", "edge_142", "edge_141", "edge_140",
              "opera_131", "opera_130", "opera_129",
              "okhttp_5", "okhttp_4.12",
            ],
          },
          {
            name: "session",
            label: "palette.select.label",
            kind: "text",
            hint: "palette.text.session.hint",
          },
          {
            name: "via",
            label: "palette.text.label",
            kind: "select",
            options: ["profile", "host"],
            default: "profile",
          },
          { name: "into", label: "palette.select.into.label", kind: "text", hint: "palette.select.into.hint" },
          { name: "timeout", label: "palette.select.timeout.label", kind: "number", default: 30 },
        ],
      },
      {
        kind: "http.endSession",
        icon: Logout01Icon,
        label: "palette.httpEndSession.label",
        about: "palette.httpEndSession.about",
        params: [{ name: "session", label: "palette.httpEndSession.session.label", kind: "text" }],
      },
    ],
  },
  {
    id: "traffic",
    icon: NetworkIcon,
    label: "palette.cat.traffic",
    blocks: [
      {
        kind: "traffic.observe",
        icon: NetworkIcon,
        label: "palette.trafficObserve.label",
        about: "blockPicker.about.trafficObserve",
        params: [
          { name: "enabled", label: "palette.trafficObserve.enabled.label", kind: "select", options: ["on", "off"], default: "on" },
        ],
      },
      {
        kind: "traffic.block",
        icon: CancelCircleIcon,
        label: "blockPicker.step.trafficBlock",
        about: "palette.trafficBlock.about",
        params: [
          { name: "url", label: "palette.trafficBlock.url.label", kind: "text", hint: "palette.trafficBlock.url.hint" },
          { name: "method", label: "palette.trafficBlock.method.label", kind: "text", hint: "palette.trafficBlock.method.hint" },
          {
            name: "resource",
            label: "palette.trafficBlock.label",
            kind: "select",
            options: ["any", "document", "xhr", "script", "stylesheet", "image", "font", "media", "other"],
            default: "any",
          },
          { name: "reason", label: "palette.select.reason.label", kind: "text", hint: "palette.select.reason.hint" },
        ],
      },
      {
        kind: "traffic.redirect",
        icon: ArrowTurnForwardIcon,
        label: "blockPicker.step.trafficRedirect",
        about: "blockPicker.about.trafficRedirect",
        params: [
          { name: "url", label: "palette.trafficRedirect.url.label", kind: "text", hint: "palette.trafficRedirect.url.hint" },
          { name: "to", label: "palette.trafficRedirect.to.label", kind: "url", hint: "palette.trafficRedirect.to.hint" },
          { name: "method", label: "palette.trafficRedirect.method.label", kind: "text", hint: "palette.trafficRedirect.method.hint" },
          {
            name: "resource",
            label: "palette.trafficRedirect.label",
            kind: "select",
            options: ["any", "document", "xhr", "script", "stylesheet", "image", "font", "media", "other"],
            default: "any",
          },
        ],
      },
      {
        kind: "traffic.setHeaders",
        icon: Edit02Icon,
        label: "blockPicker.step.trafficSetHeaders",
        about: "palette.trafficSetHeaders.about",
        params: [
          { name: "url", label: "palette.trafficSetHeaders.url.label", kind: "text", hint: "palette.trafficSetHeaders.url.hint" },
          { name: "headers", label: "palette.trafficSetHeaders.headers.label", kind: "textarea", hint: "palette.trafficSetHeaders.headers.hint" },
          { name: "setBody", label: "palette.trafficSetHeaders.setbody.label", kind: "textarea", hint: "palette.trafficSetHeaders.setbody.hint" },
          { name: "setMethod", label: "palette.trafficSetHeaders.setmethod.label", kind: "text", hint: "palette.trafficSetHeaders.setmethod.hint" },
          {
            name: "resource",
            label: "palette.trafficSetHeaders.label",
            kind: "select",
            options: ["any", "document", "xhr", "script", "stylesheet", "image", "font", "media", "other"],
            default: "any",
          },
        ],
      },
      {
        kind: "traffic.editResponse",
        icon: CodeSquareIcon,
        label: "blockPicker.step.trafficEditResponse",
        about: "palette.trafficEditResponse.about",
        params: [
          { name: "url", label: "palette.trafficEditResponse.url.label", kind: "text", hint: "palette.trafficEditResponse.url.hint" },
          { name: "status", label: "palette.trafficEditResponse.status.label", kind: "number", decimals: 0, min: 100, max: 599, hint: "palette.trafficEditResponse.status.hint" },
          { name: "responseHeaders", label: "palette.trafficEditResponse.responseheaders.label", kind: "textarea", hint: "palette.trafficEditResponse.responseheaders.hint" },
          { name: "responseBody", label: "palette.trafficEditResponse.responsebody.label", kind: "textarea", hint: "palette.trafficEditResponse.responsebody.hint" },
          {
            name: "resource",
            label: "palette.trafficEditResponse.label",
            kind: "select",
            options: ["any", "document", "xhr", "script", "stylesheet", "image", "font", "media", "other"],
            default: "any",
          },
        ],
      },
      {
        kind: "traffic.fulfill",
        icon: FileAddIcon,
        label: "blockPicker.step.trafficFulfill",
        about: "palette.trafficFulfill.about",
        params: [
          { name: "url", label: "palette.trafficFulfill.url.label", kind: "text", hint: "palette.trafficFulfill.url.hint" },
          { name: "status", label: "palette.trafficFulfill.status.label", kind: "number", decimals: 0, min: 100, max: 599, default: 200 },
          { name: "responseHeaders", label: "palette.trafficFulfill.responseheaders.label", kind: "textarea", hint: "palette.trafficFulfill.responseheaders.hint" },
          { name: "responseBody", label: "palette.trafficFulfill.responsebody.label", kind: "textarea" },
          {
            name: "resource",
            label: "palette.trafficFulfill.label",
            kind: "select",
            options: ["any", "document", "xhr", "script", "stylesheet", "image", "font", "media", "other"],
            default: "any",
          },
        ],
      },
    ],
  },
  {
    id: "data",
    icon: Table01Icon,
    label: "palette.cat.data",
    blocks: [
      {
        kind: "log",
        icon: TextAlignLeftIcon,
        label: "palette.log.label",
        about: "palette.log.about",
        params: [{ name: "text", label: "palette.log.text.label", kind: "text", hint: "palette.log.text.hint" }],
      },
      {
        kind: "readText",
        icon: TextSelectIcon,
        label: "palette.readtext.label",
        about: "palette.readtext.about",
        params: [
          { name: "selector", label: "palette.readtext.selector.label", kind: "text", hint: "palette.readtext.selector.hint" },
          { name: "into", label: "palette.readtext.into.label", kind: "text", hint: "palette.readtext.into.hint" },
          { name: "timeout", label: "palette.readtext.timeout.label", kind: "number", default: 5 },
        ],
      },
      {
        kind: "var.set",
        icon: VariableIcon,
        label: "palette.varSet.label",
        about: "palette.varSet.about",
        params: [
          { name: "name", label: "palette.varSet.name.label", kind: "text", hint: "palette.varSet.name.hint" },
          { name: "value", label: "palette.varSet.value.label", kind: "text", hint: "palette.varSet.value.hint", secret: true },
        ],
      },
      {
        kind: "var.math",
        icon: Calculator01Icon,
        label: "palette.varMath.label",
        about: "palette.varMath.about",
        params: [
          { name: "a", label: "palette.varMath.a.label", kind: "text", hint: "palette.varMath.a.hint" },
          { name: "op", label: "palette.varMath.op.label", kind: "select", options: ["+", "-", "*", "/", "%", "min", "max"], default: "+" },
          { name: "b", label: "palette.varMath.b.label", kind: "text", hint: "palette.varMath.b.hint" },
          { name: "into", label: "palette.varMath.into.label", kind: "text", hint: "palette.varMath.into.hint" },
        ],
      },
      {
        kind: "var.autofill",
        icon: User03Icon,
        label: "palette.varAutofill.label",
        about: "palette.varAutofill.about",
        params: [
          { name: "field", label: "palette.varAutofill.field.label", kind: "text", hint: "palette.varAutofill.field.hint" },
          { name: "into", label: "palette.varAutofill.into.label", kind: "text", hint: "palette.varAutofill.into.hint" },
        ],
      },
      {
        kind: "count",
        icon: TextNumberSignIcon,
        label: "palette.count.label",
        about: "palette.count.about",
        params: [
          { name: "selector", label: "palette.count.selector.label", kind: "text", hint: "palette.count.selector.hint" },
          { name: "into", label: "palette.count.into.label", kind: "text", hint: "palette.count.into.hint" },
        ],
      },
      {
        kind: "readAttribute",
        icon: CodeIcon,
        label: "palette.readattribute.label",
        about: "palette.readattribute.about",
        params: [
          { name: "selector", label: "palette.readattribute.selector.label", kind: "text", hint: "palette.readattribute.selector.hint" },
          { name: "name", label: "palette.readattribute.name.label", kind: "text", hint: "palette.readattribute.name.hint" },
          { name: "into", label: "palette.readattribute.into.label", kind: "text", hint: "palette.readattribute.into.hint" },
          { name: "timeout", label: "palette.readattribute.timeout.label", kind: "number", default: 5 },
        ],
      },
      {
        kind: "screenshot",
        icon: Camera01Icon,
        label: "palette.screenshot.label",
        about: "palette.screenshot.about",
        params: [
          { name: "path", label: "palette.screenshot.path.label", kind: "text", hint: "palette.screenshot.path.hint" },
        ],
      },
      {
        kind: "var.random",
        icon: DicesIcon,
        label: "palette.varRandom.label",
        about: "palette.varRandom.about",
        params: [
          { name: "list", label: "palette.varRandom.list.label", kind: "text", hint: "palette.varRandom.list.hint" },
          { name: "min", label: "palette.varRandom.min.label", kind: "text", default: "0" },
          { name: "max", label: "palette.varRandom.max.label", kind: "text", default: "100" },
          { name: "into", label: "palette.varRandom.into.label", kind: "text", hint: "palette.varRandom.into.hint" },
        ],
      },
      {
        kind: "file.readLine",
        icon: Download04Icon,
        label: "blockPicker.step.fileReadLine",
        about: "palette.fileReadLine.about",
        params: [
          { name: "path", label: "palette.fileReadLine.path.label", kind: "text", hint: "palette.fileReadLine.path.hint" },
          { name: "into", label: "palette.fileReadLine.into.label", kind: "text", hint: "palette.fileReadLine.into.hint" },
          {
            name: "take",
            label: "palette.fileReadLine.label",
            kind: "select",
            options: ["remove the line", "keep"],
            default: "remove the line",
          },
        ],
      },
      {
        kind: "file.append",
        icon: Upload04Icon,
        label: "palette.fileAppend.label",
        about: "palette.fileAppend.about",
        params: [
          { name: "path", label: "palette.fileAppend.path.label", kind: "text", hint: "palette.fileAppend.path.hint" },
          { name: "line", label: "palette.fileAppend.line.label", kind: "text", hint: "palette.fileAppend.line.hint" },
        ],
      },
    ],
  },
  {
    id: "database",
    icon: Database01Icon,
    label: "palette.cat.database",
    blocks: [
      {
        kind: "db.open",
        icon: DatabaseIcon,
        label: "palette.dbOpen.label",
        about: "blockPicker.about.dbOpen",
        params: [
          { name: "driver", label: "palette.dbOpen.driver.label", kind: "select", options: ["sqlite", "postgres", "mysql", "mariadb", "mongodb"], default: "sqlite" },
          { name: "target", label: "palette.dbOpen.target.label", kind: "text", hint: "palette.dbOpen.target.hint" },
          { name: "database", label: "palette.dbOpen.database.label", kind: "text", hint: "palette.dbOpen.database.hint" },
          { name: "name", label: "palette.dbOpen.name.label", kind: "text", default: "default" },
        ],
      },
      {
        kind: "db.exec",
        icon: DatabaseZapIcon,
        label: "palette.dbExec.label",
        about: "palette.dbExec.about",
        params: [
          { name: "name", label: "palette.dbExec.name.label", kind: "text", default: "default" },
          { name: "sql", label: "palette.dbExec.sql.label", kind: "textarea", hint: "palette.dbExec.sql.hint" },
          { name: "into", label: "palette.dbExec.into.label", kind: "text", hint: "palette.dbExec.into.hint" },
        ],
      },
      {
        kind: "db.query",
        icon: DatabaseSearchIcon,
        label: "palette.dbQuery.label",
        about: "palette.dbQuery.about",
        params: [
          { name: "name", label: "palette.dbQuery.name.label", kind: "text", default: "default" },
          { name: "sql", label: "palette.dbQuery.sql.label", kind: "textarea", hint: "palette.dbQuery.sql.hint" },
          { name: "mode", label: "palette.dbQuery.mode.label", kind: "select", options: ["rows", "row", "value", "count"], default: "rows" },
          { name: "into", label: "palette.dbQuery.into.label", kind: "text", hint: "palette.dbQuery.into.hint" },
        ],
      },
      {
        kind: "db.close",
        icon: DatabaseLockedIcon,
        label: "palette.dbClose.label",
        about: "palette.dbClose.about",
        params: [
          { name: "name", label: "palette.dbClose.name.label", kind: "text", default: "default" },
        ],
      },
    ],
  },
];

export function specFor(kind: string): BlockSpec | null {
  for (const c of PALETTE) {
    const b = c.blocks.find((x) => x.kind === kind);
    if (b) return b;
  }
  return null;
}

const GENERIC_STEP = Layers01Icon;
const MODULE_STEP = PuzzleIcon;

/** The glyph for a step kind. A kind with no entry (a module step or an old
 *  saved one) takes its category's glyph, then one generic step glyph. */
export function blockIcon(kind: string, categoryId?: string): StepIconData {
  for (const c of PALETTE) {
    const b = c.blocks.find((x) => x.kind === kind);
    if (b) return b.icon ?? c.icon ?? GENERIC_STEP;
  }
  if (kind.startsWith("module:")) return MODULE_STEP;
  const cat = PALETTE.find((c) => c.id === categoryId);
  return cat?.icon ?? GENERIC_STEP;
}

/** A category's glyph; a module's own group gets the puzzle piece. */
export function categoryIcon(id: string): StepIconData {
  return PALETTE.find((c) => c.id === id)?.icon ?? (id.startsWith("module") || id.startsWith("group:") ? MODULE_STEP : GENERIC_STEP);
}
