const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { roots, mark, folder } = require("./fixture.js");

require("../tree.js");
require("../check.js");

const { indexTree, countMarks, host, isRoot, groupBySite, dropZone, dropPlan, render } = globalThis.bmarksTree;

function page() {
  const file = path.join(__dirname, "..", "bmarks.html");
  return new JSDOM(fs.readFileSync(file, "utf8")).window.document;
}

function texts(doc, selector) {
  return Array.from(doc.querySelectorAll(selector), (el) => el.textContent.trim());
}

test("countMarks counts bookmarks in the subtree", () => {
  const byId = indexTree(roots());
  assert.equal(countMarks(byId.get("root________")), 7);
  assert.equal(countMarks(byId.get("travel")), 4);
  assert.equal(countMarks(byId.get("unfiled_____")), 0);
  assert.equal(countMarks(byId.get("b1")), 1);
});

test("host strips www and keeps the scheme of non web urls", () => {
  assert.equal(host("https://www.github.com/x"), "github.com");
  assert.equal(host("http://homeserver/lgh/"), "homeserver");
  assert.equal(host("place:type=6"), "place:");
  assert.equal(host("file:///home/fabio"), "file:");
  assert.equal(host("nonsense"), "");
});

test("dropZone splits a bookmark row in halves and a folder heading in thirds", () => {
  const rect = { top: 100, height: 30 };
  assert.equal(dropZone(rect, 105, false), "before");
  assert.equal(dropZone(rect, 125, false), "after");
  assert.equal(dropZone(rect, 105, true), "before");
  assert.equal(dropZone(rect, 115, true), "into");
  assert.equal(dropZone(rect, 125, true), "after");
});

test("dropPlan reorders inside a folder with the final index", () => {
  const byId = indexTree(roots());
  assert.deepEqual(dropPlan(byId, "b1", "b2", "after"), { parentId: "toolbar_____", index: 1 });
  assert.deepEqual(dropPlan(byId, "b2", "b1", "before"), { parentId: "toolbar_____", index: 0 });
  assert.deepEqual(dropPlan(byId, "b3", "b6", "after"), { parentId: "travel", index: 3 });
  assert.deepEqual(dropPlan(byId, "b6", "b3", "before"), { parentId: "travel", index: 0 });
});

test("dropPlan refuses a drop that changes nothing", () => {
  const byId = indexTree(roots());
  assert.equal(dropPlan(byId, "b1", "b2", "before"), null);
  assert.equal(dropPlan(byId, "b2", "b1", "after"), null);
  assert.equal(dropPlan(byId, "b1", "b1", "after"), null);
  assert.equal(dropPlan(byId, "b6", "travel", "into"), null);
  assert.equal(dropPlan(byId, "b6", "sep", "after"), null);
});

test("dropPlan moves into a folder at the end, also from inside it", () => {
  const byId = indexTree(roots());
  assert.deepEqual(dropPlan(byId, "b1", "travel", "into"), { parentId: "travel", index: 4 });
  assert.deepEqual(dropPlan(byId, "b3", "travel", "into"), { parentId: "travel", index: 3 });
  assert.deepEqual(dropPlan(byId, "b1", "unfiled_____", "into"), { parentId: "unfiled_____", index: 0 });
});

test("dropPlan places before or after a folder heading among its siblings", () => {
  const byId = indexTree(roots());
  assert.deepEqual(dropPlan(byId, "b1", "aegean", "before"), { parentId: "travel", index: 1 });
  assert.deepEqual(dropPlan(byId, "b1", "aegean", "after"), { parentId: "travel", index: 2 });
  assert.deepEqual(dropPlan(byId, "aegean", "toolbar_____", "into"), { parentId: "toolbar_____", index: 2 });
});

test("dropPlan refuses a folder into itself or its descendants, and into a bookmark", () => {
  const byId = indexTree(roots());
  assert.equal(dropPlan(byId, "travel", "travel", "into"), null);
  assert.equal(dropPlan(byId, "travel", "aegean", "into"), null);
  assert.equal(dropPlan(byId, "travel", "b4", "after"), null);
  assert.equal(dropPlan(byId, "b1", "b2", "into"), null);
  assert.equal(dropPlan(byId, "b1", "missing", "after"), null);
});

