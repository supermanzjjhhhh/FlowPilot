const test = require('node:test');
const assert = require('node:assert/strict');

// 引入根目录下的驱动
const TempMailApiUtilsModule = require('../temp-mail-api-utils.js');
globalThis.TempMailApiUtils = TempMailApiUtilsModule;
globalThis.self = globalThis;

// 引入被测后台模块
require('../background/temp-mail-provider.js');

test('TempMailProvider resolves address and polls validation code properly', async () => {
  let stateStore = {};
  const logs = [];

  // Mock TempMailApiUtils 的网络请求行为
  const originalFromToken = globalThis.TempMailApiUtils.fromToken;
  const originalCreateSession = globalThis.TempMailApiUtils.createSession;

  const makeMockClient = () => {
    const client = originalFromToken('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJtYWlsYm94IjoidGVzdC11c2VyQHRlbXAtbWFpbC5vcmciLCJpYXQiOjE1MTYyMzkwMjJ9.signature');
    client.changeMailbox = async () => 'test-user@temp-mail.org';
    client.token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJtYWlsYm94IjoidGVzdC11c2VyQHRlbXAtbWFpbC5vcmciLCJpYXQiOjE1MTYyMzkwMjJ9.signature';
    client.email = 'test-user@temp-mail.org';
    client.waitForVerificationCode = async (regex, options) => {
      const fakeMailText = 'Your verification code is 654321. Welcome to FlowPilot.';
      const match = fakeMailText.match(regex);
      return {
        code: match ? match[0] : null,
        fullText: fakeMailText,
        sender: 'no-reply@test.org'
      };
    };
    return client;
  };

  globalThis.TempMailApiUtils.fromToken = (token) => makeMockClient();
  globalThis.TempMailApiUtils.createSession = async () => makeMockClient();

  try {
    const factory = globalThis.MultiPageBackgroundTempMailProvider.createTempMailProvider({
      addLog: async (msg) => logs.push(msg),
      getState: async () => stateStore,
      setState: async (newState) => { stateStore = { ...stateStore, ...newState }; },
      setEmailState: async (email) => { stateStore.registrationEmail = email; },
      sleepWithStop: async () => {},
      throwIfStopped: () => {},
      TEMP_MAIL_API_PROVIDER: 'temp-mail-api'
    });

    // 测试分配新邮箱（通过 createSessionViaApi，不再依赖预置 Token）
    const email = await factory.ensureTempMailAddress({ generateNew: true });
    assert.equal(email, 'test-user@temp-mail.org');

    // 测试拉取并解析邮件验证码
    const result = await factory.pollTempMailVerificationCode(8, { tempMailApiToken: 'test-token', tempMailApiEmail: 'test-user@temp-mail.org' });
    assert.equal(result.ok, true);
    assert.equal(result.code, '654321');
    assert.ok(result.emailTimestamp);
    assert.ok('mailId' in result);
    assert.ok(logs.some(l => l.includes('654321')));
  } finally {
    globalThis.TempMailApiUtils.fromToken = originalFromToken;
    globalThis.TempMailApiUtils.createSession = originalCreateSession;
  }
});

test('pollTempMailVerificationCode passes pollPayload to waitForVerificationCode', async () => {
  let stateStore = { tempMailApiToken: 'test-token', tempMailApiEmail: 'test@temp-mail.org' };
  const logs = [];
  let capturedOptions = null;

  const originalFromToken = globalThis.TempMailApiUtils.fromToken;
  const originalCreateSession = globalThis.TempMailApiUtils.createSession;

  const makeMockClient = () => {
    const client = originalFromToken('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJtYWlsYm94IjoidGVzdC11c2VyQHRlbXAtbWFpbC5vcmciLCJpYXQiOjE1MTYyMzkwMjJ9.signature');
    client.email = 'test@temp-mail.org';
    client.waitForVerificationCode = async (regex, options) => {
      capturedOptions = options;
      return { code: '123456', fullText: 'code is 123456', sender: 'a@b.com' };
    };
    return client;
  };

  globalThis.TempMailApiUtils.fromToken = (token) => makeMockClient();
  globalThis.TempMailApiUtils.createSession = async () => makeMockClient();

  try {
    const factory = globalThis.MultiPageBackgroundTempMailProvider.createTempMailProvider({
      addLog: async (msg) => logs.push(msg),
      getState: async () => stateStore,
      setState: async () => {},
      setEmailState: async () => {},
      sleepWithStop: async () => {},
      throwIfStopped: () => {},
      TEMP_MAIL_API_PROVIDER: 'temp-mail-api'
    });

    const result = await factory.pollTempMailVerificationCode(8, stateStore, { maxAttempts: 5, intervalMs: 1000 });
    assert.equal(result.ok, true);
    assert.equal(capturedOptions.maxRetries, 5);
    assert.equal(capturedOptions.intervalMs, 1000);
    assert.equal(typeof capturedOptions.onProgress, 'function');
  } finally {
    globalThis.TempMailApiUtils.fromToken = originalFromToken;
    globalThis.TempMailApiUtils.createSession = originalCreateSession;
  }
});

test('OpenAi mail rules configures temp-mail-api provider maxAttempts and intervalMs correctly', () => {
  const fs = require('fs');
  const source = fs.readFileSync('flows/openai/mail-rules.js', 'utf8');
  const globalScope = {};
  new Function('self', `${source};`)(globalScope);
  const rulesFactory = globalScope.MultiPageOpenAiMailRules.createOpenAiMailRules({
    getHotmailVerificationRequestTimestamp: () => 0,
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
  });

  // mailProvider ? temp-mail-api ?
  const state = { mailProvider: 'temp-mail-api', email: 'test@temp-mail.org' };
  const payload = rulesFactory.getRuleDefinition(4, state);

  assert.equal(payload.maxAttempts, 20);
  assert.equal(payload.intervalMs, 5000);

  // ?? mailProvider ? (?? default)
  const defaultState = { mailProvider: 'default-mail', email: 'test@temp-mail.org' };
  const defaultPayload = rulesFactory.getRuleDefinition(4, defaultState);

  assert.equal(defaultPayload.maxAttempts, 5);
  assert.equal(defaultPayload.intervalMs, 3000);
});

test('Verification flow helper getVerificationPollPayload configures temp-mail-api provider maxAttempts and intervalMs correctly', () => {
  const fs = require('fs');
  const source = fs.readFileSync('background/verification-flow.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundVerificationFlow;`)(globalScope);

  const helpers = api.createVerificationFlowHelpers({
    addLog: async () => {},
    getState: async () => ({}),
    getTabId: async () => 1,
    isStopError: () => false,
    sendToContentScript: async () => ({}),
    setState: async () => {},
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    TEMP_MAIL_API_PROVIDER: 'temp-mail-api',
    getHotmailVerificationRequestTimestamp: () => 0,
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
  });

  const state = { mailProvider: 'temp-mail-api', email: 'test@temp-mail.org' };
  const payload = helpers.getVerificationPollPayload(4, state);

  assert.equal(payload.maxAttempts, 20);
  assert.equal(payload.intervalMs, 5000);

  const defaultState = { mailProvider: 'default-mail', email: 'test@temp-mail.org' };
  const defaultPayload = helpers.getVerificationPollPayload(4, defaultState);

  assert.equal(defaultPayload.maxAttempts, 5);
  assert.equal(defaultPayload.intervalMs, 3000);
});
