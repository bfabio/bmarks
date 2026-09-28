(function () {
  const NOT_FOUND = "Not found";
  const REFUSED = "Refused";
  const ERROR = "Error";
  const UNREACHABLE = "Unreachable";
  const OK = "OK";
  const ORDER = [NOT_FOUND, REFUSED, ERROR, UNREACHABLE];

  function classify(status) {
    if (status === 404 || status === 410) return NOT_FOUND;
    // A login wall or a bot block says nothing about the bookmark.
    if (status === 401 || status === 403 || status === 429) return REFUSED;
    if (status >= 400) return ERROR;
    return OK;
  }

  function probeWith(fetchImpl) {
    return async function probe(url) {
      const send = (method) => fetchImpl(url, { method, redirect: "follow", cache: "no-store" });
      try {
        let response = await send("HEAD");
        if (response.status === 405 || response.status === 501) response = await send("GET");
        return { outcome: classify(response.status), status: response.status };
      } catch {
        return { outcome: UNREACHABLE, status: 0 };
      }
    };
  }

  async function checkAll(items, probe, options = {}) {
    const { concurrency = 6, onProgress } = options;
    const results = new Map();
    let next = 0;
    let done = 0;

    async function worker() {
      while (next < items.length) {
        const item = items[next++];
        results.set(item.id, await probe(item.url));
        done += 1;
        if (onProgress) onProgress(done, items.length);
      }
    }

    const workers = Math.max(1, Math.min(concurrency, items.length));
    await Promise.all(Array.from({ length: workers }, worker));
    return results;
  }

  globalThis.bmarksCheck = { classify, probeWith, checkAll, ORDER, OK };
})();
