const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('flows/openai/background/steps/create-plus-checkout.js', 'utf8');
const plusCheckoutSource = fs.readFileSync('flows/openai/content/plus-checkout.js', 'utf8');
const gopayUtilsSource = fs.readFileSync('gopay-utils.js', 'utf8');
const globalScope = {};
new Function('self', `${gopayUtilsSource};`)(globalScope);
const api = new Function('self', `${source}; return self.MultiPageBackgroundPlusCheckoutCreate;`)(globalScope);

function createCheckoutContentHarness() {
  const checkoutEvents = [];
  const attrs = new Map();
  let listener = null;
  const elements = [];

  function createElement({ tagName = 'DIV', text = '', attrs: initialAttrs = {}, id = '', type = '', value = '' } = {}) {
    const attrMap = new Map(Object.entries(initialAttrs));
    if (id) attrMap.set('id', id);
    if (type) attrMap.set('type', type);
    const element = {
      nodeType: 1,
      tagName,
      id,
      type,
      value,
      textContent: text,
      innerText: text,
      className: initialAttrs.class || '',
      checked: initialAttrs.checked === 'true',
      disabled: false,
      hidden: false,
      dataset: {},
      children: [],
      parentElement: null,
      style: { display: 'block', visibility: 'visible' },
      getAttribute(name) {
        if (name === 'class') return this.className;
        if (name === 'id') return this.id || attrMap.get(name) || '';
        if (name === 'type') return this.type || attrMap.get(name) || '';
        return attrMap.has(name) ? attrMap.get(name) : '';
      },
      setAttribute(name, nextValue) {
        attrMap.set(name, String(nextValue));
      },
      closest() {
        return null;
      },
      querySelector() {
        return null;
      },
      scrollIntoView() {},
      focus() {},
      dispatchEvent() {
        return true;
      },
      click() {},
      getBoundingClientRect() {
        return { left: 10, top: 20, width: 180, height: 44 };
      },
    };
    return element;
  }

  const paymentButton = createElement({ tagName: 'BUTTON', text: 'PayPal', attrs: { role: 'tab', 'aria-selected': '' } });
  const fullNameInput = createElement({ tagName: 'INPUT', id: 'name', type: 'text', attrs: { name: 'billingName', placeholder: 'Full name' } });
  const addressInput = createElement({ tagName: 'INPUT', id: 'address', type: 'text', attrs: { name: 'addressLine1', placeholder: 'Address line 1' } });
  const cityInput = createElement({ tagName: 'INPUT', id: 'city', type: 'text', attrs: { name: 'locality', placeholder: 'City' } });
  const postalInput = createElement({ tagName: 'INPUT', id: 'postal', type: 'text', attrs: { name: 'postalCode', placeholder: 'Postal code' } });
  const suggestionOption = createElement({ tagName: 'LI', text: 'Unter den Linden 1, Berlin', attrs: { role: 'option', class: 'pac-item' } });
  const subscribeButton = createElement({ tagName: 'BUTTON', text: 'Subscribe', attrs: { type: 'submit', 'aria-label': 'Subscribe' } });
  subscribeButton.type = 'submit';
  elements.push(paymentButton, fullNameInput, addressInput, cityInput, postalInput, suggestionOption, subscribeButton);

  const context = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    location: { href: 'https://chatgpt.com/checkout/openai_ie/cs_test' },
    window: {},
    CSS: { escape: (value) => String(value) },
    Event: class TestEvent { constructor(type) { this.type = type; } },
    MouseEvent: class TestMouseEvent { constructor(type) { this.type = type; } },
    PointerEvent: class TestPointerEvent { constructor(type) { this.type = type; } },
    document: {
      readyState: 'complete',
      body: {},
      documentElement: {
        getAttribute(name) {
          return attrs.get(name) || null;
        },
        setAttribute(name, nextValue) {
          attrs.set(name, String(nextValue));
        },
      },
      getElementById() {
        return null;
      },
      querySelectorAll(selector) {
        const text = String(selector || '');
        if (text.includes('label[for=')) return [];
        if (text.includes('[role="option"]') || text.includes('.pac-item') || text === 'li') return [suggestionOption];
        if (text === 'input, textarea') return elements.filter((element) => element.tagName === 'INPUT');
        if (text.includes('button[type="submit"]')) return [subscribeButton];
        if (text.includes('button') || text.includes('[role=') || text.includes('[tabindex]') || text.includes('[data-testid]')) {
          return elements.filter((element) => element.tagName === 'BUTTON');
        }
        if (text.includes('select') || text.includes('[aria-haspopup="listbox"]')) return [];
        return [];
      },
    },
    chrome: {
      runtime: {
        onMessage: {
          addListener(fn) {
            listener = fn;
          },
        },
      },
    },
    CodexOperationDelay: {
      async performOperationWithDelay(metadata, operation) {
        checkoutEvents.push({ type: 'operation', label: metadata.label, kind: metadata.kind });
        const result = await operation();
        checkoutEvents.push({ type: 'delay', label: metadata.label, ms: 2000 });
        return result;
      },
    },
    resetStopState() {},
    isStopError() { return false; },
    throwIfStopped() {},
    sleep() { return Promise.resolve(); },
    log() {},
    fillInput(element, nextValue) {
      element.value = nextValue;
    },
    simulateClick(element) {
      if (element === paymentButton) {
        paymentButton.setAttribute('aria-selected', 'true');
      }
    },
  };
  context.window = context;
  context.window.getComputedStyle = (element) => element?.style || { display: 'block', visibility: 'visible' };

  vm.createContext(context);
  vm.runInContext(plusCheckoutSource, context);
  assert.equal(typeof listener, 'function');

  async function send(message) {
    return await new Promise((resolve) => {
      listener(message, {}, resolve);
    });
  }

  return { checkoutEvents, send };
}

