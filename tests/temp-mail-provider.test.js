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