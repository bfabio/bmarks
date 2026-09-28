const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");
const { roots, mark } = require("./fixture.js");

require("../tree.js");
require("../check.js");
require("../page.js");

const { install } = globalThis.bmarksPage;

function fakeApi(tree, store = {}) {
  const calls = [];
  const listeners = {};
  const event = (name) => ({ addListener: (fn) => (listeners[name] = fn) });
  const log = (name) => async (...args) => { calls.push([name, ...args]); };
  return {
    calls,
    listeners,
    tree,
    store,
    bookmarks: {
      getTree: async () => tree,
      move: log("move"),
      remove: log("remove"),
      removeTree: log("removeTree"),
      update: log("update"),
      create: async (details) => { calls.push(["create", details]); return { id: "new", ...details }; },
      onCreated: event("onCreated"),
      onRemoved: event("onRemoved"),
      onChanged: event("onChanged"),
      onMoved: event("onMoved"),
    },
    tabs: { create: log("tab") },
    storage: {
      local: {
        get: async (key) => (key in store ? { [key]: store[key] } : {}),
        set: async (values) => { Object.assign(store, values); calls.push(["store", values]); },
      },
    },
  };
}

async function setup(tree = roots(), store = {}) {
  const file = path.join(__dirname, "..", "bmarks.html");
  // jsdom reports a link click it cannot follow as a jsdomError. The
  // page prevents that navigation, so the noise is not a finding.
  const virtualConsole = new VirtualConsole().on("jsdomError", () => {});
  const dom = new JSDOM(fs.readFileSync(file, "utf8"), { virtualConsole });
  const doc = dom.window.document;
  const api = fakeApi(tree, store);
  const page = install(doc, api);
  await page.ready;
  return { dom, doc, api, page };
}

function fire(el, type, init = {}) {
  const Ctor = el.ownerDocument.defaultView.MouseEvent;
  return el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, ...init }));
}