test('Plus checkout create does not wait 20 seconds after opening checkout page', async () => {
  const events = [];
  const executor = api.createPlusCheckoutCreateExecutor({
    addLog: async (message, level = 'info') => {
      events.push({ type: 'log', message, level });
    },
    chrome: {
      tabs: {
        create: async (payload) => {
          events.push({ type: 'tab-create', payload });
          return { id: 42 };
        },
        update: async (tabId, payload) => {
          events.push({ type: 'tab-update', tabId, payload });
        },
      },
    },
    completeNodeFromBackground: async (step, payload) => {
      events.push({ type: 'complete', step, payload });
    },
    ensureContentScriptReadyOnTabUntilStopped: async () => {
      events.push({ type: 'ready' });
    },
    registerTab: async (source, tabId) => {
      events.push({ type: 'register', source, tabId });
    },
    sendTabMessageUntilStopped: async (tabId, source, message) => {
      events.push({ type: 'tab-message', tabId, source, message });
      return {
        checkoutUrl: 'https://checkout.stripe.com/c/pay/session',
        country: 'US',
        currency: 'USD',
      };
    },
    setState: async (payload) => {
      events.push({ type: 'set-state', payload });
    },
    sleepWithStop: async (ms) => {
      events.push({ type: 'sleep', ms });
    },
    waitForTabCompleteUntilStopped: async () => {
      events.push({ type: 'tab-complete' });
    },
  });

  await executor.executePlusCheckoutCreate();

  assert.deepEqual(
    events.find((event) => event.type === 'tab-create'),
    { type: 'tab-create', payload: { url: 'https://chatgpt.com/', active: true } }
  );
  assert.deepEqual(
    events.find((event) => event.type === 'register'),
    { type: 'register', source: 'plus-checkout', tabId: 42 }
  );

  const sleepEvents = events.filter((event) => event.type === 'sleep');
  assert.deepStrictEqual(sleepEvents.map((event) => event.ms), [1000, 1000]);
  assert.deepStrictEqual(
    events.find((event) => event.type === 'tab-message')?.message?.payload,
    { paymentMethod: 'paypal' }
  );

  const completeIndex = events.findIndex((event) => event.type === 'complete');
  const readyLogIndex = events.findIndex((event) => event.type === 'log' && /已就绪/.test(event.message));
  assert.ok(readyLogIndex > -1);
  assert.ok(completeIndex > readyLogIndex);
  assert.equal(events.some((event) => event.type === 'sleep' && event.ms === 20000), false);
});

test('GoPay plus checkout create forwards gopay payment method to the checkout content script', async () => {
  const events = [];
  let proxyCallCount = 0;
  const executor = api.createPlusCheckoutCreateExecutor({
    addLog: async () => {},
    chrome: {
      tabs: {
        create: async () => ({ id: 99 }),
        update: async () => {},
      },
    },
    completeNodeFromBackground: async () => {},
    ensureContentScriptReadyOnTabUntilStopped: async () => {},
    registerTab: async () => {},
    sendTabMessageUntilStopped: async (_tabId, _source, message) => {
      events.push(message);
      return {
        checkoutUrl: 'https://chatgpt.com/checkout/openai_llc/test-session',
        country: 'ID',
        currency: 'IDR',
      };
    },
    setState: async () => {},
    sleepWithStop: async () => {},
    waitForTabCompleteUntilStopped: async () => {},
    withCheckoutCreationProxy: async () => {
      proxyCallCount += 1;
      throw new Error('gopay checkout should not use the checkout proxy wrapper');
    },
  });

  await executor.executePlusCheckoutCreate({ plusPaymentMethod: 'gopay' });

  assert.deepStrictEqual(events[0]?.payload, { paymentMethod: 'gopay' });
  assert.equal(proxyCallCount, 0);
});

