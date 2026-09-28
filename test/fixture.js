function mark(id, parentId, index, title, url) {
  return { id, parentId, index, title, url, type: "bookmark" };
}

function folder(id, parentId, index, title, children) {
  return { id, parentId, index, title, type: "folder", children };
}

function roots() {
  return [
    folder("root________", undefined, 0, "", [
      folder("toolbar_____", "root________", 0, "Bookmarks Toolbar", [
        mark("b1", "toolbar_____", 0, "GitHub", "https://www.github.com/"),
        mark("b2", "toolbar_____", 1, "homeserver", "http://homeserver/lgh/"),
      ]),
      folder("menu________", "root________", 1, "Bookmarks Menu", [
        folder("travel", "menu________", 0, "Travel", [
          mark("b3", "travel", 0, "EU261 compensation calculator", "https://www.airhelp.com/en/eu261"),
          folder("aegean", "travel", 1, "Aegean", [
            mark("b4", "aegean", 0, "Miles+Bonus tiers", "https://en.aegeanair.com/milesbonus/tiers"),
            mark("b5", "aegean", 1, "FlyerTalk status match thread", "https://www.flyertalk.com/forum/aegean"),
          ]),
          { id: "sep", parentId: "travel", index: 2, title: "", type: "separator" },
          mark("b6", "travel", 3, "Rome2rio: Athens to Santorini", "https://www.rome2rio.com/s/Athens/Santorini"),
        ]),
        mark("b7", "menu________", 1, "Recent tags", "place:type=6&sort=14&maxResults=10"),
      ]),
      folder("unfiled_____", "root________", 2, "Other Bookmarks", []),
      folder("mobile______", "root________", 3, "Mobile Bookmarks", []),
    ]),
  ];
}

module.exports = { roots, mark, folder };
