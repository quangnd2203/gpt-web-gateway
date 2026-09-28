// ChatGPT currently stores localStorage._account as a JSON-encoded string. Keep the
// format decision pure so the login route can inspect/mutate browser state without
// embedding account identifiers or workspace-specific assumptions in the route.
const ACCOUNT_STORAGE_KEY = '_account';

function parseStoredAccount(storageValue) {
  if (storageValue == null) return { format: 'json-string', value: null };

  try {
    const parsed = JSON.parse(storageValue);
    if (typeof parsed === 'string') return { format: 'json-string', value: parsed };
  } catch {}

  return { format: 'unknown', value: null };
}

function accountStateSyncDecision({ cookieValue, storageValue } = {}) {
  if (!cookieValue) {
    return { needsSync: false, reason: 'no-workspace-cookie', format: null };
  }

  // A raw cookie match is supported for compatibility, but a non-matching raw value is
  // intentionally not treated as an encoding we understand.
  if (storageValue === cookieValue) {
    return { needsSync: false, reason: 'matching', format: 'raw-string' };
  }

  const stored = parseStoredAccount(storageValue);
  if (stored.value === cookieValue) {
    return { needsSync: false, reason: 'matching', format: stored.format };
  }

  return {
    needsSync: true,
    reason: stored.value == null ? 'missing-storage' : 'mismatched-storage',
    format: stored.format,
  };
}

function encodeAccountStorageValue(cookieValue, storageValue) {
  const decision = accountStateSyncDecision({ cookieValue, storageValue });
  if (!decision.needsSync) return storageValue;
  if (decision.format === 'json-string') return JSON.stringify(cookieValue);
  throw new Error('Unsupported ChatGPT _account localStorage format');
}

module.exports = {
  ACCOUNT_STORAGE_KEY,
  accountStateSyncDecision,
  encodeAccountStorageValue,
  parseStoredAccount,
};