function key(el, name) {
  const Ctor = el.ownerDocument.defaultView.KeyboardEvent;
  return el.dispatchEvent(new Ctor("keydown", { bubbles: true, cancelable: true, key: name }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// History traversal, popstate and the paint before a render each wait
// for a zero timer. Counting turns holds however slow the machine is.
async function settle() {
  for (let i = 0; i < 10; i++) await sleep(0);
}

test("install renders the tree and subscribes to bookmark events", async () => {
  const { doc, api } = await setup();
  assert.equal(doc.querySelectorAll(".mark").length, 7);
  assert.deepEqual(Object.keys(api.listeners).sort(), ["onChanged", "onCreated", "onMoved", "onRemoved"]);
});

test("a bookmark event re-renders from the api", async () => {
  const { doc, api } = await setup();
  api.tree[0].children[0].children.push(mark("b8", "toolbar_____", 2, "New one", "https://example.com/"));
  api.listeners.onCreated();
  await sleep(80);
  assert.equal(doc.querySelectorAll(".mark").length, 8);
});

test("right click on a bookmark opens the page menu with bookmark actions", async () => {
  const { doc } = await setup();
  const b1 = doc.querySelector('.mark[data-id="b1"]');
  const allowed = fire(b1, "contextmenu", { clientX: 40, clientY: 50 });
  assert.equal(allowed, false);
  const menu = doc.querySelector("#menu");
  assert.equal(menu.hidden, false);
  assert.equal(menu.style.left, "40px");
  assert.equal(menu.style.top, "50px");
  const visible = Array.from(menu.querySelectorAll("button")).filter((b) => !b.hidden).map((b) => b.dataset.action);
  assert.deepEqual(visible, ["open-tab", "copy", "rename", "delete"]);
});

test("right click on a folder heading shows folder actions", async () => {
  const { doc } = await setup();
  fire(doc.querySelector('.folder[data-id="travel"] > .folder-title'), "contextmenu");
  const visible = Array.from(doc.querySelectorAll("#menu button")).filter((b) => !b.hidden).map((b) => b.dataset.action);
  assert.deepEqual(visible, ["new-folder", "rename", "delete"]);
});

test("delete from the menu removes the bookmark and closes the menu", async () => {
  const { doc, api } = await setup();
  fire(doc.querySelector('.mark[data-id="b1"]'), "contextmenu");
  doc.querySelector('#menu [data-action="delete"]').click();
  await sleep(0);
  assert.deepEqual(api.calls, [["remove", "b1"]]);
  assert.equal(doc.querySelector("#menu").hidden, true);
});

test("delete on a folder with content asks first", async () => {
  const { doc, api, dom } = await setup();
  let asked = 0;
  dom.window.confirm = () => { asked += 1; return false; };
  fire(doc.querySelector('.folder[data-id="travel"] > .folder-title'), "contextmenu");
  doc.querySelector('#menu [data-action="delete"]').click();
  await sleep(0);
  assert.equal(asked, 1);
  assert.deepEqual(api.calls, []);
  dom.window.confirm = () => { asked += 1; return true; };
  fire(doc.querySelector('.folder[data-id="travel"] > .folder-title'), "contextmenu");
  doc.querySelector('#menu [data-action="delete"]').click();
  await sleep(0);
  assert.equal(asked, 2);
  assert.deepEqual(api.calls, [["removeTree", "travel"]]);
});

test("delete on an empty folder does not ask", async () => {
  const tree = roots();
  tree[0].children[1].children[0].children[1].children = [];
  const { doc, api, dom } = await setup(tree);
  dom.window.confirm = () => { throw new Error("asked"); };
  fire(doc.querySelector('.folder[data-id="aegean"] > .folder-title'), "contextmenu");
  doc.querySelector('#menu [data-action="delete"]').click();
  await sleep(0);
  assert.deepEqual(api.calls, [["removeTree", "aegean"]]);
});

test("open in new tab and copy act on the bookmark url", async () => {
  const { doc, api, dom } = await setup();
  const copied = [];
  Object.defineProperty(dom.window.navigator, "clipboard", { value: { writeText: async (t) => { copied.push(t); } } });
  fire(doc.querySelector('.mark[data-id="b2"]'), "contextmenu");
  doc.querySelector('#menu [data-action="open-tab"]').click();
  fire(doc.querySelector('.mark[data-id="b2"]'), "contextmenu");
  doc.querySelector('#menu [data-action="copy"]').click();
  await sleep(0);
  assert.deepEqual(api.calls, [["tab", { url: "http://homeserver/lgh/" }]]);
  assert.deepEqual(copied, ["http://homeserver/lgh/"]);
});

test("rename edits the title inline, enter saves, escape cancels", async () => {
  const { doc, api } = await setup();
  fire(doc.querySelector('.mark[data-id="b1"]'), "contextmenu");
  doc.querySelector('#menu [data-action="rename"]').click();
  const input = doc.querySelector('.mark[data-id="b1"] input');
  assert.equal(input.value, "GitHub");
  assert.equal(doc.activeElement, input);
  input.value = "GH";
  key(input, "Enter");
  await sleep(0);
  assert.deepEqual(api.calls, [["update", "b1", { title: "GH" }]]);

  fire(doc.querySelector('.folder[data-id="travel"] > .folder-title'), "contextmenu");
  doc.querySelector('#menu [data-action="rename"]').click();
  const input2 = doc.querySelector('.folder[data-id="travel"] > .folder-title input');
  input2.value = "Trips";
  key(input2, "Escape");
  await sleep(0);
  assert.equal(api.calls.length, 1);
  assert.equal(doc.querySelector('.folder[data-id="travel"] > .folder-title input'), null);
  assert.equal(doc.querySelector('.folder[data-id="travel"] > .folder-title .name').textContent, "Travel");
});

test("new folder creates a child at the end of the folder", async () => {
  const { doc, api } = await setup();
  fire(doc.querySelector('.folder[data-id="travel"] > .folder-title'), "contextmenu");
  doc.querySelector('#menu [data-action="new-folder"]').click();
  await sleep(0);
  assert.deepEqual(api.calls, [["create", { parentId: "travel", title: "New folder" }]]);
});

test("the menu closes on escape, on a click outside and on scroll", async () => {
  const { doc } = await setup();
  const menu = doc.querySelector("#menu");
  const b1 = doc.querySelector('.mark[data-id="b1"]');
  fire(b1, "contextmenu");
  key(doc.body, "Escape");
  assert.equal(menu.hidden, true);
  fire(b1, "contextmenu");
  fire(doc.body, "mousedown");
  assert.equal(menu.hidden, true);
  fire(b1, "contextmenu");
  doc.dispatchEvent(new doc.defaultView.Event("scroll"));
  assert.equal(menu.hidden, true);
});

test("the delete key on a focused bookmark removes it", async () => {
  const { doc, api } = await setup();
  const b1 = doc.querySelector('.mark[data-id="b1"]');
  b1.focus();
  key(b1, "Delete");
  await sleep(0);
  assert.deepEqual(api.calls, [["remove", "b1"]]);
});

test("dragging a row over another marks the slot and drop moves it", async () => {
  const { doc, api } = await setup();
  const b1 = doc.querySelector('.mark[data-id="b1"]');
  const b2 = doc.querySelector('.mark[data-id="b2"]');
  fire(b1, "dragstart");
  assert.ok(b1.classList.contains("dragging"));
  const allowed = fire(b2, "dragover", { clientY: 0 });
  assert.equal(allowed, false);
  assert.ok(b2.classList.contains("drop-after"));
  fire(b2, "drop", { clientY: 0 });
  fire(b1, "dragend");
  await sleep(0);
  assert.deepEqual(api.calls, [["move", "b1", { parentId: "toolbar_____", index: 1 }]]);
  assert.equal(doc.querySelector(".drop-after"), null);
  assert.equal(doc.querySelector(".dragging"), null);
});

test("dragging over a refused target leaves no mark and no drop", async () => {
  const { doc, api } = await setup();
  const travel = doc.querySelector('.folder[data-id="travel"] > .folder-title');
  const b4 = doc.querySelector('.mark[data-id="b4"]');
  fire(travel, "dragstart");
  const allowed = fire(b4, "dragover", { clientY: 0 });
  assert.equal(allowed, true);
  assert.equal(doc.querySelector(".drop-after, .drop-before, .drop-into"), null);
  fire(b4, "drop", { clientY: 0 });
  await sleep(0);
  assert.deepEqual(api.calls, []);
});

test("the menu on a built in root offers only new folder", async () => {
  const { doc } = await setup();
  fire(doc.querySelector('.folder[data-id="menu________"] > .folder-title'), "contextmenu");
  const visible = Array.from(doc.querySelectorAll("#menu button")).filter((b) => !b.hidden).map((b) => b.dataset.action);
  assert.deepEqual(visible, ["new-folder"]);
});

test("a refused api call shows the reason instead of failing silently", async () => {
  const { doc, api } = await setup();
  api.bookmarks.remove = async () => { throw new Error("No bookmarks found for the provided GUID."); };
  fire(doc.querySelector('.mark[data-id="b1"]'), "contextmenu");
  doc.querySelector('#menu [data-action="delete"]').click();
  await sleep(0);
  const status = doc.querySelector("#status");
  assert.equal(status.hidden, false);
  assert.equal(doc.querySelector("#status-text").textContent, "No bookmarks found for the provided GUID.");
});

test("a refused move shows the reason and leaves the page alone", async () => {
  const { doc, api } = await setup();
  api.bookmarks.move = async () => { throw new Error("Cannot move bookmarks into root."); };
  const b1 = doc.querySelector('.mark[data-id="b1"]');
  fire(b1, "dragstart");
  fire(doc.querySelector('.mark[data-id="b2"]'), "dragover", { clientY: 0 });
  fire(doc.querySelector('.mark[data-id="b2"]'), "drop", { clientY: 0 });
  await sleep(0);
  assert.equal(doc.querySelector("#status-text").textContent, "Cannot move bookmarks into root.");
});

test("the next successful action clears the status", async () => {
  const { doc, api } = await setup();
  api.bookmarks.remove = async () => { throw new Error("boom"); };
  fire(doc.querySelector('.mark[data-id="b1"]'), "contextmenu");
  doc.querySelector('#menu [data-action="delete"]').click();
  await sleep(0);
  assert.equal(doc.querySelector("#status").hidden, false);

  fire(doc.querySelector('.mark[data-id="b2"]'), "contextmenu");
  doc.querySelector('#menu [data-action="rename"]').click();
  const input = doc.querySelector('.mark[data-id="b2"] input');
  input.value = "renamed";
  key(input, "Enter");
  await sleep(0);
  assert.equal(doc.querySelector("#status").hidden, true);
});

test("a delete leaves the undo notice standing rather than clearing it", async () => {
  const { doc } = await setup();
  fire(doc.querySelector('.mark[data-id="b1"]'), "contextmenu");
  doc.querySelector('#menu [data-action="delete"]').click();
  await sleep(0);
  const status = doc.querySelector("#status");
  assert.equal(status.hidden, false);
  assert.equal(status.dataset.kind, "notice");
  assert.equal(doc.querySelector("#undo").hidden, false);
});

test("the stylesheet keeps a hidden menu entry out of the layout", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "bmarks.css"), "utf8");
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
});

