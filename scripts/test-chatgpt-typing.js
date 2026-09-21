const assert = require('assert');
const { _test } = require('../src/chatgpt');

function createKeyboardDouble() {
  const calls = [];
  return {
    calls,
    keyboard: {
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
    ['hello', ['type:hello']],
    ['hello\nworld', ['type:hello', 'press:Shift+Enter', 'type:world']],
    ['hello\r\nworld', ['type:hello', 'press:Shift+Enter', 'type:world']],
    ['hello\rworld', ['type:hello', 'press:Shift+Enter', 'type:world']],
    ['a\n\nb', ['type:a', 'press:Shift+Enter', 'press:Shift+Enter', 'type:b']],
    ['\na', ['press:Shift+Enter', 'type:a']],
    ['a\n', ['type:a', 'press:Shift+Enter']],
  ];

  for (const [text, expected] of cases) {
    const p = createKeyboardDouble();
    await _test.typeComposerText(p, text, { delay: 10 });
    const actual = p.calls.map((call) => `${call.method}:${call.value}`);
    assert.deepStrictEqual(actual, expected, `unexpected calls for ${JSON.stringify(text)}`);
    for (const call of p.calls) {
      if (call.method === 'type') {
        assert(!/[\r\n]/.test(call.value), `raw newline passed to keyboard.type for ${JSON.stringify(text)}`);
        assert.deepStrictEqual(call.options, { delay: 10 });
      }
    }
  }

  console.log(`All ${cases.length} ChatGPT composer typing tests passed.`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
