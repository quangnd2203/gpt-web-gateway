const assert = require('assert');
const router = require('../src/routes/login');

const layer = router.stack.find((entry) => entry.route && entry.route.path === '/login');
assert.ok(layer, 'GET /login route not found');

let html = '';
layer.route.stack[0].handle({}, { send: (body) => { html = body; } });

assert.ok(html.includes('onclick="refresh(true)"'), 'manual Refresh must be distinguishable');
assert.ok(html.includes('if (sessionSaved && !manual) return;'), 'saved session must stop polling refreshes');
assert.ok(html.includes("manual ? 'manual=1&' : ''"), 'manual refresh must reopen the server-side flow');
const savedAt = html.indexOf('sessionSaved = true;');
const stoppedAt = html.indexOf('stopRefresh();', savedAt);
assert.ok(savedAt >= 0 && stoppedAt > savedAt, 'successful save must clear auto-refresh');

console.log('PASS: /login HTML stops refresh polling after a successful save');

function fakePage({ cookieValue, storageValue }) {
  let currentStorage = storageValue;
  let writes = 0;
  let reloads = 0;
  return {
    context: () => ({ cookies: async () => cookieValue ? [{ name: '_account', value: cookieValue }] : [] }),
    evaluate: async (fn, arg) => {
      if (typeof arg === 'string') return currentStorage;
      currentStorage = arg.value;
      writes++;
    },
    reload: async () => { reloads++; },
    $: async () => ({}),
    waitForTimeout: async () => {},
    get state() { return { currentStorage, writes, reloads }; },
  };
}

(async () => {
  const mismatch = fakePage({
    cookieValue: 'workspace-account',
    storageValue: JSON.stringify('personal'),
  });
  await router._test.alignWorkspaceState(mismatch);
  assert.strictEqual(mismatch.state.currentStorage, JSON.stringify('workspace-account'));
  assert.strictEqual(mismatch.state.writes, 1);
  assert.strictEqual(mismatch.state.reloads, 1);

  const personal = fakePage({ cookieValue: null, storageValue: JSON.stringify('personal') });
  await router._test.alignWorkspaceState(personal);
  assert.strictEqual(personal.state.writes, 0);
  assert.strictEqual(personal.state.reloads, 0);

  console.log('PASS: workspace route syncs mismatch, reloads once, and preserves personal flow');
})().catch((error) => {
  console.error('FAIL:', error);
  process.exitCode = 1;
});