test("renaming drops the tooltip while the field is open and restores it", async () => {
  const { doc } = await setup();
  const row = doc.querySelector('.mark[data-id="b1"]');
  const before = row.title;
  fire(row, "contextmenu");
  doc.querySelector('#menu [data-action="rename"]').click();
  assert.equal(row.hasAttribute("title"), false);
  key(doc.querySelector('.mark[data-id="b1"] input'), "Escape");
  await sleep(0);
  assert.equal(doc.querySelector('.mark[data-id="b1"]').title, before);
});

function views(doc) {
  return Array.from(doc.querySelectorAll("#views button"), (b) => `${b.dataset.view}:${b.getAttribute("aria-selected")}`);
}

test("the page opens in the folders view with that button pressed", async () => {
  const { doc } = await setup();
  assert.deepEqual(views(doc), ["folders:true", "sites:false", "broken:false"]);
  assert.ok(doc.querySelector(".folder"));
  assert.equal(doc.querySelector(".site"), null);
});

test("clicking the site button switches the view and stores the choice", async () => {
  const { doc, api } = await setup();
  doc.querySelector('#views [data-view="sites"]').click();
  await sleep(0);
  assert.deepEqual(views(doc), ["folders:false", "sites:true", "broken:false"]);
  assert.ok(doc.querySelector(".site"));
  assert.equal(doc.querySelector(".folder"), null);
  assert.deepEqual(api.store, { view: "sites" });
});

test("the stored view is the one the next visit opens in", async () => {
  const { doc } = await setup(roots(), { view: "sites" });
  assert.deepEqual(views(doc), ["folders:false", "sites:true", "broken:false"]);
  assert.ok(doc.querySelector(".site"));
});

test("a stored value that names no view falls back to folders", async () => {
  const { doc } = await setup(roots(), { view: "nonsense" });
  assert.deepEqual(views(doc), ["folders:true", "sites:false", "broken:false"]);
  assert.ok(doc.querySelector(".folder"));
});

test("clicking the pressed button changes nothing", async () => {
  const { doc, api } = await setup();
  doc.querySelector('#views [data-view="folders"]').click();
  await sleep(0);
  assert.deepEqual(api.calls, []);
  assert.deepEqual(views(doc), ["folders:true", "sites:false", "broken:false"]);
});

test("the context menu still acts on a bookmark in the sites view", async () => {
  const { doc, api } = await setup(roots(), { view: "sites" });
  const row = doc.querySelector('.mark[data-id="b1"]');
  fire(row, "contextmenu");
  const visible = Array.from(doc.querySelectorAll("#menu button")).filter((b) => !b.hidden).map((b) => b.dataset.action);
  assert.deepEqual(visible, ["open-tab", "copy", "rename", "delete"]);
  doc.querySelector('#menu [data-action="delete"]').click();
  await sleep(0);
  assert.deepEqual(api.calls, [["remove", "b1"]]);
});

test("the page still renders in the default view when storage refuses to answer", async () => {
  const file = path.join(__dirname, "..", "bmarks.html");
  const dom = new JSDOM(fs.readFileSync(file, "utf8"));
  const doc = dom.window.document;
  const api = fakeApi(roots());
  api.storage.local.get = async () => { throw new Error("no storage"); };
  await install(doc, api).ready;
  assert.deepEqual(views(doc), ["folders:true", "sites:false", "broken:false"]);
  assert.equal(doc.querySelectorAll(".mark").length, 7);
});

test("the tab is named bmarks and carries its own icon", () => {
  const dir = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(dir, "bmarks.html"), "utf8");
  assert.match(html, /<title>bmarks<\/title>/);
  const icon = html.match(/<link rel="icon"[^>]*href="([^"]+)"/);
  assert.ok(icon, "no favicon link in the page");
  assert.ok(fs.existsSync(path.join(dir, icon[1])), `${icon[1]} is missing`);
});

test("clicking a bookmark opens it in a tab behind the page", async () => {
  const { doc, api } = await setup();
  const followed = fire(doc.querySelector('.mark[data-id="b2"]'), "click", { button: 0 });
  await sleep(0);
  assert.equal(followed, false, "the page must not navigate away");
  assert.deepEqual(api.calls, [["tab", { url: "http://homeserver/lgh/", active: false }]]);
});

test("a click carrying a modifier is left to the browser", async () => {
  const { doc, api } = await setup();
  for (const modifier of ["ctrlKey", "metaKey", "shiftKey", "altKey"]) {
    fire(doc.querySelector('.mark[data-id="b2"]'), "click", { button: 0, [modifier]: true });
  }
  await sleep(0);
  assert.deepEqual(api.calls, []);
});

test("a click on a row with no url is left alone", async () => {
  const { doc, api } = await setup();
  fire(doc.querySelector('.mark[data-id="b7"]'), "click", { button: 0 });
  await sleep(0);
  assert.deepEqual(api.calls, []);
});

test("the menu marks the row it will act on and names it", async () => {
  const { doc } = await setup();
  const row = doc.querySelector('.mark[data-id="b1"]');
  fire(row, "contextmenu");
  assert.ok(row.classList.contains("targeted"));
  assert.equal(doc.querySelector("#menu-title").textContent, "GitHub");
  fire(doc.querySelector('.folder[data-id="travel"] > .folder-title'), "contextmenu");
  assert.equal(doc.querySelectorAll(".targeted").length, 1);
  assert.equal(doc.querySelector("#menu-title").textContent, "Travel");
});

test("closing the menu without acting takes the mark off again", async () => {
  const { doc } = await setup();
  const row = doc.querySelector('.mark[data-id="b1"]');
  fire(row, "contextmenu");
  key(doc.body, "Escape");
  assert.equal(doc.querySelector(".targeted"), null);
  fire(row, "contextmenu");
  fire(doc.body, "mousedown");
  assert.equal(doc.querySelector(".targeted"), null);
});