test("render lays out non empty roots as top level blocks in api order", () => {
  const doc = page();
  render(doc, roots()[0]);
  assert.deepEqual(texts(doc, "#sheet > .folder > .folder-title .name"), ["Bookmarks Toolbar", "Bookmarks Menu"]);
  assert.deepEqual(texts(doc, ".folder-title .name"), ["Bookmarks Toolbar", "Bookmarks Menu", "Travel", "Aegean"]);
  assert.equal(doc.querySelector("#hint").textContent, "7 bookmarks, 4 folders");
});

test("render keeps native order and nests folders inside their parent", () => {
  const doc = page();
  render(doc, roots()[0]);
  assert.deepEqual(texts(doc, ".mark .name"), [
    "GitHub", "homeserver", "EU261 compensation calculator", "Miles+Bonus tiers",
    "FlyerTalk status match thread", "Rome2rio: Athens to Santorini", "Recent tags",
  ]);
  const travel = doc.querySelector('.folder[data-id="travel"]');
  assert.deepEqual(Array.from(travel.querySelector(":scope > .items").children, (el) => el.dataset.id), ["b3", "aegean", "sep", "b6"]);
  assert.ok(doc.querySelector('.folder[data-id="aegean"] .folder-title').matches("h3"));
  assert.ok(doc.querySelector('.folder[data-id="travel"] .folder-title').matches("h3"));
  assert.ok(doc.querySelector('.folder[data-id="menu________"] .folder-title').matches("h2"));
});

test("render writes links with host, counts and draggable rows", () => {
  const doc = page();
  render(doc, roots()[0]);
  const b1 = doc.querySelector('.mark[data-id="b1"]');
  assert.equal(b1.tagName, "A");
  assert.equal(b1.getAttribute("href"), "https://www.github.com/");
  assert.equal(b1.querySelector(".host").textContent, "github.com");
  assert.equal(b1.getAttribute("draggable"), "true");
  const b7 = doc.querySelector('.mark[data-id="b7"]');
  assert.equal(b7.tagName, "SPAN");
  assert.equal(b7.querySelector(".host").textContent, "place:");
  assert.equal(doc.querySelector('.folder[data-id="travel"] > .folder-title .count').textContent, "4");
  assert.equal(doc.querySelector('.folder[data-id="travel"] > .folder-title').getAttribute("draggable"), "true");
  assert.equal(doc.querySelector('.folder[data-id="toolbar_____"] > .folder-title').getAttribute("draggable"), null);
  assert.ok(doc.querySelector('.separator[data-id="sep"]'));
});

test("render twice replaces the sheet instead of appending", () => {
  const doc = page();
  render(doc, roots()[0]);
  render(doc, roots()[0]);
  assert.equal(doc.querySelectorAll(".mark").length, 7);
});

test("isRoot knows the built in roots Firefox refuses to move or remove", () => {
  assert.equal(isRoot("menu________"), true);
  assert.equal(isRoot("toolbar_____"), true);
  assert.equal(isRoot("unfiled_____"), true);
  assert.equal(isRoot("mobile______"), true);
  assert.equal(isRoot("root________"), true);
  assert.equal(isRoot("travel"), false);
});

test("dropPlan refuses to move a built in root", () => {
  const byId = indexTree(roots());
  assert.equal(dropPlan(byId, "menu________", "travel", "into"), null);
  assert.equal(dropPlan(byId, "toolbar_____", "b3", "after"), null);
});

test("dropPlan refuses a drop beside a built in root, which would land in the places root", () => {
  const byId = indexTree(roots());
  assert.equal(dropPlan(byId, "b1", "menu________", "before"), null);
  assert.equal(dropPlan(byId, "b1", "menu________", "after"), null);
  assert.deepEqual(dropPlan(byId, "b1", "menu________", "into"), { parentId: "menu________", index: 2 });
});

test("render gives every row a tooltip carrying the full title", () => {
  const doc = page();
  render(doc, roots()[0]);
  assert.equal(
    doc.querySelector('.mark[data-id="b3"]').title,
    "EU261 compensation calculator\nhttps://www.airhelp.com/en/eu261"
  );
  assert.equal(doc.querySelector('.folder[data-id="travel"] > .folder-title').title, "Travel");
  assert.equal(doc.querySelector('.folder[data-id="menu________"] > .folder-title').title, "Bookmarks Menu");
});