test('PayPal no-card binding creates checkout inside the local checkout proxy wrapper', async () => {
  const events = [];
  const executor = api.createPlusCheckoutCreateExecutor({
    addLog: async () => {},
    chrome: {
      tabs: {
        create: async () => ({ id: 77, url: 'https://chatgpt.com/', status: 'complete' }),
        update: async () => {},
        get: async () => ({ id: 77, url: 'https://www.paypal.com/pay?token=BA-wrapper', status: 'complete' }),
      },
    },
    completeNodeFromBackground: async () => {},
    ensureContentScriptReadyOnTabUntilStopped: async () => {},
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        address: {
          Address: '1 Main St',
          City: 'New York',
          State: 'New York',
          Zip_Code: '10001',
        },
      }),
    }),
    getState: async () => ({
      hostedCheckoutPhoneNumber: '4155551234',
    }),
    registerTab: async () => {},
    sendTabMessageUntilStopped: async (_tabId, _source, message) => {
      events.push({ type: 'tab-message', message, inProxy: events.some((event) => event.type === 'proxy-enter') && !events.some((event) => event.type === 'proxy-exit') });
      if (message.type === 'CREATE_PLUS_CHECKOUT') {
        return {
          checkoutUrl: 'https://chatgpt.com/checkout/openai_llc/cs_hosted',
          preferredCheckoutUrl: 'https://pay.openai.com/c/pay/cs_hosted',
          hostedCheckoutUrl: 'https://pay.openai.com/c/pay/cs_hosted',
          country: 'US',
          currency: 'USD',
        };
      }
      if (message.type === 'RUN_PAYPAL_HOSTED_OPENAI_CHECKOUT_STEP') {
        return { clicked: true };
      }
      throw new Error(`unexpected message type ${message.type}`);
    },
    setState: async () => {},
    sleepWithStop: async () => {},
    waitForTabCompleteUntilStopped: async () => {},
    withCheckoutCreationProxy: async (config, action) => {
      events.push({ type: 'proxy-enter', config });
      const result = await action();
      events.push({ type: 'proxy-exit' });
      return result;
    },
  });

  await executor.executePlusCheckoutCreate({
    plusPaymentMethod: 'paypal-hosted',
    plusHostedCheckoutOauthDelaySeconds: 0,
  });

  assert.deepStrictEqual(events.find((event) => event.type === 'proxy-enter')?.config, {
    healthUrl: 'http://127.0.0.1:21988/health',
    localProxyUrl: 'socks5://127.0.0.1:21987',
  });
  assert.equal(
    events.find((event) => event.type === 'tab-message' && event.message.type === 'CREATE_PLUS_CHECKOUT')?.inProxy,
    true
  );
});

test('PayPal no-card binding falls back to direct checkout when local helper proxy fails', async () => {
  const events = [];
  let createAttempts = 0;
  const proxySettings = {
    get(details, callback) {
      events.push({ type: 'proxy-get', details });
      callback({
        levelOfControl: 'controllable_by_this_extension',
        value: { mode: 'system' },
      });
    },
    set(details, callback) {
      events.push({ type: 'proxy-set', details });
      callback();
    },
    clear(details, callback) {
      events.push({ type: 'proxy-clear', details });
      callback();
    },
  };
  const executor = api.createPlusCheckoutCreateExecutor({
    addLog: async () => {},
    chrome: {
      runtime: {},
      proxy: {
        settings: proxySettings,
      },
      tabs: {
        create: async () => ({ id: 78, url: 'https://chatgpt.com/', status: 'complete' }),
        update: async () => {},
        get: async () => ({ id: 78, url: 'https://www.paypal.com/pay?token=BA-direct', status: 'complete' }),
      },
    },
    completeNodeFromBackground: async () => {},
    ensureContentScriptReadyOnTabUntilStopped: async () => {},
    fetch: async (url) => {
      events.push({ type: 'fetch', url });
      if (String(url).startsWith('http://127.0.0.1:21988/health')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, localProxy: 'socks5://127.0.0.1:21987' }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          address: {
            Address: '1 Main St',
            City: 'New York',
            State: 'New York',
            Zip_Code: '10001',
          },
        }),
      };
    },
    getState: async () => ({
      hostedCheckoutPhoneNumber: '4155551234',
    }),
    registerTab: async () => {},
    sendTabMessageUntilStopped: async (_tabId, _source, message) => {
      events.push({ type: 'tab-message', message });
      if (message.type === 'CREATE_PLUS_CHECKOUT') {
        createAttempts += 1;
        if (createAttempts === 1) {
          return { error: 'proxy connect failed' };
        }
        return {
          checkoutUrl: 'https://chatgpt.com/checkout/openai_llc/cs_hosted',
          preferredCheckoutUrl: 'https://www.paypal.com/pay?token=BA-direct',
          hostedCheckoutUrl: 'https://www.paypal.com/pay?token=BA-direct',
          country: 'US',
          currency: 'USD',
        };
      }
      if (message.type === 'RUN_PAYPAL_HOSTED_OPENAI_CHECKOUT_STEP') {
        return { clicked: true };
      }
      throw new Error(`unexpected message type ${message.type}`);
    },
    setState: async () => {},
    sleepWithStop: async () => {},
    waitForTabCompleteUntilStopped: async () => {},
  });

  await executor.executePlusCheckoutCreate({
    plusPaymentMethod: 'paypal-hosted',
    plusHostedCheckoutOauthDelaySeconds: 0,
  });

  assert.equal(createAttempts, 2);
  assert.equal(events.some((event) => event.type === 'proxy-set' && event.details?.value?.mode === 'pac_script'), true);
  assert.equal(events.some((event) => event.type === 'proxy-clear' && event.details?.scope === 'regular'), true);
});

