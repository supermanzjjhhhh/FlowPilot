const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('content/kiro/register-page.js', 'utf8');

function createHarness({ href, hostname, title = '', bodyText = '' }) {
  const context = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    location: { href, hostname },
    document: {
      title,
      body: {
        textContent: bodyText,
      },
      documentElement: {
        getAttribute() {
          return '1';
        },
        setAttribute() {},
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    },
    window: {},
    globalThis: null,
    resetStopState() {},
    isStopError() {
      return false;
    },
    throwIfStopped() {},
    sleep() {
      return Promise.resolve();
    },
    fillInput() {},
    MouseEvent: class {},
    PointerEvent: class {},
    KeyboardEvent: class {},
  };
  context.window = context;
  context.globalThis = context;
  context.window.getComputedStyle = () => ({ display: 'block', visibility: 'visible' });

  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

test('kiro register content detects aws request error page as a proxy failure', () => {
  const harness = createHarness({
    href: 'https://profile.aws.amazon.com/signup',
    hostname: 'profile.aws.amazon.com',
    title: '错误',
    bodyText: '抱歉，处理您的请求时出错。请重试。',
  });

  const detected = harness.detectKiroRegisterPageState();

  assert.equal(detected.state, 'proxy_error_page');
  assert.match(detected.fatalMessage, /切换代理/);
});

test('kiro register content does not misclassify the normal name page as a proxy failure', () => {
  const harness = createHarness({
    href: 'https://profile.aws.amazon.com/signup',
    hostname: 'profile.aws.amazon.com',
    title: 'Enter your name',
    bodyText: '输入您的姓名 继续',
  });

  const fatal = harness.detectKiroFatalPageState('输入您的姓名 继续', harness.location.href, harness.document.title);

  assert.equal(fatal, null);
});
