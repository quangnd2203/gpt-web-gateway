const assert = require('assert');
const { _test } = require('../src/chatgpt');

function createKeyboardDouble({ failInsertText = false } = {}) {
  const calls = [];
  let insertTextAttempts = 0;
  const insertTextValues = [];
  return {
    calls,
    get insertTextAttempts() {
      return insertTextAttempts;
    },
    insertTextValues,
    keyboard: {
      async insertText(value) {
        insertTextAttempts += 1;
        insertTextValues.push(value);
        if (failInsertText) {
          throw new Error('insertText unavailable');
        }
        calls.push({ method: 'insertText', value });
      },
      async type(value, options) {
        calls.push({ method: 'type', value, options });
      },
      async press(value) {
        calls.push({ method: 'press', value });
      },
    },
  };
}

async function run() {
  const cases = [
    ['hello', ['insertText:hello']],
    ['hello\nworld', ['insertText:hello', 'press:Shift+Enter', 'insertText:world']],
    ['hello\r\nworld', ['insertText:hello', 'press:Shift+Enter', 'insertText:world']],
    ['hello\rworld', ['insertText:hello', 'press:Shift+Enter', 'insertText:world']],
    ['a\n\nb', ['insertText:a', 'press:Shift+Enter', 'press:Shift+Enter', 'insertText:b']],
    ['\na', ['press:Shift+Enter', 'insertText:a']],
    ['a\n', ['insertText:a', 'press:Shift+Enter']],
  ];

  for (const [text, expected] of cases) {
    const p = createKeyboardDouble();
    await _test.typeComposerText(p, text);
    const actual = p.calls.map((call) => `${call.method}:${call.value}`);
    assert.deepStrictEqual(actual, expected, `unexpected calls for ${JSON.stringify(text)}`);
    for (const call of p.calls) {
      if (call.method === 'insertText') {
        assert(!/[\r\n]/.test(call.value), `raw newline passed to keyboard.insertText for ${JSON.stringify(text)}`);
      }
    }
  }

  const fallback = createKeyboardDouble({ failInsertText: true });
  await _test.typeComposerText(fallback, 'hello\nworld');
  assert.strictEqual(fallback.insertTextAttempts, 2, 'insertText should be attempted for each text part');
  assert.deepStrictEqual(fallback.insertTextValues, ['hello', 'world']);
  assert.deepStrictEqual(
    fallback.calls.map((call) => `${call.method}:${call.value}`),
    ['type:hello', 'press:Shift+Enter', 'type:world'],
    'fallback should preserve newline ordering',
  );
  for (const call of fallback.calls) {
    if (call.method === 'type') {
      assert(!/[\r\n]/.test(call.value), 'raw newline passed to fallback keyboard.type');
      assert.deepStrictEqual(call.options, { delay: 0 });
    }
  }

  console.log(`All ${cases.length + 1} ChatGPT composer typing tests passed.`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