test("the row stays marked while the folder delete asks, and is released after", async () => {
  const { doc, dom } = await setup();
  let markedWhileAsking = null;
  dom.window.confirm = () => {
    markedWhileAsking = Array.from(doc.querySelectorAll(".targeted"), (el) => el.dataset.id);
    return false;
  };
  fire(doc.querySelector('.folder[data-id="travel"] > .folder-title'), "contextmenu");
  doc.querySelector('#menu [data-action="delete"]').click();
  await sleep(0);
  assert.deepEqual(markedWhileAsking, ["travel"], "the folder must still be marked while the dialog is up");
  assert.equal(doc.querySelector(".targeted"), null);
});



test("the site toggle hides the domain of every row and is remembered", async () => {
  const { doc, api } = await setup();
  const toggle = doc.querySelector("#toggle-host");
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.equal(doc.querySelector("#sheet").dataset.host, "shown");
  toggle.click();
  await sleep(0);
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  assert.equal(doc.querySelector("#sheet").dataset.host, "hidden");
  assert.deepEqual(api.store, { host: "hidden" });
});

test("the stored site setting survives a re-render into another view", async () => {
  const { doc } = await setup(roots(), { host: "hidden" });
  assert.equal(doc.querySelector("#toggle-host").getAttribute("aria-pressed"), "false");
  assert.equal(doc.querySelector("#sheet").dataset.host, "hidden");
  doc.querySelector('#views [data-view="sites"]').click();
  await sleep(0);
  assert.equal(doc.querySelector("#sheet").dataset.host, "hidden");
});

test("the stylesheet takes the domain out of the row when it is hidden", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "bmarks.css"), "utf8");
  assert.match(css, /#sheet\[data-host="hidden"\][^{]*\.host\s*\{\s*display:\s*none;/);
});

function brokenApi(over = {}) {
  const api = fakeApi(over.tree || roots(), over.store || {});
  api.permissions = {
    request: async (what) => { api.calls.push(["permission", what]); return over.granted !== false; },
  };
  api.answers = over.answers || {};
  api.fetched = [];
  api.fetch = async (url) => {
    api.fetched.push(url);
    const answer = api.answers[url];
    if (answer === "throw") throw new TypeError("NetworkError");
    return { status: answer || 200 };
  };
  return api;
}

async function setupBroken(over = {}) {
  const file = path.join(__dirname, "..", "bmarks.html");
  const virtualConsole = new VirtualConsole().on("jsdomError", () => {});
  const dom = new JSDOM(fs.readFileSync(file, "utf8"), { virtualConsole });
  const doc = dom.window.document;
  const api = brokenApi(over);
  const page = install(doc, api, (...args) => api.fetch(...args));
  await page.ready;
  return { dom, doc, api, page };
}

test("the broken view shows its check bar and hides it again", async () => {
  const { doc } = await setupBroken();
  assert.equal(doc.querySelector("#check").hidden, true);
  doc.querySelector('#views [data-view="broken"]').click();
  await sleep(0);
  assert.equal(doc.querySelector("#check").hidden, false);
  doc.querySelector('#views [data-view="folders"]').click();
  await sleep(0);
  assert.equal(doc.querySelector("#check").hidden, true);
});

test("checking asks for permission, probes every link and groups what came back", async () => {
  const { doc, api } = await setupBroken({
    answers: {
      "https://www.github.com/": 404,
      "http://homeserver/lgh/": "throw",
      "https://www.flyertalk.com/forum/aegean": 403,
    },
  });
  doc.querySelector('#views [data-view="broken"]').click();
  await sleep(0);
  doc.querySelector("#check-run").click();
  await settle();
  assert.ok(
    api.calls.some(([name, what]) => name === "permission" && what.origins[0] === "<all_urls>"),
    "the check must ask for permission"
  );
  assert.equal(api.fetched.length, 6, "every http bookmark, and only those");
  assert.deepEqual(
    Array.from(doc.querySelectorAll(".broken > .broken-title .name"), (el) => el.textContent),
    ["Not found", "Refused", "Unreachable"]
  );
  assert.equal(doc.querySelector('.mark[data-id="b1"] .code').textContent, "404");
  assert.match(doc.querySelector("#check-note").textContent, /3 with a problem/);
});

test("a refused permission says so and probes nothing", async () => {
  const { doc, api } = await setupBroken({ granted: false });
  doc.querySelector('#views [data-view="broken"]').click();
  await sleep(0);
  doc.querySelector("#check-run").click();
  await settle();
  assert.deepEqual(api.fetched, []);
  assert.equal(doc.querySelector("#status").hidden, false);
  assert.match(doc.querySelector("#status-text").textContent, /permission/i);
});

test("what a check found is stored and shown again on the next visit", async () => {
  const first = await setupBroken({ answers: { "https://www.github.com/": 404 } });
  first.doc.querySelector('#views [data-view="broken"]').click();
  await sleep(0);
  first.doc.querySelector("#check-run").click();
  await settle();
  assert.equal(first.api.store.checks.b1.status, 404);

  const again = await setupBroken({ store: first.api.store });
  assert.equal(again.doc.querySelector('.mark[data-id="b1"] .code').textContent, "404");
  assert.deepEqual(again.api.fetched, [], "a stored answer is not asked for again");
});

test("switching views during a check lets it finish", async () => {
  const many = roots();
  const toolbar = many[0].children[0];
  for (let i = 0; i < 30; i++) {
    toolbar.children.push(mark(`x${i}`, "toolbar_____", 2 + i, `Link ${i}`, `https://example.com/${i}`));
  }
  const { doc, api } = await setupBroken({ tree: many });
  const waiting = [];
  api.fetch = () => new Promise((resolve) => waiting.push(() => resolve({ status: 200 })));
  doc.querySelector('#views [data-view="broken"]').click();
  await settle();
  doc.querySelector("#check-run").click();
  await settle();
  doc.querySelector('#views [data-view="folders"]').click();
  await settle();
  while (waiting.length) {
    waiting.shift()();
    await settle();
  }
  assert.equal(Object.keys(api.store.checks).length, 36);
  doc.querySelector('#views [data-view="broken"]').click();
  await settle();
  assert.equal(doc.querySelector("#check-note").textContent, "0 with a problem, 36 answered fine.");
});

test("clicking an item leaves the focus on it", async () => {
  const { doc } = await setup();
  const row = doc.querySelector('.mark[data-id="b1"]');
  fire(row, "click", { button: 0 });
  await sleep(0);
  assert.equal(doc.activeElement, row);
});