test('PayPal no-card binding create opens and submits hosted OpenAI checkout before completing', async () => {
  const events = [];
  let currentUrl = 'https://chatgpt.com/';
  const executor = api.createPlusCheckoutCreateExecutor({
    addLog: async (message, level = 'info') => {
      events.push({ type: 'log', message, level });
    },
    chrome: {
      tabs: {
        create: async (payload) => {
          events.push({ type: 'tab-create', payload });
          return { id: 55, url: payload.url, status: 'complete' };
        },
        update: async (tabId, payload) => {
          currentUrl = payload.url;
          events.push({ type: 'tab-update', tabId, payload });
          return { id: tabId, url: currentUrl, status: 'complete' };
        },
        get: async (tabId) => ({ id: tabId, url: currentUrl, status: 'complete' }),
      },
    },
    completeNodeFromBackground: async (step, payload) => {
      events.push({ type: 'complete', step, payload });
    },
    ensureContentScriptReadyOnTabUntilStopped: async (source, tabId, options) => {
      events.push({ type: 'ready', source, tabId, options });
    },
    fetch: async (url) => {
      events.push({ type: 'fetch', url });
      assert.equal(url, 'https://www.meiguodizhi.com/api/v1/dz');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          address: {
            Address: '1 Main St',
            City: 'New York',
            State: 'New York',
            Zip_Code: '10001',
          },
        }),
      };
    },
    getState: async () => {
      events.push({ type: 'get-state' });
      return {
        hostedCheckoutPhoneNumber: '4155551234',
      };
    },
    registerTab: async (source, tabId) => {
      events.push({ type: 'register', source, tabId });
    },
    sendTabMessageUntilStopped: async (tabId, source, message) => {
      events.push({ type: 'tab-message', tabId, source, message });
      if (message.type === 'CREATE_PLUS_CHECKOUT') {
        return {
          checkoutUrl: 'https://chatgpt.com/checkout/openai_llc/cs_hosted',
          preferredCheckoutUrl: 'https://pay.openai.com/c/pay/cs_hosted',
          hostedCheckoutUrl: 'https://pay.openai.com/c/pay/cs_hosted',
          country: 'US',
          currency: 'USD',
        };
      }
      if (message.type === 'RUN_PAYPAL_HOSTED_OPENAI_CHECKOUT_STEP') {
        currentUrl = 'https://www.paypal.com/pay?token=BA-hosted';
        return { clicked: true };
      }
      throw new Error(`unexpected message type ${message.type}`);
    },
    setState: async (payload) => {
      events.push({ type: 'set-state', payload });
    },
    sleepWithStop: async (ms) => {
      events.push({ type: 'sleep', ms });
    },
    waitForTabCompleteUntilStopped: async () => {
      events.push({ type: 'tab-complete' });
    },
  });

  await executor.executePlusCheckoutCreate({
    plusPaymentMethod: 'paypal-hosted',
    plusHostedCheckoutOauthDelaySeconds: 0,
  });

  assert.deepStrictEqual(
    events.find((event) => event.type === 'tab-message' && event.message.type === 'CREATE_PLUS_CHECKOUT')?.message?.payload,
    { paymentMethod: 'paypal-hosted' }
  );
  assert.equal(
    events.find((event) => event.type === 'tab-update')?.payload?.url,
    'https://pay.openai.com/c/pay/cs_hosted'
  );
  const statePayload = events.filter((event) => event.type === 'set-state').at(-1)?.payload || {};
  assert.equal(statePayload.plusCheckoutSource, 'paypal-hosted');
  assert.equal(statePayload.plusCheckoutCountry, 'US');
  assert.equal(statePayload.plusCheckoutCurrency, 'USD');
  assert.equal(statePayload.plusReturnUrl, '');
  assert.equal(events.some((event) => event.type === 'tab-message' && event.message.type === 'FILL_PLUS_BILLING_AND_SUBMIT'), false);
  assert.equal(events.some((event) => event.type === 'tab-message' && event.message.type === 'RUN_PAYPAL_HOSTED_OPENAI_CHECKOUT_STEP'), true);
  assert.equal(
    events.find((event) => event.type === 'tab-message' && event.message.type === 'RUN_PAYPAL_HOSTED_OPENAI_CHECKOUT_STEP')?.message?.payload?.address?.street,
    '1 Main St'
  );
  assert.deepStrictEqual(events.find((event) => event.type === 'complete'), {
    type: 'complete',
    step: 'plus-checkout-create',
    payload: {
      plusCheckoutCountry: 'US',
      plusCheckoutCurrency: 'USD',
      plusCheckoutSource: 'paypal-hosted',
      plusCheckoutUrl: 'https://www.paypal.com/pay?token=BA-hosted',
      plusReturnUrl: '',
      plusHostedCheckoutCompleted: false,
    },
  });
});

