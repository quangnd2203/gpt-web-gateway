const { Router } = require('express');
const { getContext, saveSession, maybeHideWebdriverOnPage } = require('../browser');
const { resetPage } = require('../chatgpt');
const { VISIBLE_COMPOSER_SELECTOR } = require('../lib/composer-selectors');
const {
  ACCOUNT_STORAGE_KEY,
  accountStateSyncDecision,
  encodeAccountStorageValue,
  parseStoredAccount,
} = require('../lib/workspace-state');

const router = Router();

let loginPage = null;
let loginPagePromise = null;
let loginState = 'active'; // 'active' | 'saving' | 'saved'
let loginGeneration = 0;

function activateLoginFlow() {
  if (loginState === 'saving') return;
  loginState = 'active';
  loginGeneration++;
}

function loginPageUnavailable(res) {
  res.status(409).json({ error: 'Login session is being saved or has already been saved' });
  return true;
}

async function getLoginPage() {
  if (loginState !== 'active') return null;
  if (loginPage && !loginPage.isClosed()) return loginPage;
  if (loginPagePromise) return loginPagePromise;
  const generation = loginGeneration;
  const creation = (async () => {
    const ctx = await getContext();
    const page = await ctx.newPage();
    try {
      await maybeHideWebdriverOnPage(page);
      await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
      if (generation !== loginGeneration || loginState !== 'active') {
        await page.close().catch(() => {});
        return null;
      }
      loginPage = page;
      return page;
    } catch (err) {
      await page.close().catch(() => {});
      throw err;
    }
  })();
  loginPagePromise = creation;
  try {
    return await creation;
  } finally {
    if (loginPagePromise === creation) loginPagePromise = null;
  }
}

async function readAccountState(page) {
  const cookies = await page.context().cookies('https://chatgpt.com');
  const accountCookie = cookies.find((cookie) => cookie.name === ACCOUNT_STORAGE_KEY);
  if (!accountCookie || !accountCookie.value) return { cookieValue: null, storageValue: null };

  const storageValue = await page.evaluate((key) => localStorage.getItem(key), ACCOUNT_STORAGE_KEY);
  return { cookieValue: accountCookie.value, storageValue };
}

async function waitForStableComposer(page, { timeoutMs = 15000, settleMs = 750 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const composer = await page.$(VISIBLE_COMPOSER_SELECTOR).catch(() => null);
    if (composer) {
      await page.waitForTimeout(settleMs);
      const stillVisible = await page.$(VISIBLE_COMPOSER_SELECTOR)
        .catch(() => null);
      if (stillVisible) return true;
    }
    await page.waitForTimeout(250);
  }
  return false;
}

async function alignWorkspaceState(page) {
  const state = await readAccountState(page);
  const decision = accountStateSyncDecision(state);
  if (!state.cookieValue) {
    console.log('[workspace] no workspace cookie, keeping personal session');
    return;
  }
  if (!decision.needsSync) {
    console.log('[workspace] account state aligned');
    return;
  }

  const encoded = encodeAccountStorageValue(state.cookieValue, state.storageValue);
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: ACCOUNT_STORAGE_KEY,
    value: encoded,
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });

  if (!await waitForStableComposer(page)) {
    const err = new Error('ChatGPT composer did not remain visible after workspace sync');
    err.code = 'page_load_failed';
    throw err;
  }

  const finalState = await readAccountState(page);
  const finalDecision = accountStateSyncDecision(finalState);
  if (!finalState.cookieValue || finalDecision.needsSync) {
    const err = new Error('ChatGPT workspace state did not remain aligned after reload');
    err.code = 'page_load_failed';
    throw err;
  }
  console.log('[workspace] account state aligned');
}