test("right clicking an item focuses it too, so the menu and the focus agree", async () => {
  const { doc } = await setup();
  const heading = doc.querySelector('.folder[data-id="travel"] > .folder-title');
  fire(heading, "contextmenu");
  assert.equal(doc.activeElement, heading);
  const row = doc.querySelector('.mark[data-id="b7"]');
  fire(row, "contextmenu");
  assert.equal(doc.activeElement, row, "a row with no link must be focusable as well");
});

test("clicking into the rename field does not steal the focus back to the row", async () => {
  const { doc } = await setup();
  fire(doc.querySelector('.mark[data-id="b1"]'), "contextmenu");
  doc.querySelector('#menu [data-action="rename"]').click();
  const input = doc.querySelector('.mark[data-id="b1"] input');
  assert.equal(doc.activeElement, input);
  fire(input, "click", { button: 0 });
  assert.equal(doc.activeElement, input);
});

test("the item last clicked stays marked, and only that one", async () => {
  const { doc } = await setup();
  const first = doc.querySelector('.mark[data-id="b1"]');
  const second = doc.querySelector('.mark[data-id="b2"]');
  fire(first, "click", { button: 0 });
  await sleep(0);
  assert.deepEqual(Array.from(doc.querySelectorAll(".focused"), (el) => el.dataset.id), ["b1"]);
  fire(second, "contextmenu");
  assert.deepEqual(Array.from(doc.querySelectorAll(".focused"), (el) => el.dataset.id), ["b2"]);
});

test("the stylesheet marks the focused item without waiting for the window to be active", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "bmarks.css"), "utf8");
  assert.match(css, /\.mark\.focused/);
});

function hover(doc, el) {
  const Ctor = doc.defaultView.MouseEvent;
  el.dispatchEvent(new Ctor("mouseover", { bubbles: true, cancelable: true }));
}

test("hovering a bookmark offers a trash button for that row", async () => {
  const { doc } = await setup();
  const trash = doc.querySelector("#trash");
  assert.equal(trash.hidden, true);
  hover(doc, doc.querySelector('.mark[data-id="b1"]'));
  assert.equal(trash.hidden, false);
  assert.equal(trash.dataset.for, "b1");
  hover(doc, doc.querySelector('.mark[data-id="b3"]'));
  assert.equal(trash.dataset.for, "b3");
});

test("the trash button keeps away from folders and separators", async () => {
  const { doc } = await setup();
  const trash = doc.querySelector("#trash");
  hover(doc, doc.querySelector('.mark[data-id="b1"]'));
  assert.equal(trash.hidden, false);
  hover(doc, doc.querySelector('.folder[data-id="travel"] > .folder-title'));
  assert.equal(trash.hidden, true);
  hover(doc, doc.querySelector('.mark[data-id="b1"]'));
  hover(doc, doc.querySelector('.separator[data-id="sep"]'));
  assert.equal(trash.hidden, true);
});

test("hovering the trash button itself does not take it away", async () => {
  const { doc } = await setup();
  const trash = doc.querySelector("#trash");
  hover(doc, doc.querySelector('.mark[data-id="b1"]'));
  hover(doc, trash);
  assert.equal(trash.hidden, false);
  assert.equal(trash.dataset.for, "b1");
});

test("the trash button deletes in one click and does not follow the link", async () => {
  const { doc, api } = await setup();
  const trash = doc.querySelector("#trash");
  hover(doc, doc.querySelector('.mark[data-id="b1"]'));
  const followed = fire(trash, "click", { button: 0 });
  await sleep(0);
  assert.equal(followed, false);
  assert.deepEqual(api.calls.filter(([name]) => name === "remove"), [["remove", "b1"]]);
  assert.equal(api.calls.some(([name]) => name === "tab"), false, "it must not open the bookmark");
  assert.equal(trash.hidden, true);
});

test("a deleted bookmark can be put back where it was", async () => {
  const { doc, api } = await setup();
  hover(doc, doc.querySelector('.mark[data-id="b5"]'));
  fire(doc.querySelector("#trash"), "click", { button: 0 });
  await sleep(0);
  const undo = doc.querySelector("#undo");
  assert.equal(undo.hidden, false);
  assert.match(doc.querySelector("#status-text").textContent, /FlyerTalk/);
  undo.click();
  await sleep(0);
  assert.deepEqual(api.calls.filter(([name]) => name === "create"), [[
    "create",
    {
      parentId: "aegean",
      index: 1,
      title: "FlyerTalk status match thread",
      url: "https://www.flyertalk.com/forum/aegean",
    },
  ]]);
  assert.equal(doc.querySelector("#undo").hidden, true);
});

test("an error takes the status line back off the undo", async () => {
  const { doc, api } = await setup();
  hover(doc, doc.querySelector('.mark[data-id="b1"]'));
  fire(doc.querySelector("#trash"), "click", { button: 0 });
  await sleep(0);
  assert.equal(doc.querySelector("#undo").hidden, false);
  api.bookmarks.remove = async () => { throw new Error("nope"); };
  fire(doc.querySelector('.mark[data-id="b2"]'), "contextmenu");
  doc.querySelector('#menu [data-action="delete"]').click();
  await sleep(0);
  assert.equal(doc.querySelector("#undo").hidden, true);
  assert.equal(doc.querySelector("#status-text").textContent, "nope");
});

test("the row goes away at the click, before the api has answered", async () => {
  const { doc, api } = await setup();
  let answer;
  api.bookmarks.remove = (id) => {
    api.calls.push(["remove", id]);
    return new Promise((resolve) => (answer = resolve));
  };
  hover(doc, doc.querySelector('.mark[data-id="b1"]'));
  fire(doc.querySelector("#trash"), "click", { button: 0 });
  assert.equal(doc.querySelector('.mark[data-id="b1"]'), null, "the row must be gone already");
  assert.equal(doc.querySelector("#undo").hidden, false, "the undo must be offered already");
  assert.deepEqual(api.calls.filter(([name]) => name === "remove"), [["remove", "b1"]]);
  answer();
});

test("a bookmark the api refuses to delete comes back on the page", async () => {
  const { doc, api } = await setup();
  api.bookmarks.remove = async () => { throw new Error("nope"); };
  hover(doc, doc.querySelector('.mark[data-id="b1"]'));
  fire(doc.querySelector("#trash"), "click", { button: 0 });
  assert.equal(doc.querySelector('.mark[data-id="b1"]'), null);
  await sleep(0);
  assert.ok(doc.querySelector('.mark[data-id="b1"]'), "the row must be back");
  assert.equal(doc.querySelector("#status-text").textContent, "nope");
});

