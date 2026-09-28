(function () {
  const LINK_SCHEMES = new Set(["http:", "https:", "file:", "ftp:"]);
  // Firefox refuses to move or remove these, and always reports their
  // localized title, so a rename would not show either.
  const PLACES_ROOT = "root________";
  const ROOTS = new Set([PLACES_ROOT, "menu________", "toolbar_____", "unfiled_____", "mobile______", "tags________"]);

  function isRoot(id) {
    return ROOTS.has(id);
  }

  function indexTree(roots) {
    const byId = new Map();
    const walk = (node) => {
      byId.set(node.id, node);
      for (const child of node.children || []) walk(child);
    };
    for (const root of roots) walk(root);
    return byId;
  }

  function countMarks(node) {
    if (node.type === "bookmark") return 1;
    let n = 0;
    for (const child of node.children || []) n += countMarks(child);
    return n;
  }

  function countFolders(node) {
    let n = 0;
    for (const child of node.children || []) {
      if (child.type === "folder") n += 1 + countFolders(child);
    }
    return n;
  }

  function parse(url) {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  }

  function isLink(url) {
    const parsed = parse(url);
    return Boolean(parsed && LINK_SCHEMES.has(parsed.protocol));
  }

  function isCheckable(url) {
    return /^https?:/i.test(url);
  }

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
  }

  function host(url) {
    const parsed = parse(url);
    if (!parsed) return "";
    if (!LINK_SCHEMES.has(parsed.protocol) || !parsed.hostname) return parsed.protocol;
    return parsed.hostname.replace(/^www\./, "");
  }

  function collectMarks(node, into) {
    if (node.type === "bookmark") into.push(node);
    for (const child of node.children || []) collectMarks(child, into);
    return into;
  }

  function groupBySite(root) {
    const byHost = new Map();
    for (const node of collectMarks(root, [])) {
      const key = host(node.url) || "other";
      if (!byHost.has(key)) byHost.set(key, []);
      byHost.get(key).push(node);
    }
    const groups = Array.from(byHost, ([hostName, marks]) => ({ host: hostName, marks }));
    for (const group of groups) {
      group.marks.sort((a, b) => (a.title || a.url).localeCompare(b.title || b.url));
    }
    // By host, never by size: a group that loses a bookmark would
    // otherwise jump past every smaller one and read as deleted.
    groups.sort((a, b) => a.host.localeCompare(b.host));
    return groups;
  }

  function dropZone(rect, y, isFolder) {
    const rel = y - rect.top;
    if (isFolder) {
      if (rel < rect.height / 3) return "before";
      if (rel < (rect.height * 2) / 3) return "into";
      return "after";
    }
    return rel < rect.height / 2 ? "before" : "after";
  }

  function isInside(byId, ancestorId, id) {
    for (let node = byId.get(id); node; node = byId.get(node.parentId)) {
      if (node.id === ancestorId) return true;
    }
    return false;
  }

  function dropPlan(byId, draggedId, targetId, zone) {
    const dragged = byId.get(draggedId);
    const target = byId.get(targetId);
    if (!dragged || !target || draggedId === targetId || isRoot(draggedId)) return null;
    let parentId;
    let index;
    if (zone === "into") {
      if (target.type !== "folder") return null;
      parentId = target.id;
      index = target.children.length;
    } else {
      parentId = target.parentId;
      index = target.index + (zone === "after" ? 1 : 0);
    }
    if (parentId === PLACES_ROOT || isInside(byId, draggedId, parentId)) return null;
    if (dragged.parentId === parentId) {
      if (dragged.index < index) index -= 1;
      if (index === dragged.index) return null;
    }
    return { parentId, index };
  }

  function el(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function tooltip(node) {
    const name = node.title || node.url;
    return node.url && node.url !== name ? `${name}\n${node.url}` : name;
  }

  function renderMark(doc, node, draggable, badge) {
    const linkable = isLink(node.url);
    const row = el(doc, linkable ? "a" : "span", "mark");
    row.dataset.id = node.id;
    row.dataset.type = "bookmark";
    if (linkable) row.href = node.url;
    // Links are draggable by default.
    row.setAttribute("draggable", draggable ? "true" : "false");
    // The menu and the Delete key act on the focused row.
    if (!linkable) row.tabIndex = -1;
    row.title = tooltip(node);
    if (badge) row.appendChild(el(doc, "span", "code", badge));
    row.appendChild(el(doc, "span", "name", node.title || node.url));
    row.appendChild(el(doc, "span", "host", host(node.url)));
    return row;
  }

  function renderSeparator(doc, node) {
    const row = el(doc, "div", "separator");
    row.dataset.id = node.id;
    row.dataset.type = "separator";
    row.setAttribute("draggable", "true");
    return row;
  }

  function renderFolder(doc, node, top) {
    const section = el(doc, "section", top ? "folder top" : "folder");
    section.dataset.id = node.id;
    const title = el(doc, top ? "h2" : "h3", "folder-title");
    title.dataset.id = node.id;
    title.dataset.type = "folder";
    if (!top) title.setAttribute("draggable", "true");
    title.tabIndex = -1;
    title.title = node.title;
    title.appendChild(el(doc, "span", "ico"));
    title.appendChild(el(doc, "span", "name", node.title));
    title.appendChild(el(doc, "span", "count", String(countMarks(node))));
    section.appendChild(title);
    const items = el(doc, "div", "items");
    for (const child of node.children) items.appendChild(renderNode(doc, child, false));
    section.appendChild(items);
    return section;
  }

  function renderNode(doc, node, top) {
    if (node.type === "folder") return renderFolder(doc, node, top);
    if (node.type === "separator") return renderSeparator(doc, node);
    return renderMark(doc, node, true);
  }

  function renderGroup(doc, group, kind) {
    const section = el(doc, "section", kind.section);
    section.dataset[kind.data] = group.key;
    const title = el(doc, "h2", kind.title);
    title.tabIndex = -1;
    title.title = group.key;
    title.appendChild(el(doc, "span", kind.marker));
    title.appendChild(el(doc, "span", "name", group.key));
    title.appendChild(el(doc, "span", "count", String(group.marks.length)));
    section.appendChild(title);
    const items = el(doc, "div", "items");
    for (const node of group.marks) items.appendChild(renderMark(doc, node, false, group.badge && group.badge(node)));
    section.appendChild(items);
    return section;
  }

  const SITE_KIND = { section: "site", data: "host", title: "site-title", marker: "globe" };
  const BROKEN_KIND = { section: "broken", data: "outcome", title: "broken-title", marker: "warn" };

  function findFolder(node, id) {
    if (node.id === id) return node.type === "folder" ? node : null;
    for (const child of node.children || []) {
      const found = findFolder(child, id);
      if (found) return found;
    }
    return null;
  }

  function renderFolders(doc, root, sheet, opts = {}) {
    if (opts.only) {
      const node = findFolder(root, opts.only);
      if (!node) return plural(0, "bookmark");
      sheet.appendChild(renderFolder(doc, node, true));
      return `${plural(countMarks(node), "bookmark")}, ${plural(countFolders(node), "folder")}`;
    }
    let folders = 0;
    for (const child of root.children) {
      if (child.type !== "folder" || !child.children.length) continue;
      sheet.appendChild(renderFolder(doc, child, true));
      folders += 1 + countFolders(child);
    }
    return `${plural(countMarks(root), "bookmark")}, ${plural(folders, "folder")}`;
  }

  function renderFlat(doc, sheet, groups, kind, opts) {
    const only = opts.only ? groups.filter((group) => group.key === opts.only) : groups;
    for (const group of only) sheet.appendChild(renderGroup(doc, group, kind));
    return only;
  }

  function renderSites(doc, root, sheet, opts = {}) {
    const groups = groupBySite(root).map((group) => ({ key: group.host, marks: group.marks }));
    const shown = renderFlat(doc, sheet, groups, SITE_KIND, opts);
    if (opts.only) return plural(marksIn(shown), "bookmark");
    return `${plural(countMarks(root), "bookmark")}, ${plural(groups.length, "site")}`;
  }

  function marksIn(groups) {
    return groups.reduce((total, group) => total + group.marks.length, 0);
  }

  function renderBroken(doc, root, sheet, opts) {
    const checks = opts.checks || {};
    const { OK, ORDER } = globalThis.bmarksCheck;
    const links = collectMarks(root, []).filter((node) => isCheckable(node.url));
    const byOutcome = new Map(ORDER.map((outcome) => [outcome, []]));
    let checked = 0;
    for (const node of links) {
      const result = checks[node.id];
      if (!result) continue;
      checked += 1;
      if (result.outcome !== OK) byOutcome.get(result.outcome)?.push(node);
    }
    const badge = (node) => (checks[node.id].status ? String(checks[node.id].status) : "no answer");
    const groups = ORDER.filter((outcome) => byOutcome.get(outcome).length)
      .map((outcome) => ({ key: outcome, marks: byOutcome.get(outcome), badge }));
    const problems = marksIn(renderFlat(doc, sheet, groups, BROKEN_KIND, opts));
    if (opts.only) return plural(problems, "link");
    if (!problems) {
      sheet.appendChild(
        el(doc, "p", "empty", checked ? "Every link answered." : "These links are not checked yet.")
      );
    }
    const tail = checked ? `${problems} with a problem` : "none checked yet";
    return `${plural(links.length, "link")}, ${tail}`;
  }

  const FLAT = { sites: renderSites, broken: renderBroken };

  function render(doc, root, view, opts = {}) {
    const sheet = doc.querySelector("#sheet");
    sheet.replaceChildren();
    const flat = FLAT[view];
    sheet.dataset.view = flat ? view : "folders";
    if (opts.only) sheet.dataset.only = opts.only;
    else delete sheet.dataset.only;
    doc.querySelector("#hint").textContent = flat
      ? flat(doc, root, sheet, opts)
      : renderFolders(doc, root, sheet, opts);
    if (!sheet.children.length) sheet.appendChild(el(doc, "p", "empty", "No bookmarks here."));
  }

  globalThis.bmarksTree = { indexTree, countMarks, host, isRoot, isCheckable, plural, groupBySite, dropZone, dropPlan, render };
})();