test("a bookmark with no title of its own names the url once", () => {
  const doc = page();
  render(doc, folder("root________", undefined, 0, "", [
    folder("menu________", "root________", 0, "Menu", [
      mark("x", "menu________", 0, "", "https://example.com/a"),
      mark("y", "menu________", 1, "Recent tags", "place:type=6"),
    ]),
  ]));
  assert.equal(doc.querySelector('.mark[data-id="x"]').title, "https://example.com/a");
  assert.equal(doc.querySelector('.mark[data-id="y"]').title, "Recent tags\nplace:type=6");
});

function siteTree() {
  return folder("root________", undefined, 0, "", [
    folder("menu________", "root________", 0, "Bookmarks Menu", [
      mark("a", "menu________", 0, "Zeta post", "https://www.lwn.net/z"),
      mark("b", "menu________", 1, "Alpha post", "https://lwn.net/a"),
      folder("sub", "menu________", 2, "Sub", [
        mark("c", "sub", 0, "Third post", "https://lwn.net/c"),
        mark("d", "sub", 1, "Only one", "https://go.dev/x"),
      ]),
      mark("e", "menu________", 3, "Tags", "place:type=6"),
    ]),
  ]);
}

test("groupBySite collects the whole tree by host, in host order", () => {
  const groups = groupBySite(siteTree());
  assert.deepEqual(groups.map((g) => [g.host, g.marks.length]), [["go.dev", 1], ["lwn.net", 3], ["place:", 1]]);
});

test("a group keeps its place when one of its bookmarks goes", () => {
  const full = siteTree();
  const before = groupBySite(full).map((g) => g.host);

  const menu = full.children[0];
  menu.children = menu.children.filter((node) => node.id !== "a");
  const after = groupBySite(full).map((g) => g.host);

  assert.deepEqual(after, before, "the order must not depend on how many are in a group");
  assert.equal(groupBySite(full).find((g) => g.host === "lwn.net").marks.length, 2);
});

test("groupBySite sorts each group by title", () => {
  const groups = groupBySite(siteTree());
  const lwn = groups.find((group) => group.host === "lwn.net");
  assert.deepEqual(lwn.marks.map((m) => m.title), ["Alpha post", "Third post", "Zeta post"]);
});

test("the sites view writes one block per host and drops the folders", () => {
  const doc = page();
  render(doc, siteTree(), "sites");
  assert.deepEqual(texts(doc, ".site > .site-title .name"), ["go.dev", "lwn.net", "place:"]);
  assert.equal(doc.querySelectorAll(".folder").length, 0);
  assert.deepEqual(Array.from(doc.querySelectorAll('.site[data-host="lwn.net"] .mark'), (m) => m.dataset.id), ["b", "c", "a"]);
  assert.equal(doc.querySelector('.site[data-host="lwn.net"] > .site-title .count').textContent, "3");
});

test("the sites view counts sites in the hint", () => {
  const doc = page();
  render(doc, siteTree(), "sites");
  assert.equal(doc.querySelector("#hint").textContent, "5 bookmarks, 3 sites");
});

test("a row in the sites view cannot be dragged, since a host is not a place to drop", () => {
  const doc = page();
  render(doc, siteTree(), "sites");
  for (const row of doc.querySelectorAll(".mark")) assert.equal(row.getAttribute("draggable"), "false");
  render(doc, siteTree(), "folders");
  for (const row of doc.querySelectorAll(".mark")) assert.equal(row.getAttribute("draggable"), "true");
});

test("rendering the folders view after the sites view leaves no site block behind", () => {
  const doc = page();
  render(doc, roots()[0], "sites");
  render(doc, roots()[0], "folders");
  assert.equal(doc.querySelectorAll(".site").length, 0);
  assert.equal(doc.querySelectorAll(".mark").length, 7);
  assert.equal(doc.querySelector("#hint").textContent, "7 bookmarks, 4 folders");
});