async function sites(doc) {
  doc.querySelector('#views [data-view="sites"]').click();
  await sleep(0);
}

test("clicking a site group leaves that group alone on the page", async () => {
  const { doc } = await setup();
  await sites(doc);
  assert.ok(doc.querySelectorAll(".site").length > 1);
  const host = doc.querySelector(".site").dataset.host;
  doc.querySelector(".site-title .name").click();
  await sleep(0);
  assert.deepEqual(Array.from(doc.querySelectorAll(".site"), (s) => s.dataset.host), [host]);
  assert.equal(doc.querySelector("#back").hidden, false);
  assert.equal(doc.querySelector("#back-name").textContent, "All sites");
});

test("the back button brings every group back", async () => {
  const { doc } = await setup();
  await sites(doc);
  const all = doc.querySelectorAll(".site").length;
  doc.querySelector(".site-title").click();
  await sleep(0);
  doc.querySelector("#back").click();
  await settle();
  assert.equal(doc.querySelectorAll(".site").length, all);
  assert.equal(doc.querySelector("#back").hidden, true);
});

test("Escape leaves the group as well", async () => {
  const { doc } = await setup();
  await sites(doc);
  doc.querySelector(".site-title").click();
  await sleep(0);
  key(doc.querySelector(".mark"), "Escape");
  await settle();
  assert.ok(doc.querySelectorAll(".site").length > 1);
  assert.equal(doc.querySelector("#back").hidden, true);
});

test("another view drops the single group", async () => {
  const { doc } = await setup();
  await sites(doc);
  doc.querySelector(".site-title").click();
  await sleep(0);
  doc.querySelector('#views [data-view="folders"]').click();
  await sleep(0);
  assert.ok(doc.querySelectorAll(".folder").length > 1);
  assert.equal(doc.querySelector("#back").hidden, true);
});


test("a bookmark inside a group still opens rather than reopening the group", async () => {
  const { doc, api } = await setup();
  await sites(doc);
  doc.querySelector(".site-title").click();
  await sleep(0);
  fire(doc.querySelector(".mark"), "click", { button: 0 });
  await sleep(0);
  assert.equal(api.calls.some(([name]) => name === "tab"), true);
});

function watchScroll(dom) {
  const calls = [];
  dom.window.scrollTo = (x, y) => {
    calls.push(y);
    Object.defineProperty(dom.window, "scrollY", { value: y, configurable: true });
  };
  return calls;
}

test("the browser back button leaves the group", async () => {
  const { doc, dom } = await setup();
  await sites(doc);
  const all = doc.querySelectorAll(".site").length;
  doc.querySelector(".site-title").click();
  await sleep(0);
  assert.equal(doc.querySelectorAll(".site").length, 1);
  dom.window.history.back();
  await settle();
  assert.equal(doc.querySelectorAll(".site").length, all);
  assert.equal(doc.querySelector("#back").hidden, true);
});

test("leaving the group puts the list back where it was scrolled", async () => {
  const { doc, dom } = await setup();
  await sites(doc);
  const scrolls = watchScroll(dom);
  Object.defineProperty(dom.window, "scrollY", { value: 640, configurable: true });
  doc.querySelector(".site-title").click();
  await sleep(0);
  assert.deepEqual(scrolls, [0], "a group opens at the top");
  doc.querySelector("#back").click();
  await settle();
  assert.equal(scrolls.at(-1), 640);
});

test("the back button walks the history rather than piling entries on it", async () => {
  const { doc, dom } = await setup();
  await sites(doc);
  watchScroll(dom);
  const before = dom.window.history.length;
  doc.querySelector(".site-title").click();
  await sleep(0);
  assert.equal(dom.window.history.length, before + 1);
  doc.querySelector("#back").click();
  await settle();
  assert.equal(dom.window.history.length, before + 1);
  assert.ok(doc.querySelectorAll(".site").length > 1);
});

test("switching view says the page is working until the new view is drawn", async () => {
  const { doc } = await setup();
  const busy = doc.querySelector("#busy");
  const sheet = doc.querySelector("#sheet");
  assert.equal(busy.hidden, true);
  doc.querySelector('#views [data-view="sites"]').click();
  assert.equal(busy.hidden, false, "the mark must be up before the render blocks");
  assert.equal(sheet.getAttribute("aria-busy"), "true");
  await settle();
  assert.equal(busy.hidden, true);
  assert.equal(sheet.getAttribute("aria-busy"), "false");
  assert.ok(doc.querySelectorAll(".site").length > 1);
});

test("opening a group says the page is working too", async () => {
  const { doc } = await setup();
  await sites(doc);
  doc.querySelector(".site-title").click();
  assert.equal(doc.querySelector("#busy").hidden, false);
  await settle();
  assert.equal(doc.querySelector("#busy").hidden, true);
  assert.equal(doc.querySelectorAll(".site").length, 1);
});

test("a failed refresh does not leave the page marked as working", async () => {
  const { doc, api } = await setup();
  api.bookmarks.getTree = async () => { throw new Error("no tree"); };
  doc.querySelector('#views [data-view="sites"]').click();
  await settle();
  assert.equal(doc.querySelector("#busy").hidden, true);
  assert.equal(doc.querySelector("#status-text").textContent, "no tree");
});

test("the site toggle says what it does", async () => {
  const { doc } = await setup();
  assert.equal(doc.querySelector("#toggle-host").textContent.trim(), "Show domain");
});

test("the stylesheet gives every enabled button a pointer", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "bmarks.css"), "utf8");
  assert.match(css, /button:not\(\[disabled\]\)\s*\{\s*cursor:\s*pointer;/);
  assert.doesNotMatch(css, /cursor:\s*default/);
});

test("the back button sits under the status line, above the content", async () => {
  const { doc } = await setup();
  const order = Array.from(doc.querySelector("main").children, (el) => el.id || el.tagName.toLowerCase());
  assert.deepEqual(order.slice(order.indexOf("status"), order.indexOf("sheet") + 1), ["status", "back", "check", "sheet"]);
});

test("the check note counts only bookmarks that still exist", async () => {
  const gone = { outcome: "Not found", status: 404, at: 1 };
  const { doc } = await setupBroken({ store: { checks: { b1: { outcome: "OK", status: 200, at: 1 }, deleted: gone } } });
  doc.querySelector('#views [data-view="broken"]').click();
  await sleep(0);
  assert.equal(doc.querySelector("#check-note").textContent, "0 with a problem, 1 answered fine.");
});