// Remote login page
router.get('/login', (req, res) => {
  activateLoginFlow();
  res.send(`<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Remote Login - ChatGPT</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #1a1a2e; color: #eee; font-family: sans-serif; }
  .toolbar { padding: 10px; display: flex; gap: 10px; align-items: center; background: #16213e; }
  .toolbar button { padding: 8px 16px; background: #a78bfa; color: #000; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; }
  .toolbar button:hover { background: #8b5cf6; }
  .toolbar .status { margin-left: auto; font-size: 14px; color: #aaa; }
  #screen { cursor: crosshair; display: block; max-width: 100%; border: 1px solid #333; }
  .input-row { padding: 10px; background: #16213e; display: flex; gap: 10px; }
  .input-row input { flex: 1; padding: 8px 12px; background: #1a1a2e; border: 1px solid #333; border-radius: 6px; color: #eee; font-size: 14px; }
</style>
</head><body>
<div class="toolbar">
  <button onclick="refresh(true)">Refresh</button>
  <button onclick="navigate('https://chatgpt.com')">ChatGPT</button>
  <button id="save-session" onclick="saveSession()">Save Session</button>
  <span class="status" id="status">Click on the screenshot to interact</span>
</div>
<div class="input-row">
  <input type="text" id="type-input" placeholder="Type text and press Enter to input into focused field..." />
</div>
<img id="screen" src="/login/screenshot" onclick="handleClick(event)" />
<script>
  const screen = document.getElementById('screen');
  const status = document.getElementById('status');
  const typeInput = document.getElementById('type-input');
  const saveButton = document.getElementById('save-session');
  let refreshTimer = null;
  let refreshTimeout = null;
  let sessionSaved = false;

  function refresh(manual = false) {
    if (sessionSaved && !manual) return;
    if (manual && sessionSaved) {
      sessionSaved = false;
      saveButton.disabled = false;
      autoRefresh();
    }
    screen.src = '/login/screenshot?' + (manual ? 'manual=1&' : '') + Date.now();
    status.textContent = 'Refreshed';
  }

  function scheduleRefresh(delay) {
    if (refreshTimeout) clearTimeout(refreshTimeout);
    refreshTimeout = setTimeout(() => {
      refreshTimeout = null;
      refresh();
    }, delay);
  }

  function autoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    if (sessionSaved) return;
    refreshTimer = setInterval(refresh, 3000);
  }

  function stopRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    if (refreshTimeout) clearTimeout(refreshTimeout);
    refreshTimer = null;
    refreshTimeout = null;
  }

  async function handleClick(e) {
    const rect = screen.getBoundingClientRect();
    const scaleX = 1280 / rect.width;
    const scaleY = 800 / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    status.textContent = 'Clicking ' + x + ',' + y + '...';
    await fetch('/login/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y })
    });
    scheduleRefresh(500);
  }

  typeInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const text = typeInput.value;
      if (!text) return;
      status.textContent = 'Typing...';
      await fetch('/login/type', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      typeInput.value = '';
      scheduleRefresh(500);
    }
  });

  async function navigate(url) {
    status.textContent = 'Navigating...';
    await fetch('/login/navigate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    scheduleRefresh(2000);
  }

  async function saveSession() {
    saveButton.disabled = true;
    status.textContent = 'Saving session...';
    const res = await fetch('/login/save', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      saveButton.disabled = false;
      status.textContent = data.error || 'Could not save session';
      return;
    }
    sessionSaved = true;
    stopRefresh();
    status.textContent = data.message || 'Session saved!';
  }

  autoRefresh();
</script>
</body></html>`);
});

// Screenshot
router.get('/login/screenshot', async (req, res) => {
  try {
    if (req.query.manual === '1') activateLoginFlow();
    const p = await getLoginPage();
    if (!p) return loginPageUnavailable(res);
    const buffer = await p.screenshot({ type: 'jpeg', quality: 80 });
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'no-cache');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Click
router.post('/login/click', async (req, res) => {
  try {
    const { x, y } = req.body;
    const p = await getLoginPage();
    if (!p) return loginPageUnavailable(res);
    await p.mouse.click(x, y);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Type text
router.post('/login/type', async (req, res) => {
  try {
    const { text } = req.body;
    const p = await getLoginPage();
    if (!p) return loginPageUnavailable(res);
    await p.keyboard.type(text, { delay: 30 });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Press key
router.post('/login/key', async (req, res) => {
  try {
    const { key } = req.body;
    const p = await getLoginPage();
    if (!p) return loginPageUnavailable(res);
    await p.keyboard.press(key);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Navigate. The request body is deliberately IGNORED: the login flow only ever
// needs the ChatGPT landing page, and honoring a caller-supplied URL would let
// the API drive the authenticated browser to arbitrary hosts (SSRF / cookie
// exposure primitive) — an allowlist would still be bypassable via HTTP
// redirects, which page.goto() follows. In-page auth/SSO redirects after this
// initial load are unaffected.
const LOGIN_NAV_URL = 'https://chatgpt.com';

router.post('/login/navigate', async (req, res) => {
  try {
    activateLoginFlow();
    const p = await getLoginPage();
    if (!p) return loginPageUnavailable(res);
    await p.goto(LOGIN_NAV_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    res.json({ ok: true, url: LOGIN_NAV_URL });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save session
router.post('/login/save', async (req, res) => {
  try {
    if (loginState !== 'active') return loginPageUnavailable(res);
    const p = loginPage && !loginPage.isClosed() ? loginPage : await getLoginPage();
    if (!p) return loginPageUnavailable(res);
    loginState = 'saving';
    loginGeneration++;
    await alignWorkspaceState(p);
    await saveSession();
    loginState = 'saved';
    // Close login page
    if (loginPage && !loginPage.isClosed()) {
      await loginPage.close();
      loginPage = null;
    }
    // Reset main chatgpt page so it reloads with new session
    resetPage();
    res.json({ message: 'Session saved! Main page reset. You can now use the API.' });
  } catch (err) {
    if (loginState === 'saving') {
      loginState = 'active';
      loginGeneration++;
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports._test = {
  accountStateSyncDecision,
  alignWorkspaceState,
  encodeAccountStorageValue,
  parseStoredAccount,
};
