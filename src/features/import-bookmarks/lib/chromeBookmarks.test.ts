// node --test: reading Chrome's bookmarks file (`npm run test:unit`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { newMarks, readChromeBookmarks, urlKey } from "./chromeBookmarks.ts";

const url = (name: string, u: string) => ({ type: "url", name, url: u, date_added: "13300000000000000", id: "1" });
const folder = (name: string, children: unknown[]) => ({ type: "folder", name, children });
const file = (roots: Record<string, unknown>) => JSON.stringify({ checksum: "", roots, version: 1 });
const mark = (title: string, u: string) => ({ title, url: u });

test("folders flatten in Chrome's order: the bar, then other, then mobile", () => {
  const text = file({
    synced: folder("Mobile bookmarks", [url("Phone", "https://m.example/")]),
    bookmark_bar: folder("Bookmarks bar", [
      url("A", "https://a.example/"),
      folder("Work", [url("B", "https://b.example/"), folder("Deep", [url("C", "https://c.example/")])]),
      url("D", "https://d.example/"),
    ]),
    other: folder("Other bookmarks", [url(" E ", " https://e.example/ ")]),
  });
  const got = readChromeBookmarks(text);
  assert.ok(got);
  assert.deepEqual(got.marks.map((m) => m.title), ["A", "B", "C", "D", "E", "Phone"]);
  assert.equal(got.marks[4].url, "https://e.example/");
  assert.equal(got.found, 6);
  assert.equal(got.skipped, 0);
});

test("bookmarklets, empty addresses and mailto: are counted and skipped", () => {
  const got = readChromeBookmarks(file({
    bookmark_bar: folder("Bookmarks bar", [
      url("Title", "javascript:alert(document.title)"),
      url("Blank", ""),
      url("Mail", "mailto:me@example.com"),
      { type: "url", name: "No address" },
      url("Settings", "chrome://settings/"),
    ]),
    other: folder("Other bookmarks", []),
  }));
  assert.ok(got);
  assert.deepEqual(got.marks, [mark("Settings", "chrome://settings/")]);
  assert.equal(got.found, 5);
  assert.equal(got.skipped, 4);
});

test("a file that is not Chrome's bookmarks file is refused", () => {
  assert.equal(readChromeBookmarks("not json"), null);
  assert.equal(readChromeBookmarks("[]"), null);
  assert.equal(readChromeBookmarks(JSON.stringify({ bookmarks: [{ title: "x", url: "https://x.example" }] })), null);
  assert.equal(readChromeBookmarks(JSON.stringify({ roots: { mine: [] } })), null);
  // Chrome's shape with nothing in it is still Chrome's file.
  assert.deepEqual(readChromeBookmarks(file({ bookmark_bar: folder("Bookmarks bar", []) })), { marks: [], found: 0, skipped: 0 });
});

test("an address already here, or twice in the file, comes in once", () => {
  const marks = [
    mark("A", "https://a.example/"),
    mark("B", "https://pixelscan.net/"),
    mark("A again", "https://a.example/"),
    mark("C", "https://c.example/x"),
    mark("B again", "https://pixelscan.net"),
  ];
  // A repeat in the file is not "already here": an empty list has none.
  const { fresh, already, repeats } = newMarks(marks, ["https://pixelscan.net", "https://other.example"]);
  assert.deepEqual(fresh.map((m) => m.title), ["A", "C"]);
  assert.deepEqual({ already, repeats }, { already: 2, repeats: 1 });
  assert.deepEqual({ ...newMarks(marks, []), fresh: undefined }, { fresh: undefined, already: 0, repeats: 2 });
});

test("addresses compare as URLs, and an unparsable one as written", () => {
  assert.equal(urlKey("https://Example.com"), "https://example.com/");
  assert.equal(urlKey(" https://a.example/x "), "https://a.example/x");
  assert.notEqual(urlKey("https://a.example/x"), urlKey("https://a.example/x/"));
  assert.equal(urlKey("not a url"), "not a url");
});
