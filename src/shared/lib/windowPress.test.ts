// node --test: which presses on a drag surface move the window (`npm run test:unit`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTROL_SELECTOR, pressMovesWindow } from "./windowPress.ts";

/** A stand-in element: a tag, attributes and a parent, with `closest` and `contains` for the selectors the rule uses. */
type El = { tag: string; attrs: Record<string, string>; parent: El | null; closest: (s: string) => El | null; contains: (n: El | null) => boolean };

function matches(el: El, sel: string): boolean {
  const not = /^(.*):not\((.*)\)$/.exec(sel);
  if (not) return matches(el, not[1]) && !matches(el, not[2]);
  const attr = /^\[([\w-]+)(?:='([^']*)')?\]$/.exec(sel);
  if (attr) return attr[1] in el.attrs && (attr[2] === undefined || el.attrs[attr[1]] === attr[2]);
  return el.tag === sel;
}

function el(tag: string, attrs: Record<string, string> = {}, parent: El | null = null): El {
  const self: El = {
    tag, attrs, parent,
    closest: (s) => {
      const list = s.split(",").map((x) => x.trim());
      for (let at: El | null = self; at; at = at.parent) if (list.some((x) => matches(at!, x))) return at;
      return null;
    },
    contains: (n) => {
      for (let at = n; at; at = at.parent) if (at === self) return true;
      return false;
    },
  };
  return self;
}

const press = (surface: El, target: El, button = 0) =>
  pressMovesWindow({ button, target: target as unknown as EventTarget, currentTarget: surface as unknown as EventTarget });

test("the bare ground and plain text on it move the window", () => {
  const header = el("header");
  assert.equal(press(header, header), true);
  assert.equal(press(header, el("h1", {}, el("div", {}, header))), true);
});

test("only the primary button moves it", () => {
  const header = el("header");
  assert.equal(press(header, header, 1), false);
  assert.equal(press(header, header, 2), false);
});

test("a press in a portal never moves it, even on a portal's bare ground", () => {
  // React bubbles it to the header, but its DOM is under <body>, not the header.
  const header = el("header");
  const popover = el("div", { role: "dialog" }, el("body"));
  assert.equal(press(header, popover), false);
  assert.equal(press(header, el("legend", {}, el("fieldset", {}, popover))), false);
  assert.equal(press(header, el("span", {}, el("div", { role: "combobox" }, popover))), false);
});

test("native controls, labels, every ARIA widget role and editable text are controls", () => {
  const header = el("header");
  for (const tag of ["button", "a", "input", "select", "textarea", "label"]) {
    assert.equal(press(header, el("span", {}, el(tag, {}, header))), false, tag);
  }
  const roles = ["button", "link", "combobox", "listbox", "option", "menuitem", "menuitemcheckbox", "menuitemradio",
    "checkbox", "radio", "switch", "tab", "slider", "spinbutton", "textbox", "searchbox", "treeitem"];
  for (const role of roles) {
    assert.ok(CONTROL_SELECTOR.includes(`[role='${role}']`), role);
    // The kit Select's field is a div with role="combobox": the press lands on its text.
    assert.equal(press(header, el("span", {}, el("div", { role }, header))), false, role);
  }
  assert.equal(press(header, el("div", { contenteditable: "" }, header)), false);
  assert.equal(press(header, el("div", { contenteditable: "true" }, header)), false);
  assert.equal(press(header, el("div", { contenteditable: "false" }, header)), true);
});

test("a disabled control is still a control (PC-011)", () => {
  const header = el("header");
  assert.equal(press(header, el("div", { "aria-disabled": "true" }, header)), false);
  assert.equal(press(header, el("div", { "data-disabled": "" }, header)), false);
});