test('PayPal no-card binding OpenAI checkout node submits hosted page and completes after success transition', async () => {
  const events = [];
  let currentUrl = 'https://pay.openai.com/c/pay/cs_hosted';
  const executor = api.createPlusCheckoutCreateExecutor({
    addLog: async (message, level = 'info') => {
      events.push({ type: 'log', message, level });
    },
    chrome: {
      tabs: {
        get: async (tabId) => ({ id: tabId, url: currentUrl, status: 'complete' }),
      },
    },
    completeNodeFromBackground: async (step, payload) => {
      events.push({ type: 'complete', step, payload });
    },
    ensureContentScriptReadyOnTabUntilStopped: async (source, tabId, options) => {
      events.push({ type: 'ready', source, tabId, options });
    },
    fetch: async (url) => {
      events.push({ type: 'fetch', url });
      assert.equal(url, 'https://www.meiguodizhi.com/api/v1/dz');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          address: {
            Address: '1 Main St',
            City: 'New York',
            State: 'New York',
            Zip_Code: '10001',
          },
        }),
      };
    },
    getState: async () => ({
      hostedCheckoutPhoneNumber: '(415) 555-1234',
    }),
    registerTab: async (source, tabId) => {
      events.push({ type: 'register', source, tabId });
    },
    sendTabMessageUntilStopped: async (tabId, source, message) => {
      events.push({ type: 'tab-message', tabId, source, message });
      if (message.type === 'RUN_PAYPAL_HOSTED_OPENAI_CHECKOUT_STEP') {
        currentUrl = 'https://chatgpt.com/backend-api/payments/success?session_id=cs_hosted';
        return { clicked: true };
      }
      if (message.type === 'PLUS_CHECKOUT_GET_STATE') {
        return { hostedVerificationVisible: false };
      }
      throw new Error(`unexpected message type ${message.type}`);
    },
    setState: async (payload) => {
      events.push({ type: 'set-state', payload });
    },
    sleepWithStop: async (ms) => {
      events.push({ type: 'sleep', ms });
    },
    waitForTabCompleteUntilStopped: async () => {
      events.push({ type: 'tab-complete' });
    },
  });

  await executor.executePayPalHostedOpenAiCheckout({
    plusCheckoutTabId: 55,
    plusPaymentMethod: 'paypal-hosted',
    hostedCheckoutPhoneNumber: '2125550000',
    plusHostedCheckoutOauthDelaySeconds: 0,
  });

  const profileState = events.find((event) => event.type === 'set-state' && event.payload.plusHostedCheckoutGuestProfile)?.payload || {};
  assert.equal(profileState.plusHostedCheckoutGuestProfile.phone, '4155551234');
  assert.equal(profileState.plusHostedCheckoutPhoneDigits, '4155551234');
  assert.equal(
    events.find((event) => event.type === 'tab-message' && event.message.type === 'RUN_PAYPAL_HOSTED_OPENAI_CHECKOUT_STEP')?.message?.payload?.address?.street,
    '1 Main St'
  );
  assert.deepStrictEqual(events.find((event) => event.type === 'complete'), {
    type: 'complete',
    step: 'paypal-hosted-openai-checkout',
    payload: {
      plusCheckoutUrl: 'https://chatgpt.com/backend-api/payments/success?session_id=cs_hosted',
      plusCheckoutSource: 'paypal-hosted',
      plusReturnUrl: 'https://chatgpt.com/backend-api/payments/success?session_id=cs_hosted',
      plusHostedCheckoutCompleted: true,
    },
  });
});

test('PayPal hosted email node completes when Next navigation drops the content response', async () => {
  const events = [];
  let currentUrl = 'https://www.paypal.com/checkoutweb/pay?token=EC-test';
  const executor = api.createPlusCheckoutCreateExecutor({
    addLog: async (message, level = 'info', options = {}) => events.push({ type: 'log', message, level, options }),
    chrome: {
      tabs: {
        get: async (tabId) => ({ id: tabId, url: currentUrl, status: 'complete' }),
      },
    },
    completeNodeFromBackground: async (step, payload) => events.push({ type: 'complete', step, payload }),
    ensureContentScriptReadyOnTabUntilStopped: async (source, tabId, options) => events.push({ type: 'ready', source, tabId, options }),
    getState: async () => ({
      hostedCheckoutPhoneNumber: '(415) 555-1234',
    }),
    registerTab: async (source, tabId) => events.push({ type: 'register', source, tabId }),
    sendTabMessageUntilStopped: async (tabId, source, message) => {
      events.push({ type: 'tab-message', tabId, source, message });
      if (message.type === 'PAYPAL_RUN_HOSTED_CHECKOUT_STEP') {
        currentUrl = 'https://www.paypal.com/checkoutweb/signup?ba_token=BA-test&token=EC-test';
        return new Promise(() => {});
      }
      if (message.type === 'PAYPAL_HOSTED_GET_STATE') {
        return {
          hostedStage: currentUrl.includes('/signup')
            ? 'guest_checkout'
            : 'pay_login',
        };
      }
      throw new Error(`unexpected message type ${message.type}`);
    },
    setState: async (payload) => events.push({ type: 'set-state', payload }),
    sleepWithStop: async (ms) => events.push({ type: 'sleep', ms }),
    waitForTabCompleteUntilStopped: async () => events.push({ type: 'tab-complete' }),
  });

  await executor.executePayPalHostedEmail({
    plusCheckoutTabId: 85661333,
    plusHostedCheckoutGuestProfile: {
      email: 'guest@example.com',
      phone: '4155551234',
      address: { street: '1 Main St', city: 'New York', state: 'New York', zip: '10001' },
    },
  });

  assert.equal(currentUrl.includes('/signup'), true);
  assert.equal(
    events.some((event) => event.type === 'complete' && event.step === 'paypal-hosted-email'),
    true
  );
  assert.equal(
    events.some((event) => event.type === 'log' && /已检测到 PayPal 进入后续页面（guest_checkout）/.test(event.message)),
    true
  );
  assert.equal(
    events.some((event) => event.type === 'tab-message' && event.message.type === 'PAYPAL_RUN_HOSTED_CHECKOUT_STEP'),
    true
  );
});