test("a new check forgets the results of deleted bookmarks", async () => {
  const gone = { outcome: "Not found", status: 404, at: 1 };
  const { dom, doc, api } = await setupBroken({ store: { checks: { deleted: gone } } });
  doc.querySelector('#views [data-view="broken"]').click();
  await sleep(0);
  dom.window.confirm = () => true;
  doc.querySelector("#check-run").click();
  await settle();
  assert.equal("deleted" in api.store.checks, false);
});

test("the white buttons change colour under the pointer", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "bmarks.css"), "utf8");
  assert.match(css, /\.chip\[aria-pressed="true"\]:hover,\s*#undo:hover\s*\{\s*background:\s*var\(--accent-soft\);/);
  assert.match(css, /\.views button:not\(\[aria-pressed="true"\]\):hover\s*\{\s*background:\s*var\(--border\);/);
});

test("checking again asks first, since it throws the current results away", async () => {
  const found = { outcome: "Not found", status: 404, at: 1 };
  const { dom, doc, api } = await setupBroken({ store: { checks: { b1: found } } });
  doc.querySelector('#views [data-view="broken"]').click();
  await sleep(0);
  assert.equal(doc.querySelector("#check-clear"), null);
  let asked = 0;
  dom.window.confirm = () => { asked += 1; return false; };
  doc.querySelector("#check-run").click();
  await settle();
  assert.equal(asked, 1);
  assert.deepEqual(api.fetched, []);
  assert.equal(api.store.checks.b1.status, 404);
  dom.window.confirm = () => { asked += 1; return true; };
  doc.querySelector("#check-run").click();
  await settle();
  assert.equal(asked, 2);
  assert.ok(api.fetched.length > 0);
  assert.equal(api.store.checks.b1.outcome, "OK");
});

test("the first check does not ask", async () => {
  const { dom, doc, api } = await setupBroken();
  doc.querySelector('#views [data-view="broken"]').click();
  await sleep(0);
  dom.window.confirm = () => { throw new Error("asked"); };
  doc.querySelector("#check-run").click();
  await settle();
  assert.ok(api.fetched.length > 0);
});

test("a page opened on the broken view counts the stored results", async () => {
  const found = { outcome: "Not found", status: 404, at: 1 };
  const { doc } = await setupBroken({ store: { view: "broken", checks: { b1: found } } });
  assert.equal(doc.querySelector("#check-note").textContent, "1 with a problem, 0 answered fine.");
});

test("the close button dismisses the status line and its undo", async () => {
  const { doc, api } = await setup();
  hover(doc, doc.querySelector('.mark[data-id="b5"]'));
  fire(doc.querySelector("#trash"), "click", { button: 0 });
  await sleep(0);
  assert.equal(doc.querySelector("#status").hidden, false);
  doc.querySelector("#dismiss").click();
  assert.equal(doc.querySelector("#status").hidden, true);
  doc.querySelector("#undo").click();
  await sleep(0);
  assert.equal(api.calls.some(([name]) => name === "create"), false, "undo must be gone with the line");
});

test("the density buttons set the row spacing and are remembered", async () => {
  const { doc, api } = await setup();
  const pressed = () => Array.from(doc.querySelectorAll("#density button"), (b) => `${b.dataset.density}:${b.getAttribute("aria-pressed")}`);
  assert.deepEqual(pressed(), ["roomy:false", "default:true", "compact:false"]);
  assert.equal(doc.querySelector("#sheet").dataset.density, "default");
  doc.querySelector('#density [data-density="compact"]').click();
  await sleep(0);
  assert.deepEqual(pressed(), ["roomy:false", "default:false", "compact:true"]);
  assert.equal(doc.querySelector("#sheet").dataset.density, "compact");
  assert.deepEqual(api.store, { density: "compact" });
});

test("a stored density is applied when the page opens", async () => {
  const { doc } = await setup(roots(), { density: "roomy" });
  assert.equal(doc.querySelector("#sheet").dataset.density, "roomy");
  assert.equal(doc.querySelector('#density [data-density="roomy"]').getAttribute("aria-pressed"), "true");
});

test("the stylesheet spaces the rows by density", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "bmarks.css"), "utf8");
  assert.match(css, /#sheet\[data-density="roomy"\] \.mark\s*\{\s*min-height: 30px;\s*padding: 0 8px;/);
  assert.match(css, /#sheet\[data-density="compact"\] \.mark\s*\{\s*min-height:/);
});

test("a site title that opens its group shows a pointer", () => {
  const { JSDOM } = require("jsdom");
  const css = fs.readFileSync(path.join(__dirname, "..", "bmarks.css"), "utf8");
  const dom = new JSDOM(`<style>${css}</style><div id="sheet" class="sheet"><section class="site"><h2 class="site-title">x</h2></section></div>`);
  const title = dom.window.document.querySelector(".site-title");
  assert.equal(dom.window.getComputedStyle(title).cursor, "pointer");
});

test("no selector in the stylesheet repeats the sheet by mistake", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "bmarks.css"), "utf8");
  assert.doesNotMatch(css, /\.sheet[^{},]*\.sheet/);
});

test("the density buttons are named spacious, normal and compact", async () => {
  const { doc } = await setup();
  assert.deepEqual(Array.from(doc.querySelectorAll("#density button"), (b) => b.title), ["Spacious", "Normal", "Compact"]);
});

test("a separator with nothing to separate is not drawn", () => {
  const { JSDOM } = require("jsdom");
  const css = fs.readFileSync(path.join(__dirname, "..", "bmarks.css"), "utf8");
  const dom = new JSDOM(`<style>${css}</style><div class="items">
    <div class="separator" id="first"></div><a class="mark"></a>
    <div class="separator" id="middle"></div><div class="separator" id="double"></div><a class="mark"></a>
    <div class="separator" id="last"></div></div>`);
  const shown = (id) => dom.window.getComputedStyle(dom.window.document.getElementById(id)).display !== "none";
  assert.deepEqual(["first", "middle", "double", "last"].map(shown), [false, true, false, false]);
});



