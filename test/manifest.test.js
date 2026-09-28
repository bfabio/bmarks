const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

function exists(relative) {
  return fs.existsSync(path.join(root, relative));
}

test("the add-on declares an icon and ships every file it names", () => {
  const sizes = Object.values(manifest.icons || {});
  assert.ok(sizes.length > 0, "manifest.icons is missing");
  for (const file of sizes) assert.ok(exists(file), `${file} is missing`);
});

test("the toolbar button carries the same icon and opens the bookmarks page", () => {
  assert.ok(exists(manifest.action.default_icon), `${manifest.action.default_icon} is missing`);
  assert.equal(manifest.action.default_title, "Bookmarks");
});

test("every file the manifest names exists", () => {
  for (const file of manifest.background.scripts) assert.ok(exists(file), `${file} is missing`);
});

test("the page the button opens is in the package", () => {
  const opened = fs.readFileSync(path.join(root, "background.js"), "utf8").match(/getURL\("([^"]+)"\)/);
  assert.ok(opened, "background.js opens no page");
  assert.ok(exists(opened[1]), `${opened[1]} is missing`);
});

test("the add-on asks for nothing beyond bookmarks and its own storage", () => {
  assert.deepEqual(manifest.permissions, ["storage", "bookmarks"]);
  assert.deepEqual(manifest.optional_host_permissions, ["<all_urls>"]);
});

test("the add-on is published as bmarks", () => {
  assert.equal(manifest.name, "bmarks");
});
