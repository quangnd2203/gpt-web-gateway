const assert = require('assert');
const { accountStateSyncDecision, encodeAccountStorageValue } = require('../src/lib/workspace-state');
const { COMPOSER_SELECTOR, VISIBLE_COMPOSER_SELECTOR } = require('../src/lib/composer-selectors');
const { _test } = require('../src/chatgpt');

let passed = 0;
function ok(name, fn) {
  fn();
  console.log(`PASS: ${name}`);
  passed++;
}
async function okAsync(name, fn) {
  await fn();
  console.log(`PASS: ${name}`);
  passed++;
}

// ---------------------------------------------------------------- workspace state

ok('no account cookie keeps the personal session unchanged', () => {
  const decision = accountStateSyncDecision({ cookieValue: null, storageValue: JSON.stringify('personal') });
  assert.deepStrictEqual(decision, {
    needsSync: false,
    reason: 'no-workspace-cookie',
    format: null,
  });
});

ok('matching JSON-string storage needs no mutation', () => {
  const cookieValue = 'workspace-account';
  const storageValue = JSON.stringify(cookieValue);
  const decision = accountStateSyncDecision({ cookieValue, storageValue });
  assert.strictEqual(decision.needsSync, false);
  assert.strictEqual(decision.format, 'json-string');
  assert.strictEqual(encodeAccountStorageValue(cookieValue, storageValue), storageValue);
});

ok('mismatched personal storage needs sync in the observed JSON-string format', () => {
  const cookieValue = 'workspace-account';
  const storageValue = JSON.stringify('personal');
  const decision = accountStateSyncDecision({ cookieValue, storageValue });
  assert.strictEqual(decision.needsSync, true);
  assert.strictEqual(decision.reason, 'mismatched-storage');
  assert.strictEqual(encodeAccountStorageValue(cookieValue, storageValue), JSON.stringify(cookieValue));
});

ok('unknown storage format is rejected instead of being guessed', () => {
  const cookieValue = 'workspace-account';
  const storageValue = 'personal';
  const decision = accountStateSyncDecision({ cookieValue, storageValue });
  assert.strictEqual(decision.needsSync, true);
  assert.strictEqual(decision.format, 'unknown');
  assert.throws(
    () => encodeAccountStorageValue(cookieValue, storageValue),
    /Unsupported ChatGPT _account localStorage format/,
  );
});

// ---------------------------------------------------------------- Chat/Work decision

const modeCases = [
  [{ present: false, chatActive: false, workActive: true }, false, 'absent switcher'],
  [{ present: true, chatActive: true, workActive: false }, false, 'Chat already active'],
  [{ present: true, chatActive: false, workActive: false }, false, 'ambiguous active marker'],
  [{ present: true, chatActive: false, workActive: true }, true, 'Work active'],
];
for (const [input, expected, label] of modeCases) {
  ok(`shouldForceChatMode: ${label}`, () => {
    assert.strictEqual(_test.shouldForceChatMode(input), expected);
  });
}

// ---------------------------------------------------------------- composer fail-fast

ok('composer selectors cover the current home input and visible variants', () => {
assert.match(COMPOSER_SELECTOR, /#pending-home-input/);
assert.match(COMPOSER_SELECTOR, /contenteditable="true"\]\[role="textbox"/);
assert.match(VISIBLE_COMPOSER_SELECTOR, /#pending-home-input:visible/);
});

ok('Edu upload selector prefers accessible photo inputs over generated ids', () => {
  assert.match(_test.fileInputSelector, /aria-label="Attach photos"/);
  assert.match(_test.fileInputSelector, /aria-label="Attach photos or videos"/);
  assert.match(_test.fileInputSelector, /input\[type="file"\]/);
});

ok('current thinking slider trigger is included without removing legacy paths', () => {
  assert.strictEqual(_test.intelligencePillSelector, '[aria-label*="Select ChatGPT model" i]');
  assert.match(_test.intelligencePillSelector, /Select ChatGPT model/);
});

ok('Edu contenteditable composers use keyboard input', () => {
  assert.strictEqual(_test.shouldUseKeyboardComposerInput({ contentEditable: true }), true);
  assert.strictEqual(_test.shouldUseKeyboardComposerInput({ contentEditable: false }), false);
});

ok('conversation submit detection accepts personal and workspace endpoints only', () => {
  const request = (method, url) => ({ method: () => method, url: () => url });
  assert.strictEqual(
    _test.isConversationSubmitRequest(request('POST', 'https://chatgpt.com/backend-api/conversation')),
    true,
  );
  assert.strictEqual(
    _test.isConversationSubmitRequest(request('POST', 'https://chatgpt.com/backend-api/f/conversation')),
    true,
  );
  assert.strictEqual(
    _test.isConversationSubmitRequest(request('GET', 'https://chatgpt.com/backend-api/conversation')),
    false,
  );
});

ok('file upload response detection accepts ChatGPT file endpoints', () => {
  const response = (method, url, status = 200) => ({
    request: () => ({ method: () => method }),
    url: () => url,
    status: () => status,
  });
  assert.strictEqual(
    _test.isFileUploadResponse(response('POST', 'https://chatgpt.com/backend-api/files')),
    true,
  );
  assert.strictEqual(
    _test.isFileUploadResponse(response('POST', 'https://chatgpt.com/backend-api/f/files')),
    true,
  );
  assert.strictEqual(
    _test.isFileUploadResponse(response('GET', 'https://chatgpt.com/backend-api/files')),
    false,
  );
});

(async () => {
  await okAsync('ensureChatMode reports page_load_failed if Chat still looks like Work', async () => {
    const page = {
      evaluate: async () => ({ present: true, chatActive: false, workActive: true }),
      getByRole: () => ({ first: () => ({ click: async () => {} }) }),
      waitForTimeout: async () => {},
      locator: () => ({ last: () => ({ innerText: async () => '5.6 High effort' }) }),
    };
    await assert.rejects(
      () => _test.ensureChatMode(page),
      (err) => err && err.code === 'page_load_failed' && /switch composer/.test(err.message),
    );
  });

  await okAsync('ensureNewChat fails with page_load_failed when polling exhausts', async () => {
    let preflightCalled = false;
    const page = {
      url: () => 'https://chatgpt.com/',
      title: async () => 'ChatGPT',
      $: async () => null,
      evaluate: (() => {
        let calls = 0;
        return async () => calls++ === 0 ? false : { chatWorkSwitcher: false, authSurface: false };
      })(),
      waitForTimeout: async () => {},
      getByRole: () => { preflightCalled = true; throw new Error('preflight should not run'); },
    };

    await assert.rejects(
      () => _test.ensureNewChat(page, { composerAttempts: 1, composerIntervalMs: 0 }),
      (err) => err && err.code === 'page_load_failed' && /composer did not appear/.test(err.message),
    );
    assert.strictEqual(preflightCalled, false, 'composer preflight ran after fail-fast');
  });

  console.log(`\nAll ${passed} workspace/ChatGPT UI tests passed.`);
})().catch((error) => {
  console.error('FAIL:', error);
  process.exitCode = 1;
});
