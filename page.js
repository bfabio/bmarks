(function () {
  const tree = globalThis.bmarksTree;
  if (!tree) return;
  const REFRESH_MS = 50;
  const EVENTS = ["onCreated", "onRemoved", "onChanged", "onMoved"];
  const VIEWS = ["folders", "sites", "broken"];
  const DENSITIES = ["roomy", "default", "compact"];
  const CHECK_CONCURRENCY = 6;
  const DEFAULT_VIEW = "folders";
  const ZONE_CLASS = { before: "drop-before", after: "drop-after", into: "drop-into" };

  function install(doc, api, fetchImpl) {
    const win = doc.defaultView;
    const checker = globalThis.bmarksCheck;
    const send = fetchImpl || ((...args) => win.fetch(...args));
    const check = doc.querySelector("#check");
    const checkRun = doc.querySelector("#check-run");
    const checkNote = doc.querySelector("#check-note");
    const menu = doc.querySelector("#menu");
    const menuTitle = doc.querySelector("#menu-title");
    const status = doc.querySelector("#status");
    const statusText = doc.querySelector("#status-text");
    const undo = doc.querySelector("#undo");
    const dismiss = doc.querySelector("#dismiss");
    const trash = doc.querySelector("#trash");
    const views = doc.querySelector("#views");
    const density = doc.querySelector("#density");
    const busy = doc.querySelector("#busy");
    const back = doc.querySelector("#back");
    const backName = doc.querySelector("#back-name");
    const hostToggle = doc.querySelector("#toggle-host");
    const sheet = doc.querySelector("#sheet");
    const state = {
      byId: new Map(),
      view: DEFAULT_VIEW,
      only: null,
      from: null,
      host: "shown",
      density: "default",
      checks: {},
      running: null,
      undo: null,
      dragging: null,
      plan: null,
      marked: null,
      target: null,
    };
    let timer = null;

    async function refresh() {
      const roots = await api.bookmarks.getTree();
      state.byId = tree.indexTree(roots);
      tree.render(doc, roots[0], state.view, { checks: state.checks, only: state.only });
      markCheck();
    }

    function summary() {
      const results = Object.entries(state.checks)
        .filter(([id]) => state.byId.has(id))
        .map(([, result]) => result);
      if (!results.length) return "Nothing checked yet.";
      const problems = results.filter((result) => result.outcome !== checker.OK).length;
      return `${problems} with a problem, ${results.length - problems} answered fine.`;
    }

    function markCheck() {
      check.hidden = state.view !== "broken" || Boolean(state.only);
      checkNote.textContent = state.running
        ? `Checking ${state.running.done} of ${state.running.total}...`
        : summary();
      checkRun.disabled = Boolean(state.running);
    }

    async function runCheck() {
      const links = [];
      for (const node of state.byId.values()) {
        if (node.type === "bookmark" && tree.isCheckable(node.url)) links.push({ id: node.id, url: node.url });
      }
      state.running = { done: 0, total: links.length };
      markCheck();
      const results = await checker.checkAll(links, checker.probeWith(send), {
        concurrency: CHECK_CONCURRENCY,
        onProgress: (done, total) => {
          state.running = { done, total };
          markCheck();
        },
      });
      state.running = null;
      const at = Date.now();
      for (const [id, result] of results) state.checks[id] = { ...result, at };
      await refresh();
      await api.storage.local.set({ checks: state.checks });
    }

    checkRun.addEventListener("click", () => {
      if (Object.keys(state.checks).length &&
          !win.confirm("Check every link again? The current results will be cleared.")) return;
      // request() counts as user initiated only before the first await.
      const granted = api.permissions.request({ origins: ["<all_urls>"] });
      run(async () => {
        if (!(await granted)) throw new Error("Checking links needs permission to reach the sites.");
        state.checks = {};
        await runCheck();
      });
    });

    const ALL = { folders: "All folders", sites: "All sites", broken: "All links" };

    function markBack() {
      back.hidden = !state.only;
      const from = state.from && state.byId.get(state.from);
      backName.textContent = from ? from.title : ALL[state.view];
    }

    function openGroup(key) {
      // Saving the scroll position lets Back return to the clicked group.
      const from = state.only;
      win.history.replaceState({ only: from, from: state.from, scroll: win.scrollY }, "");
      win.history.pushState({ only: key, from, scroll: 0 }, "");
      state.only = key;
      state.from = from;
      markBack();
      reload(() => win.scrollTo(0, 0));
    }

    function closeGroup() {
      if (state.only) win.history.back();
    }

    win.addEventListener("popstate", (e) => {
      const to = e.state || { only: null, scroll: 0 };
      state.only = to.only || null;
      state.from = to.from || null;
      markBack();
      reload(() => win.scrollTo(0, to.scroll || 0));
    });

    back.addEventListener("click", closeGroup);

    function groupKeyOf(title) {
      const section = title.parentElement;
      return section.dataset.host || section.dataset.outcome || null;
    }

    function markViews() {
      for (const button of views.querySelectorAll("button")) {
        button.setAttribute("aria-selected", String(button.dataset.view === state.view));
      }
    }

    async function stored(key, allowed, fallback) {
      try {
        const answer = await api.storage.local.get(key);
        return allowed.includes(answer[key]) ? answer[key] : fallback;
      } catch {
        return fallback;
      }
    }

    async function storedChecks() {
      try {
        const answer = await api.storage.local.get("checks");
        return answer.checks && typeof answer.checks === "object" ? answer.checks : {};
      } catch {
        return {};
      }
    }

    function markHost() {
      const shown = state.host === "shown";
      sheet.dataset.host = state.host;
      hostToggle.setAttribute("aria-pressed", String(shown));
      hostToggle.title = shown ? "Hide the domain of each bookmark" : "Show the domain of each bookmark";
    }

    function markDensity() {
      sheet.dataset.density = state.density;
      for (const button of density.querySelectorAll("button")) {
        button.setAttribute("aria-pressed", String(button.dataset.density === state.density));
      }
    }

    density.addEventListener("click", (e) => {
      const button = e.target.closest("button");
      if (!button || button.dataset.density === state.density) return;
      state.density = button.dataset.density;
      markDensity();
      run(() => api.storage.local.set({ density: state.density }));
    });

    hostToggle.addEventListener("click", () => {
      state.host = state.host === "shown" ? "hidden" : "shown";
      markHost();
      run(() => api.storage.local.set({ host: state.host }));
    });

    views.addEventListener("click", (e) => {
      const button = e.target.closest("button");
      if (!button || button.dataset.view === state.view) return;
      state.view = button.dataset.view;
      state.only = null;
      win.history.replaceState({ only: null, scroll: 0 }, "");
      markBack();
      markViews();
      markCheck();
      reload();
      run(() => api.storage.local.set({ view: state.view }));
    });

    function markBusy(working) {
      busy.hidden = !working;
      sheet.setAttribute("aria-busy", String(working));
    }

    // A big collection blocks the page while it renders: paint the busy
    // mark first so the click does not look ignored.
    function reload(after) {
      markBusy(true);
      run(async () => {
        try {
          await new Promise((paint) => {
            // Unbound, Firefox refuses the call as made on the wrong object.
            if (win.requestAnimationFrame) win.requestAnimationFrame(paint);
            else win.setTimeout(paint, 0);
          });
          await refresh();
          if (after) after();
        } finally {
          markBusy(false);
        }
      });
    }

    function report(error) {
      statusText.textContent = error ? error.message : "";
      status.dataset.kind = "error";
      status.hidden = !error;
      undo.hidden = true;
      state.undo = null;
    }

    function notify(text, put) {
      statusText.textContent = text;
      status.dataset.kind = "notice";
      status.hidden = false;
      state.undo = put;
      undo.hidden = false;
    }

    undo.addEventListener("click", () => {
      const put = state.undo;
      if (!put) return;
      undo.hidden = true;
      status.hidden = true;
      state.undo = null;
      run(async () => {
        await api.bookmarks.create(put);
        await refresh();
      });
    });

    dismiss.addEventListener("click", () => report(null));

    function hideTrash() {
      trash.hidden = true;
      delete trash.dataset.for;
    }

    function showTrash(row) {
      const box = row.getBoundingClientRect();
      trash.dataset.for = row.dataset.id;
      trash.hidden = false;
      trash.style.left = `${Math.max(0, box.right - trash.offsetWidth - 2)}px`;
      trash.style.top = `${box.top + (box.height - trash.offsetHeight) / 2}px`;
    }

    doc.addEventListener("mouseover", (e) => {
      if (e.target.closest && e.target.closest("#trash")) return;
      const row = rowOf(e.target);
      if (row && row.dataset.type === "bookmark" && !editing(row)) showTrash(row);
      else hideTrash();
    });

    trash.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const node = state.byId.get(trash.dataset.for);
      hideTrash();
      if (node) run(() => remove(node));
    });

    async function run(work) {
      try {
        await work();
        if (!state.undo) report(null);
      } catch (error) {
        report(error);
      }
    }

    function scheduleRefresh() {
      clearTimeout(timer);
      timer = setTimeout(refresh, REFRESH_MS);
    }

    function rowOf(el) {
      return el && el.closest ? el.closest("[data-id][data-type]") : null;
    }

    function editing(row) {
      return Boolean(row.querySelector("input"));
    }

    function clearMark() {
      if (state.marked) state.marked.classList.remove(...Object.values(ZONE_CLASS));
      state.marked = null;
      state.plan = null;
    }

    function endDrag() {
      clearMark();
      for (const el of doc.querySelectorAll(".dragging")) el.classList.remove("dragging");
      state.dragging = null;
    }

    doc.addEventListener("dragstart", (e) => {
      const row = rowOf(e.target);
      if (!row || editing(row)) return;
      state.dragging = row.dataset.id;
      row.classList.add("dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", row.dataset.id);
      }
    });

    doc.addEventListener("dragover", (e) => {
      if (!state.dragging) return;
      clearMark();
      const row = rowOf(e.target);
      if (!row) return;
      const zone = tree.dropZone(row.getBoundingClientRect(), e.clientY, row.dataset.type === "folder");
      const plan = tree.dropPlan(state.byId, state.dragging, row.dataset.id, zone);
      if (!plan) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      row.classList.add(ZONE_CLASS[zone]);
      state.marked = row;
      state.plan = plan;
    });

    doc.addEventListener("drop", (e) => {
      const { dragging, plan } = state;
      if (!plan) return;
      e.preventDefault();
      endDrag();
      run(async () => {
        await api.bookmarks.move(dragging, plan);
        await refresh();
      });
    });

    doc.addEventListener("dragend", endDrag);

    // Gecko drops :focus while the window is inactive, and the point of
    // this mark is to survive a glance away, so it is a class.
    function focusRow(row) {
      for (const marked of doc.querySelectorAll(".focused")) marked.classList.remove("focused");
      row.classList.add("focused");
      row.focus();
    }

    function clearTarget() {
      for (const marked of doc.querySelectorAll(".targeted")) marked.classList.remove("targeted");
    }

    function openMenu(row, x, y) {
      clearTarget();
      state.target = row;
      row.classList.add("targeted");
      const node = state.byId.get(row.dataset.id);
      menuTitle.textContent = node ? node.title || node.url : "";
      const root = tree.isRoot(row.dataset.id);
      for (const button of menu.querySelectorAll("button")) {
        const wrongType = Boolean(button.dataset.for) && button.dataset.for !== row.dataset.type;
        button.hidden = wrongType || (root && button.hasAttribute("data-skip-root"));
      }
      placeMenu(x, y);
    }

    function openGroupMenu(title, x, y) {
      clearTarget();
      state.target = title;
      title.classList.add("targeted");
      menuTitle.textContent = groupKeyOf(title);
      for (const button of menu.querySelectorAll("button")) button.hidden = button.dataset.action !== "delete";
      placeMenu(x, y);
    }

    function placeMenu(x, y) {
      menu.hidden = false;
      menu.style.left = Math.max(0, Math.min(x, win.innerWidth - menu.offsetWidth - 8)) + "px";
      menu.style.top = Math.max(0, Math.min(y, win.innerHeight - menu.offsetHeight - 8)) + "px";
    }

    function closeMenu(keepTarget) {
      menu.hidden = true;
      if (!keepTarget) clearTarget();
      state.target = null;
    }

    doc.addEventListener("contextmenu", (e) => {
      const group = e.target.closest && e.target.closest(".site-title, .broken-title");
      if (group) {
        e.preventDefault();
        openGroupMenu(group, e.clientX, e.clientY);
        return;
      }
      const row = rowOf(e.target);
      if (!row || row.dataset.type === "separator" || editing(row)) return;
      e.preventDefault();
      focusRow(row);
      openMenu(row, e.clientX, e.clientY);
    });

    menu.addEventListener("click", (e) => {
      const button = e.target.closest("button");
      const row = state.target;
      if (!button || !row) return;
      // Keep the row marked while a confirm dialog asks about it.
      closeMenu(true);
      run(async () => {
        try {
          await act(button.dataset.action, row);
        } finally {
          clearTarget();
        }
      });
    });

    doc.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const title = e.target.closest && e.target.closest(".site-title, .broken-title");
      if (title && !state.only) {
        const key = groupKeyOf(title);
        if (key) return openGroup(key);
      }
      const folder = e.target.closest && e.target.closest(".folder-title");
      if (folder && state.view === "folders" && !editing(folder)) {
        if (folder.dataset.id !== state.only) return openGroup(folder.dataset.id);
        return;
      }
      const row = rowOf(e.target);
      if (!row || editing(row)) return;
      focusRow(row);
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      if (row.dataset.type !== "bookmark") return;
      const node = state.byId.get(row.dataset.id);
      if (!node || !row.hasAttribute("href")) return;
      e.preventDefault();
      run(() => api.tabs.create({ url: node.url, active: false }));
    });

    doc.addEventListener("mousedown", (e) => {
      if (!menu.hidden && !menu.contains(e.target)) closeMenu(false);
    });

    doc.addEventListener("scroll", () => {
      closeMenu(false);
      hideTrash();
    }, true);

    doc.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!menu.hidden) return closeMenu(false);
        if (state.only) return closeGroup();
        return;
      }
      if (e.key !== "Delete" || e.target.tagName === "INPUT") return;
      const row = rowOf(doc.activeElement);
      if (row && row.dataset.type === "bookmark") run(() => remove(state.byId.get(row.dataset.id)));
    });

    async function act(action, row) {
      if (row.matches(".site-title, .broken-title")) {
        if (action === "delete") await removeGroup(row);
        return;
      }
      const node = state.byId.get(row.dataset.id);
      if (!node) return;
      if (action === "open-tab") await api.tabs.create({ url: node.url });
      if (action === "copy") await win.navigator.clipboard.writeText(node.url);
      if (action === "rename") rename(row);
      if (action === "delete") await remove(node);
      if (action === "new-folder") {
        const created = await api.bookmarks.create({ parentId: node.id, title: "New folder" });
        await refresh();
        const title = doc.querySelector(`.folder[data-id="${created.id}"] > .folder-title`);
        if (title) rename(title);
      }
    }

    async function remove(node) {
      if (node.type === "folder") {
        const inside = tree.plural(tree.countMarks(node), "bookmark");
        const question = `Delete "${node.title}" with everything inside (${inside})?`;
        if (node.children.length && !win.confirm(question)) return;
        await api.bookmarks.removeTree(node.id);
        await refresh();
        return;
      }
      // Undo recreates the bookmark at its old index.
      const put = { parentId: node.parentId, index: node.index, title: node.title, url: node.url };
      // Rows go at once. If the removal fails, the refresh restores them.
      dropRows(node.id);
      notify(`Deleted ${node.title || node.url}`, put);
      try {
        await api.bookmarks.remove(node.id);
      } finally {
        await refresh();
      }
    }

    async function removeGroup(title) {
      const key = groupKeyOf(title);
      const ids = [...new Set(Array.from(title.parentElement.querySelectorAll(".mark[data-id]"), (row) => row.dataset.id))];
      if (!ids.length || !win.confirm(`Delete ${tree.plural(ids.length, "bookmark")} in "${key}"?`)) return;
      for (const id of ids) await api.bookmarks.remove(id);
      if (state.only === key) closeGroup();
      else await refresh();
    }

    function dropRows(id) {
      for (const row of doc.querySelectorAll(`.mark[data-id="${id}"]`)) row.remove();
    }

    function rename(row) {
      const name = row.querySelector(":scope > .name");
      const node = state.byId.get(row.dataset.id);
      if (!name || !node || editing(row)) return;
      const draggable = row.getAttribute("draggable");
      const tooltip = row.getAttribute("title");
      const input = doc.createElement("input");
      input.className = "rename";
      input.value = node.title;
      const finish = async (save) => {
        if (!input.isConnected) return;
        const title = input.value.trim();
        input.remove();
        name.hidden = false;
        if (draggable) row.setAttribute("draggable", draggable);
        if (tooltip !== null) row.setAttribute("title", tooltip);
        if (save && title && title !== node.title) {
          await run(async () => {
            await api.bookmarks.update(node.id, { title });
            await refresh();
          });
        }
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        }
      });
      input.addEventListener("blur", () => finish(false));
      // The row may be a link: a click inside the field must not follow it.
      input.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      row.removeAttribute("draggable");
      row.removeAttribute("title");
      name.hidden = true;
      row.insertBefore(input, name);
      input.focus();
      input.select();
    }

    for (const name of EVENTS) api.bookmarks[name].addListener(scheduleRefresh);

    const ready = (async () => {
      if (win.history.scrollRestoration) win.history.scrollRestoration = "manual";
      markBusy(true);
      state.view = await stored("view", VIEWS, DEFAULT_VIEW);
      state.host = await stored("host", ["shown", "hidden"], "shown");
      state.density = await stored("density", DENSITIES, "default");
      state.checks = await storedChecks();
      markViews();
      markHost();
      markDensity();
      try {
        await refresh();
      } finally {
        markBusy(false);
      }
    })();

    return { ready, refresh };
  }

  globalThis.bmarksPage = { install };

  if (typeof document !== "undefined" && globalThis.browser && globalThis.browser.bookmarks) {
    install(document, globalThis.browser);
  }
})();
