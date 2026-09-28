const test = require("node:test");
const assert = require("node:assert/strict");

require("../check.js");

const { classify, probeWith, checkAll, ORDER, OK } = globalThis.bmarksCheck;

test("classify separates a missing page from a wall and from a fault", () => {
  assert.equal(classify(404), "Not found");
  assert.equal(classify(410), "Not found");
  assert.equal(classify(401), "Refused");
  assert.equal(classify(403), "Refused");
  assert.equal(classify(429), "Refused");
  assert.equal(classify(500), "Error");
  assert.equal(classify(418), "Error");
  assert.equal(classify(200), OK);
  assert.equal(classify(301), OK);
});

test("ORDER names the outcomes worth showing, and not the good one", () => {
  assert.deepEqual(ORDER, ["Not found", "Refused", "Error", "Unreachable"]);
  assert.ok(!ORDER.includes(OK));
});

test("probe asks with HEAD and reports the outcome", async () => {
  const seen = [];
  const probe = probeWith(async (url, options) => {
    seen.push([url, options.method]);
    return { status: 404 };
  });
  assert.deepEqual(await probe("https://example.com/gone"), { outcome: "Not found", status: 404 });
  assert.deepEqual(seen, [["https://example.com/gone", "HEAD"]]);
});

test("probe falls back to GET for a server that refuses HEAD", async () => {
  const seen = [];
  const probe = probeWith(async (url, options) => {
    seen.push(options.method);
    return { status: options.method === "HEAD" ? 405 : 200 };
  });
  assert.deepEqual(await probe("https://example.com/"), { outcome: OK, status: 200 });
  assert.deepEqual(seen, ["HEAD", "GET"]);
});

test("a request that never lands is unreachable, not an error code", async () => {
  const probe = probeWith(async () => { throw new TypeError("NetworkError"); });
  assert.deepEqual(await probe("https://nowhere.invalid/"), { outcome: "Unreachable", status: 0 });
});

test("checkAll visits every item once and reports progress in order", async () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, url: `https://example.com/${i}` }));
  const progress = [];
  const results = await checkAll(items, async (url) => ({ outcome: OK, status: 200, url }), {
    concurrency: 3,
    onProgress: (done, total) => progress.push([done, total]),
  });
  assert.equal(results.size, 10);
  assert.equal(results.get("b7").url, "https://example.com/7");
  assert.deepEqual(progress.map(([done]) => done), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(progress[0], [1, 10]);
});

test("checkAll runs no more than the concurrency it is given at once", async () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ id: `b${i}`, url: `u${i}` }));
  let live = 0;
  let peak = 0;
  await checkAll(items, async () => {
    live += 1;
    peak = Math.max(peak, live);
    await new Promise((resolve) => setTimeout(resolve, 1));
    live -= 1;
    return { outcome: OK, status: 200 };
  }, { concurrency: 4 });
  assert.equal(peak, 4);
});

test("checkAll on nothing does nothing", async () => {
  const results = await checkAll([], async () => { throw new Error("must not ask"); }, { concurrency: 4 });
  assert.equal(results.size, 0);
});