test('PayPal hosted create account node submits PayPal security code from SMS text payload', async () => {
  const events = [];
  let stage = 'create_account';
  const executor = api.createPlusCheckoutCreateExecutor({
    addLog: async (message, level = 'info', options = {}) => events.push({ type: 'log', message, level, options }),
    chrome: {
      tabs: {
        get: async (tabId) => ({ id: tabId, url: 'https://www.paypal.com/checkoutweb/create-account', status: 'complete' }),
      },
    },
    completeNodeFromBackground: async (step, payload) => events.push({ type: 'complete', step, payload }),
    ensureContentScriptReadyOnTabUntilStopped: async (source, tabId, options) => events.push({ type: 'ready', source, tabId, options }),
    fetch: async (url) => {
      events.push({ type: 'fetch', url });
      if (url === 'https://www.meiguodizhi.com/api/v1/dz') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            address: {
              Address: '1 Main St',
              City: 'New York',
              State: 'New York',
              Zip_Code: '10001',
            },
          }),
        };
      }
      assert.equal(String(url).startsWith('https://otp.example.test/latest?t='), true);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          code: 1,
          msg: 'ok',
          data: {
            code: "PayPal: 921714 is your security code. Don't share it.",
            code_time: '2026-05-25 01:41:22',
            expired_date: '2026-08-15 00:00:00',
          },
        }),
      };
    },
    getState: async () => ({
      hostedCheckoutVerificationUrl: 'https://otp.example.test/latest',
      hostedCheckoutPhoneNumber: '8352531607',
    }),
    registerTab: async (source, tabId) => events.push({ type: 'register', source, tabId }),
    sendTabMessageUntilStopped: async (tabId, source, message) => {
      events.push({ type: 'tab-message', tabId, source, message });
      if (message.type === 'PAYPAL_HOSTED_GET_STATE') {
        return { hostedStage: stage };
      }
      if (message.type === 'PAYPAL_RUN_HOSTED_CHECKOUT_STEP' && message.payload.expectedStage === 'create_account') {
        stage = 'security_code';
        return { clicked: true, submitted: true, stage: 'create_account' };
      }
      if (message.type === 'PAYPAL_RUN_HOSTED_CHECKOUT_STEP' && message.payload.expectedStage === 'security_code') {
        stage = 'review_consent';
        return { securityCodeSubmitted: true, stage: 'security_code' };
      }
      throw new Error(`unexpected message type ${message.type}`);
    },
    setState: async (payload) => events.push({ type: 'set-state', payload }),
    sleepWithStop: async (ms) => events.push({ type: 'sleep', ms }),
    waitForTabCompleteUntilStopped: async () => events.push({ type: 'tab-complete' }),
  });

  await executor.executePayPalHostedCreateAccount({
    plusCheckoutTabId: 55,
    plusPaymentMethod: 'paypal-hosted',
  });

  assert.deepStrictEqual(
    events.find((event) => event.type === 'tab-message' && event.message?.payload?.expectedStage === 'security_code')?.message?.payload,
    {
      expectedStage: 'security_code',
      securityCode: '921714',
    }
  );
  assert.equal(events.some((event) => event.type === 'complete' && event.step === 'paypal-hosted-create-account'), true);
});

