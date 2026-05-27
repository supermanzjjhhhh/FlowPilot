const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('background imports verification flow module', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.match(source, /background\/verification-flow\.js/);
});

test('verification flow module exposes a factory', () => {
  const source = fs.readFileSync('background/verification-flow.js', 'utf8');
  const globalScope = {};

  const api = new Function('self', `${source}; return self.MultiPageBackgroundVerificationFlow;`)(globalScope);

  assert.equal(typeof api?.createVerificationFlowHelpers, 'function');
});

test('verification flow routes YYDS Mail provider to background poller', async () => {
  const source = fs.readFileSync('background/verification-flow.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundVerificationFlow;`)(globalScope);
  const pollCalls = [];
  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    buildVerificationPollPayload: () => ({ maxAttempts: 1, intervalMs: 1 }),
    getState: async () => ({}),
    getTabId: async () => 1,
    isStopError: () => false,
    pollYydsMailVerificationCode: async (step, state, payload) => {
      pollCalls.push({ step, state, payload });
      return { ok: true, code: '123456', emailTimestamp: 1, mailId: 'msg-1' };
    },
    sendToContentScript: async () => ({}),
    setState: async () => {},
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    YYDS_MAIL_PROVIDER: 'yyds-mail',
  });

  const result = await helpers.pollFreshVerificationCode(
    4,
    { mailProvider: 'yyds-mail' },
    { provider: 'yyds-mail', label: 'YYDS Mail' },
    { disableTimeBudgetCap: true }
  );

  assert.equal(result.code, '123456');
  assert.equal(pollCalls.length, 1);
  assert.equal(pollCalls[0].step, 4);
  assert.equal(pollCalls[0].payload.maxAttempts, 1);
});

test('verification flow routes custom mail provider to local helper poller', async () => {
  const source = fs.readFileSync('background/verification-flow.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundVerificationFlow;`)(globalScope);
  const pollCalls = [];
  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    buildVerificationPollPayload: () => ({ maxAttempts: 1, intervalMs: 1, targetEmail: 'target@example.com' }),
    CUSTOM_MAIL_PROVIDER: 'custom',
    getState: async () => ({}),
    getTabId: async () => 1,
    isStopError: () => false,
    pollCustomMailVerificationCode: async (step, state, payload) => {
      pollCalls.push({ step, state, payload });
      return { ok: true, code: '654321', emailTimestamp: 2, mailId: 'custom-msg-1' };
    },
    sendToContentScript: async () => ({}),
    setState: async () => {},
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
  });

  const result = await helpers.pollFreshVerificationCode(
    4,
    { mailProvider: 'custom', customMailReceiveMode: 'helper', email: 'target@example.com' },
    { provider: 'custom', label: '自定义邮箱' },
    { disableTimeBudgetCap: true }
  );

  assert.equal(result.code, '654321');
  assert.equal(pollCalls.length, 1);
  assert.equal(pollCalls[0].step, 4);
  assert.equal(pollCalls[0].payload.targetEmail, 'target@example.com');
});

test('background custom mail poller rejects manual mode before calling local helper', async () => {
  const source = fs.readFileSync('background.js', 'utf8');
  function extractFunction(name) {
    const markers = [`async function ${name}(`, `function ${name}(`];
    const start = markers
      .map((marker) => source.indexOf(marker))
      .find((index) => index >= 0);
    if (start < 0) {
      throw new Error(`missing function ${name}`);
    }

    let parenDepth = 0;
    let signatureEnded = false;
    let braceStart = -1;
    for (let i = start; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '(') parenDepth += 1;
      if (ch === ')') {
        parenDepth -= 1;
        if (parenDepth === 0) signatureEnded = true;
      }
      if (ch === '{' && signatureEnded) {
        braceStart = i;
        break;
      }
    }
    let depth = 0;
    let end = braceStart;
    for (; end < source.length; end += 1) {
      const ch = source[end];
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          end += 1;
          break;
        }
      }
    }
    return source.slice(start, end);
  }

  const api = new Function(`
const CUSTOM_MAIL_RECEIVE_MODE_HELPER = 'helper';
const DEFAULT_CUSTOM_MAIL_RECEIVE_MODE = 'manual';
function isCustomMailProvider(stateOrProvider) {
  const provider = typeof stateOrProvider === 'string' ? stateOrProvider : stateOrProvider?.mailProvider;
  return provider === 'custom';
}
${extractFunction('normalizeCustomMailReceiveMode')}
${extractFunction('shouldUseCustomMailHelper')}
async function addLog() {}
async function sleepWithStop() {}
function throwIfStopped() {}
async function requestCustomMailLocalCode() {
  throw new Error('should not request helper in manual mode');
}
${extractFunction('pollCustomMailVerificationCode')}
return { pollCustomMailVerificationCode };
`)();

  await assert.rejects(
    () => api.pollCustomMailVerificationCode(4, {
      mailProvider: 'custom',
      customMailReceiveMode: 'manual',
    }, { maxAttempts: 1, intervalMs: 1 }),
    /手动确认模式/
  );
});