test("the row spacing also sets the number of columns on a wide window", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "bmarks.css"), "utf8");
  assert.match(css, /@media \(min-width: 860px\) \{\s*#sheet\[data-density="roomy"\]:is\(:not\(\[data-only\]\), \[data-view="folders"\]\) \{ column-count: 2; \}/);
  assert.match(css, /@media \(min-width: 1160px\) \{\s*#sheet\[data-density="default"\]:is\(:not\(\[data-only\]\), \[data-view="folders"\]\) \{ column-count: 3; \}/);
  assert.doesNotMatch(css, /data-columns/);
});

test("there is no separate column control", async () => {
  const { doc } = await setup();
  assert.equal(doc.querySelector("#columns"), null);
});

test("the trash button is large enough to hit without aiming", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "bmarks.css"), "utf8");
  assert.match(css, /\.trash \{[^}]*width: 30px;\s*height: 26px;/);
});

test("the check bar belongs to the list of outcomes, not to one outcome", async () => {
  const found = { outcome: "Not found", status: 404, at: 1 };
  const { doc } = await setupBroken({ store: { view: "broken", checks: { b1: found } } });
  assert.equal(doc.querySelector("#check").hidden, false);
  doc.querySelector(".broken-title .name").click();
  await sleep(0);
  assert.equal(doc.querySelector("#check").hidden, true);
  doc.querySelector("#back").click();
  await settle();
  assert.equal(doc.querySelector("#check").hidden, false);
});

test("the views are tabs above the content", async () => {
  const { doc } = await setup();
  const tabs = doc.querySelector("#views");
  assert.equal(tabs.getAttribute("role"), "tablist");
  assert.equal(tabs.parentElement.tagName, "MAIN");
  assert.equal(tabs.closest("header"), null);
  assert.deepEqual(Array.from(tabs.querySelectorAll('[role="tab"]'), (t) => t.textContent.trim()), ["Folders", "Sites", "Broken links"]);
});

function folderTitle(doc, id) {
  return doc.querySelector(`.folder[data-id="${id}"] > .folder-title .name`);
}

test("clicking a folder title shows that folder alone", async () => {
  const { doc } = await setup();
  folderTitle(doc, "travel").click();
  await sleep(0);
  assert.deepEqual(Array.from(doc.querySelectorAll("#sheet > .folder"), (f) => f.dataset.id), ["travel"]);
  assert.equal(doc.querySelector("#hint").textContent, "4 bookmarks, 1 folder");
  assert.equal(doc.querySelector("#back").hidden, false);
  assert.equal(doc.querySelector("#back-name").textContent, "All folders");
});

test("a folder inside an open folder opens in turn and back returns to its parent", async () => {
  const { doc } = await setup();
  folderTitle(doc, "travel").click();
  await sleep(0);
  folderTitle(doc, "aegean").click();
  await sleep(0);
  assert.deepEqual(Array.from(doc.querySelectorAll("#sheet > .folder"), (f) => f.dataset.id), ["aegean"]);
  assert.equal(doc.querySelector("#back-name").textContent, "Travel");
  doc.querySelector("#back").click();
  await settle();
  assert.deepEqual(Array.from(doc.querySelectorAll("#sheet > .folder"), (f) => f.dataset.id), ["travel"]);
  assert.equal(doc.querySelector("#back-name").textContent, "All folders");
});

test("clicking the title of the folder already open changes nothing", async () => {
  const { doc } = await setup();
  folderTitle(doc, "travel").click();
  await sleep(0);
  const length = doc.defaultView.history.length;
  folderTitle(doc, "travel").click();
  await sleep(0);
  assert.equal(doc.defaultView.history.length, length);
});

test("folder titles show a pointer, except the one already open", () => {
  const { JSDOM } = require("jsdom");
  const css = fs.readFileSync(path.join(__dirname, "..", "bmarks.css"), "utf8");
  const dom = new JSDOM(`<style>${css}</style><div id="sheet" class="sheet" data-view="folders" data-only="t">
    <section class="folder top" data-id="t"><h2 class="folder-title" id="open">x</h2>
    <div class="items"><section class="folder" data-id="s"><h3 class="folder-title" id="sub">y</h3></section></div></section></div>`);
  const cursor = (id) => dom.window.getComputedStyle(dom.window.document.getElementById(id)).cursor;
  assert.equal(cursor("sub"), "pointer");
  assert.notEqual(cursor("open"), "pointer");
});

test("a site or outcome group is not split across two columns", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "bmarks.css"), "utf8");
  assert.match(css, /\.broken,\s*\.site \{[^}]*break-inside: avoid;/);
});

function siteTitle(doc, host) {
  return doc.querySelector(`.site[data-host="${host}"] > .site-title`);
}

test("right click on a site heading offers only delete", async () => {
  const { doc } = await setup();
  await sites(doc);
  fire(siteTitle(doc, "github.com"), "contextmenu", { clientX: 10, clientY: 10 });
  const shown = Array.from(doc.querySelectorAll("#menu button"), (b) => b.hidden ? null : b.dataset.action).filter(Boolean);
  assert.deepEqual(shown, ["delete"]);
  assert.equal(doc.querySelector("#menu-title").textContent, "github.com");
});

test("deleting a site group asks first and then removes every bookmark in it", async () => {
  const { dom, doc, api } = await setup();
  await sites(doc);
  let question = "";
  dom.window.confirm = (q) => { question = q; return false; };
  fire(siteTitle(doc, "github.com"), "contextmenu", { clientX: 10, clientY: 10 });
  doc.querySelector('#menu [data-action="delete"]').click();
  await sleep(0);
  assert.match(question, /1 bookmark in "github\.com"/);
  assert.deepEqual(api.calls.filter(([name]) => name === "remove"), []);
  dom.window.confirm = () => true;
  fire(siteTitle(doc, "github.com"), "contextmenu", { clientX: 10, clientY: 10 });
  doc.querySelector('#menu [data-action="delete"]').click();
  await sleep(0);
  assert.deepEqual(api.calls.filter(([name]) => name === "remove"), [["remove", "b1"]]);
});

test("deleting the group that is open on its own goes back to the list", async () => {
  const { dom, doc } = await setup();
  await sites(doc);
  siteTitle(doc, "github.com").click();
  await sleep(0);
  dom.window.confirm = () => true;
  fire(siteTitle(doc, "github.com"), "contextmenu", { clientX: 10, clientY: 10 });
  doc.querySelector('#menu [data-action="delete"]').click();
  await settle();
  assert.equal(doc.querySelector("#back").hidden, true);
});

test("the status line floats over the page instead of pushing it down", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "bmarks.css"), "utf8");
  assert.match(css, /\.status \{[^}]*position: fixed;/);
});