function brokenTree() {
  return folder("root________", undefined, 0, "", [
    folder("menu________", "root________", 0, "Bookmarks Menu", [
      mark("gone", "menu________", 0, "A dead page", "https://example.com/gone"),
      mark("wall", "menu________", 1, "Behind a login", "https://example.com/wall"),
      mark("boom", "menu________", 2, "A broken server", "https://example.com/boom"),
      mark("away", "menu________", 3, "A host that vanished", "https://nowhere.invalid/"),
      mark("fine", "menu________", 4, "Still there", "https://example.com/ok"),
      mark("tags", "menu________", 5, "Recent tags", "place:type=6"),
      mark("disk", "menu________", 6, "A local file", "file:///srv/notes.txt"),
    ]),
  ]);
}

const CHECKS = {
  gone: { outcome: "Not found", status: 404 },
  wall: { outcome: "Refused", status: 403 },
  boom: { outcome: "Error", status: 500 },
  away: { outcome: "Unreachable", status: 0 },
  fine: { outcome: "OK", status: 200 },
};

test("the broken view groups by outcome and leaves the healthy ones out", () => {
  const doc = page();
  render(doc, brokenTree(), "broken", { checks: CHECKS });
  assert.deepEqual(texts(doc, ".broken > .broken-title .name"), ["Not found", "Refused", "Error", "Unreachable"]);
  assert.deepEqual(Array.from(doc.querySelectorAll(".mark"), (m) => m.dataset.id), ["gone", "wall", "boom", "away"]);
});

test("each row in the broken view carries what the server answered", () => {
  const doc = page();
  render(doc, brokenTree(), "broken", { checks: CHECKS });
  assert.equal(doc.querySelector('.mark[data-id="gone"] .code').textContent, "404");
  assert.equal(doc.querySelector('.mark[data-id="away"] .code').textContent, "no answer");
});

test("the broken view counts the links it can check, not the bookmarks", () => {
  const doc = page();
  render(doc, brokenTree(), "broken", { checks: CHECKS });
  assert.equal(doc.querySelector("#hint").textContent, "5 links, 4 with a problem");
});

test("the broken view before any check is empty and says so", () => {
  const doc = page();
  render(doc, brokenTree(), "broken", { checks: {} });
  assert.equal(doc.querySelectorAll(".mark").length, 0);
  assert.equal(doc.querySelector("#hint").textContent, "5 links, none checked yet");
});

test("a view with nothing to show says why instead of going blank", () => {
  const doc = page();
  render(doc, brokenTree(), "broken", { checks: {} });
  assert.match(doc.querySelector("#sheet .empty").textContent, /not checked/i);

  render(doc, brokenTree(), "broken", { checks: { gone: { outcome: "OK", status: 200 } } });
  assert.match(doc.querySelector("#sheet .empty").textContent, /answered/i);

  render(doc, brokenTree(), "broken", { checks: CHECKS });
  assert.equal(doc.querySelector("#sheet .empty"), null);
});

test("an empty tree says so in every view", () => {
  const doc = page();
  const bare = folder("root________", undefined, 0, "", []);
  for (const view of ["folders", "sites"]) {
    render(doc, bare, view);
    assert.match(doc.querySelector("#sheet .empty").textContent, /no bookmarks/i, view);
  }
});

test("a site asked for on its own fills the sheet by itself", () => {
  const doc = page();
  render(doc, siteTree(), "sites", { only: "lwn.net" });
  assert.deepEqual(texts(doc, ".site > .site-title .name"), ["lwn.net"]);
  assert.equal(doc.querySelectorAll(".mark").length, 3);
  assert.equal(doc.querySelector("#hint").textContent, "3 bookmarks");
  assert.equal(doc.querySelector("#sheet").dataset.only, "lwn.net");
  render(doc, siteTree(), "sites");
  assert.equal("only" in doc.querySelector("#sheet").dataset, false);
});


test("a site that no longer has bookmarks leaves an empty sheet, not the whole list", () => {
  const doc = page();
  render(doc, siteTree(), "sites", { only: "nowhere.example" });
  assert.equal(doc.querySelectorAll(".site").length, 0);
  assert.equal(doc.querySelector(".empty").textContent, "No bookmarks here.");
});