test('Plus checkout content routes billing operations through the operation delay gate', async () => {
  const { checkoutEvents, send } = createCheckoutContentHarness();

  const result = await send({
    type: 'FILL_PLUS_BILLING_AND_SUBMIT',
    source: 'test',
    payload: {
      fullName: 'Ada Lovelace',
      addressSeed: {
        skipAutocomplete: true,
        fallback: {
          address1: 'Unter den Linden',
          city: 'Berlin',
          region: 'Berlin',
          postalCode: '10117',
        },
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepStrictEqual(checkoutEvents.filter((event) => event.type === 'operation').map((event) => event.label), [
    'select-payment-method',
    'fill-billing-address',
    'click-subscribe',
  ]);
  assert.deepStrictEqual(checkoutEvents.filter((event) => event.type === 'delay').map((event) => event.ms), [2000, 2000, 2000]);
});

test('Plus checkout content routes same-frame autocomplete query and suggestion through separate operation delays', async () => {
  const { checkoutEvents, send } = createCheckoutContentHarness();

  const result = await send({
    type: 'FILL_PLUS_BILLING_AND_SUBMIT',
    source: 'test',
    payload: {
      fullName: 'Ada Lovelace',
      addressSeed: {
        query: 'Unter den Linden',
        suggestionIndex: 0,
        fallback: {
          address1: 'Unter den Linden',
          city: 'Berlin',
          region: 'Berlin',
          postalCode: '10117',
        },
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepStrictEqual(checkoutEvents.filter((event) => event.type === 'operation').map((event) => event.label), [
    'select-payment-method',
    'fill-address-query',
    'select-address-suggestion',
    'fill-billing-address',
    'click-subscribe',
  ]);
  assert.deepStrictEqual(checkoutEvents.filter((event) => event.type === 'delay').map((event) => event.label), [
    'select-payment-method',
    'fill-address-query',
    'select-address-suggestion',
    'fill-billing-address',
    'click-subscribe',
  ]);
  assert.equal(checkoutEvents.some((event) => event.type === 'delay' && event.ms !== 2000), false);
});

function createFakeGpcPrepareDom() {
  const dispatches = [];
  function createElement({ tagName = 'DIV', text = '', placeholder = '', className = '', value = '', disabled = false } = {}) {
    return {
      tagName,
      textContent: text,
      innerText: text,
      placeholder,
      className,
      value,
      disabled,
      clicked: false,
      style: { display: 'block', visibility: 'visible', opacity: '1' },
      name: '',
      id: '',
      getAttribute(name) {
        if (name === 'class') return this.className;
        if (name === 'aria-disabled') return this.disabled ? 'true' : '';
        if (name === 'placeholder') return this.placeholder;
        return '';
      },
      focus() {},
      blur() {},
      scrollIntoView() {},
      click() {
        this.clicked = true;
        this.onClick?.();
      },
      dispatchEvent(event) {
        dispatches.push({ element: this, type: event?.type || '' });
        return true;
      },
      getBoundingClientRect() {
        return { width: 120, height: 32 };
      },
    };
  }

  const freeButton = createElement({ tagName: 'BUTTON', text: '免费充值' });
  const cardModeButton = createElement({ tagName: 'BUTTON', text: '卡密充值 使用付费卡密扣次充值' });
  freeButton.className = 'active';
  cardModeButton.onClick = () => {
    freeButton.className = '';
    cardModeButton.className = 'active';
  };
  const startButton = createElement({ tagName: 'BUTTON', text: '开始 Plus 充值' });
  const cardInputs = [
    createElement({ tagName: 'INPUT', placeholder: 'XXXXXXXX', className: 'card-key-seg' }),
    createElement({ tagName: 'INPUT', placeholder: 'XXXXXXXX', className: 'card-key-seg' }),
    createElement({ tagName: 'INPUT', placeholder: 'XXXXXXXX', className: 'card-key-seg' }),
  ];
  const sessionTextarea = createElement({
    tagName: 'TEXTAREA',
    placeholder: '可直接粘贴完整 session JSON，会自动提取 accessToken',
    className: 'design-session-input',
  });

  return {
    cardModeButton,
    cardInputs,
    dispatches,
    sessionTextarea,
    document: {
      querySelectorAll(selector) {
        const text = String(selector || '');
        if (text.includes('button') || text.includes('[role="button"]') || text.includes('.design-mode-card')) {
          return [freeButton, cardModeButton, startButton];
        }
        if (text.includes('input.card-key-seg') || text.includes('placeholder*="XXXXXXXX"') || text.includes('maxlength="8"')) {
          return cardInputs;
        }
        if (text === 'textarea') {
          return [sessionTextarea];
        }
        if (text === 'input') {
          return cardInputs;
        }
        return [];
      },
      querySelector(selector) {
        return String(selector || '').includes('textarea') ? sessionTextarea : null;
      },
      body: { innerText: 'SYSTEM 页面已就绪' },
      documentElement: { innerText: 'SYSTEM 页面已就绪' },
    },
  };
}

test('GPC checkout prepare opens page, fills segmented card key, and writes full ChatGPT session JSON', async () => {
  const events = [];
  const dom = createFakeGpcPrepareDom();
  const session = {
    user: { email: 'current@example.com' },
    accessToken: 'session-access-token',
    expires: '2026-06-01T00:00:00.000Z',
  };
  const executor = api.createPlusCheckoutCreateExecutor({
    addLog: async (message, level = 'info') => events.push({ type: 'log', message, level }),
    chrome: {
      tabs: {
        create: async (payload) => {
          events.push({ type: 'tab-create', payload });
          return { id: payload.url === 'https://gpc.qlhazycoder.top/' ? 77 : 88, url: payload.url };
        },
        get: async () => null,
        query: async () => [],
        remove: async (tabId) => events.push({ type: 'tab-remove', tabId }),
        update: async (tabId, payload) => events.push({ type: 'tab-update', tabId, payload }),
      },
      scripting: {
        executeScript: async (details) => {
          events.push({ type: 'execute-script', target: details.target, args: details.args });
          const previous = {
            document: global.document,
            window: global.window,
            location: global.location,
            Event: global.Event,
          };
          global.document = dom.document;
          global.window = { getComputedStyle: (element) => element?.style || {} };
          global.location = { href: 'https://gpc.qlhazycoder.top/' };
          global.Event = class TestEvent { constructor(type) { this.type = type; } };
          try {
            return [{ result: details.func(...(details.args || [])) }];
          } finally {
            global.document = previous.document;
            global.window = previous.window;
            global.location = previous.location;
            global.Event = previous.Event;
          }
        },
      },
    },
    completeNodeFromBackground: async (step, payload) => events.push({ type: 'complete', step, payload }),
    createAutomationTab: async (payload) => {
      events.push({ type: 'automation-tab-create', payload });
      return { id: payload.url === 'https://gpc.qlhazycoder.top/' ? 77 : 88, url: payload.url };
    },
    ensureContentScriptReadyOnTabUntilStopped: async (source, tabId, options) => events.push({ type: 'ready', source, tabId, options }),
    queryTabsInAutomationWindow: async () => [],
    registerTab: async (source, tabId) => events.push({ type: 'register', source, tabId }),
    sendTabMessageUntilStopped: async (tabId, source, message) => {
      events.push({ type: 'tab-message', tabId, source, message });
      return { session, accessToken: session.accessToken };
    },
    setState: async (payload) => events.push({ type: 'set-state', payload }),
    sleepWithStop: async (ms) => events.push({ type: 'sleep', ms }),
    waitForTabCompleteUntilStopped: async (tabId) => events.push({ type: 'tab-complete', tabId }),
  });

  await executor.executePlusCheckoutCreate({
    plusPaymentMethod: 'gpc-helper',
    gpcCardKey: 'AAAA1111BBBB2222CCCC3333',
  });

  assert.equal(dom.cardModeButton.clicked, true);
  assert.deepEqual(dom.cardInputs.map((input) => input.value), ['AAAA1111', 'BBBB2222', 'CCCC3333']);
  assert.equal(dom.sessionTextarea.value, JSON.stringify(session));
  const sessionMessage = events.find((event) => event.type === 'tab-message');
  assert.deepEqual(sessionMessage.message.payload, {
    includeSession: true,
    includeAccessToken: true,
  });
  const executeEvent = events.find((event) => event.type === 'execute-script' && Array.isArray(event.args));
  assert.equal(executeEvent.target.tabId, 77);
  assert.equal(executeEvent.args[1], JSON.stringify(session));
  const chatGptTabCreate = events.find((event) => (
    event.type === 'automation-tab-create'
    && event.payload?.url === 'https://chatgpt.com/'
  ));
  assert.equal(chatGptTabCreate.payload.active, false);
  assert.equal(
    events.some((event) => event.type === 'tab-update' && event.tabId === 77 && event.payload?.active === true),
    true
  );
  const statePayload = events.find((event) => event.type === 'set-state')?.payload || {};
  assert.equal(statePayload.plusCheckoutTabId, 77);
  assert.equal(statePayload.plusCheckoutSource, 'gpc-helper');
  assert.equal(statePayload.gpcPageStatus, 'prepared');
  assert.equal(statePayload.gpcPageStatusText, '页面已准备');
  assert.equal(events.find((event) => event.type === 'complete')?.step, 'plus-checkout-create');
  assert.equal(events.find((event) => event.type === 'complete')?.payload?.plusCheckoutSource, 'gpc-helper');
});

test('GPC checkout prepare rejects missing card key before opening pages', async () => {
  const events = [];
  const executor = api.createPlusCheckoutCreateExecutor({
    addLog: async () => {},
    chrome: {
      tabs: {
        create: async () => {
          events.push({ type: 'tab-create' });
          throw new Error('should not open tab without card key');
        },
      },
      scripting: {
        executeScript: async () => {
          throw new Error('should not inject without card key');
        },
      },
    },
    completeNodeFromBackground: async () => {},
    createAutomationTab: async () => {
      events.push({ type: 'automation-tab-create' });
      throw new Error('should not open tab without card key');
    },
    ensureContentScriptReadyOnTabUntilStopped: async () => {},
    queryTabsInAutomationWindow: async () => [],
    registerTab: async () => {},
    sendTabMessageUntilStopped: async () => {},
    setState: async () => {},
    sleepWithStop: async () => {},
    waitForTabCompleteUntilStopped: async () => {},
  });

  await assert.rejects(
    () => executor.executePlusCheckoutCreate({
      plusPaymentMethod: 'gpc-helper',
      gpcCardKey: '',
    }),
    /缺少卡密/
  );
  assert.equal(events.length, 0);
});
