const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('flows/openai/content/openai-auth.js', 'utf8');

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
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') {
      parenDepth += 1;
    } else if (char === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnded = true;
      }
    } else if (char === '{' && signatureEnded) {
      braceStart = index;
      break;
    }
  }
  if (braceStart < 0) {
    throw new Error(`missing body for function ${name}`);
  }

  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end += 1) {
    const char = source[end];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return source.slice(start, end);
}

function extractConst(name) {
  const pattern = new RegExp(`const\\s+${name}\\s*=\\s*[\\s\\S]*?;`);
  const match = source.match(pattern);
  if (!match) {
    throw new Error(`missing const ${name}`);
  }
  return match[0];
}

test('password submit treats direct OAuth consent as a login-code skip', async () => {
  const api = new Function(`
const location = { href: 'https://auth.openai.com/authorize' };

function inspectLoginAuthState() {
  return {
    state: 'oauth_consent_page',
    url: location.href,
  };
}

function throwIfStopped() {}
async function sleep() {
  throw new Error('should not wait once oauth consent is detected');
}

${extractFunction('createStep6SuccessResult')}
${extractFunction('createStep6OAuthConsentSuccessResult')}
${extractFunction('createStep6RecoverableResult')}
${extractFunction('normalizeStep6Snapshot')}
${extractFunction('getStep6OptionMessage')}
${extractFunction('resolveStep6PostSubmitSnapshot')}
${extractFunction('waitForStep6PostSubmitTransition')}
${extractFunction('waitForStep6PasswordSubmitTransition')}

return {
  run() {
    return waitForStep6PasswordSubmitTransition(123, 1000);
  },
};
`)();

  const transition = await api.run();

  assert.equal(transition.action, 'done');
  assert.equal(transition.result.state, 'oauth_consent_page');
  assert.equal(transition.result.skipLoginVerificationStep, true);
  assert.equal(transition.result.directOAuthConsentPage, true);
  assert.equal(transition.result.loginVerificationRequestedAt, null);
});

test('step 7 entry succeeds when the auth page is already on OAuth consent', async () => {
  const logs = [];
  const api = new Function(`
const location = { href: 'https://auth.openai.com/authorize' };
const logs = arguments[0];

function inspectLoginAuthState() {
  return {
    state: 'oauth_consent_page',
    url: location.href,
  };
}

function throwIfStopped() {}
async function sleep() {}
function log(message, level = 'info') {
  logs.push({ message, level });
}

${extractFunction('createStep6SuccessResult')}
${extractFunction('createStep6OAuthConsentSuccessResult')}
${extractFunction('normalizeStep6Snapshot')}
${extractFunction('waitForKnownLoginAuthState')}
${extractFunction('step6_login')}

return {
  run() {
    return step6_login({ email: 'user@example.com' });
  },
};
`)(logs);

  const result = await api.run();

  assert.equal(result.step6Outcome, 'success');
  assert.equal(result.state, 'oauth_consent_page');
  assert.equal(result.skipLoginVerificationStep, true);
  assert.equal(result.directOAuthConsentPage, true);
  assert.equal(logs.some(({ level }) => level === 'ok'), true);
});

test('step 7 clicks matching choose-account card and skips login code after OAuth consent', async () => {
  const api = new Function(`
let pageState = 'choose_account_page';
const clicked = [];
const location = {
  href: 'https://auth.openai.com/choose-an-account',
  pathname: '/choose-an-account',
};
const targetCard = {
  id: 'target-card',
  textContent: 'Tall Slept Fancy tall-slept-fancy@duck.com',
  value: '',
  parentElement: null,
  disabled: false,
  getAttribute(name) {
    if (name === 'role') return 'button';
    if (name === 'aria-disabled') return 'false';
    return '';
  },
  closest() {
    return null;
  },
};
const removeButton = {
  id: 'remove-button',
  textContent: '',
  value: '',
  parentElement: targetCard,
  disabled: false,
  getAttribute(name) {
    if (name === 'aria-label') return 'Remove tall-slept-fancy@duck.com';
    if (name === 'aria-disabled') return 'false';
    return '';
  },
  closest() {
    return null;
  },
};
const otherCard = {
  id: 'other-card',
  textContent: 'Other User other@example.com',
  value: '',
  parentElement: null,
  disabled: false,
  getAttribute(name) {
    if (name === 'role') return 'button';
    if (name === 'aria-disabled') return 'false';
    return '';
  },
  closest() {
    return null;
  },
};

const document = {
  body: {
    innerText: 'Welcome back Choose an account tall-slept-fancy@duck.com other@example.com',
    textContent: 'Welcome back Choose an account tall-slept-fancy@duck.com other@example.com',
  },
  querySelectorAll(selector) {
    if (String(selector).includes('body *')) return [removeButton, targetCard, otherCard];
    return [removeButton, targetCard, otherCard];
  },
};

function getOperationDelayRunner() {
  return async (_metadata, operation) => operation();
}
function isVisibleElement(element) {
  return Boolean(element);
}
function isActionEnabled(element) {
  return Boolean(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true';
}
function simulateClick(element) {
  clicked.push(element.id);
  if (element === targetCard) {
    pageState = 'oauth_consent_page';
    location.href = 'https://auth.openai.com/sign-in-with-chatgpt/codex/consent';
    location.pathname = '/sign-in-with-chatgpt/codex/consent';
  }
}
function inspectLoginAuthState() {
  return { state: pageState, url: location.href, chooseAccountPage: pageState === 'choose_account_page' };
}
function throwIfStopped() {}
async function sleep() {}
async function humanPause() {}
function log() {}
async function finalizeStep6VerificationReady() { return { routed: 'verification' }; }
async function step6LoginFromPasswordPage() { return { routed: 'password' }; }
async function step6LoginFromEmailPage() { return { routed: 'email' }; }
async function step6LoginFromPhonePage() { return { routed: 'phone' }; }
async function createStep6LoginTimeoutRecoveryTransition() { return { action: 'recoverable', result: { routed: 'timeout' } }; }

${extractConst('CHOOSE_ACCOUNT_PAGE_PATTERN')}
${extractConst('CHOOSE_ACCOUNT_REMOVE_ACTION_PATTERN')}
${extractConst('CHOOSE_ACCOUNT_OTHER_ACCOUNT_PATTERN')}
${extractConst('CHOOSE_ACCOUNT_ACTION_SELECTOR')}
${extractFunction('getPageTextSnapshot')}
${extractFunction('normalizeAuthAccountIdentifier')}
${extractFunction('getChooseAccountCandidateText')}
${extractFunction('isChooseAccountPage')}
${extractFunction('isChooseAccountRemovalAction')}
${extractFunction('resolveChooseAccountClickTarget')}
${extractFunction('findChooseAccountButtonForEmail')}
${extractFunction('createStep6SuccessResult')}
${extractFunction('createStep6OAuthConsentSuccessResult')}
${extractFunction('createStep6AddEmailSuccessResult')}
${extractFunction('createStep6RecoverableResult')}
${extractFunction('normalizeStep6Snapshot')}
${extractFunction('isOpenAiOAuthAuthorizationRoute')}
${extractFunction('isPostChooseAccountOAuthRoute')}
${extractFunction('waitForChooseAccountTransition')}
${extractFunction('step6ChooseExistingAccount')}

return {
  clicked,
  run() {
    return step6ChooseExistingAccount(
      { email: 'TALL-SLEPT-FANCY@DUCK.COM', loginIdentifierType: 'email', visibleStep: 7 },
      { state: 'choose_account_page', url: location.href }
    );
  },
};
`)();

  const result = await api.run();

  assert.deepEqual(api.clicked, ['target-card']);
  assert.equal(result.step6Outcome, 'success');
  assert.equal(result.state, 'oauth_consent_page');
  assert.equal(result.skipLoginVerificationStep, true);
  assert.equal(result.directOAuthConsentPage, true);
  assert.equal(result.via, 'choose_account_oauth_consent_page');
});

test('step 7 skips login code when choose-account leaves for OAuth authorize route before consent DOM is ready', async () => {
  const api = new Function(`
let pageState = 'choose_account_page';
const clicked = [];
const location = {
  href: 'https://auth.openai.com/choose-an-account',
  pathname: '/choose-an-account',
};
const targetCard = {
  id: 'target-card',
  textContent: 'Tall Slept Fancy tall-slept-fancy@duck.com',
  value: '',
  parentElement: null,
  disabled: false,
  getAttribute(name) {
    if (name === 'role') return 'button';
    if (name === 'aria-disabled') return 'false';
    return '';
  },
  closest() {
    return null;
  },
};

const document = {
  body: {
    innerText: 'Welcome back Choose an account tall-slept-fancy@duck.com',
    textContent: 'Welcome back Choose an account tall-slept-fancy@duck.com',
  },
  querySelectorAll(selector) {
    if (String(selector).includes('body *')) return [targetCard];
    return [targetCard];
  },
};

function getOperationDelayRunner() {
  return async (_metadata, operation) => operation();
}
function isVisibleElement(element) {
  return Boolean(element);
}
function isActionEnabled(element) {
  return Boolean(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true';
}
function simulateClick(element) {
  clicked.push(element.id);
  if (element === targetCard) {
    pageState = 'unknown';
    location.href = 'https://auth.openai.com/authorize?client_id=codex-test&state=oauth-state';
    location.pathname = '/authorize';
  }
}
function inspectLoginAuthState() {
  return { state: pageState, url: location.href, chooseAccountPage: pageState === 'choose_account_page' };
}
function throwIfStopped() {}
async function sleep() {}
async function humanPause() {}
function log() {}
async function finalizeStep6VerificationReady() { return { routed: 'verification' }; }
async function step6LoginFromPasswordPage() { return { routed: 'password' }; }
async function step6LoginFromEmailPage() { return { routed: 'email' }; }
async function step6LoginFromPhonePage() { return { routed: 'phone' }; }
async function createStep6LoginTimeoutRecoveryTransition() { return { action: 'recoverable', result: { routed: 'timeout' } }; }

${extractConst('CHOOSE_ACCOUNT_PAGE_PATTERN')}
${extractConst('CHOOSE_ACCOUNT_REMOVE_ACTION_PATTERN')}
${extractConst('CHOOSE_ACCOUNT_OTHER_ACCOUNT_PATTERN')}
${extractConst('CHOOSE_ACCOUNT_ACTION_SELECTOR')}
${extractFunction('getPageTextSnapshot')}
${extractFunction('normalizeAuthAccountIdentifier')}
${extractFunction('getChooseAccountCandidateText')}
${extractFunction('isChooseAccountPage')}
${extractFunction('isChooseAccountRemovalAction')}
${extractFunction('resolveChooseAccountClickTarget')}
${extractFunction('findChooseAccountButtonForEmail')}
${extractFunction('createStep6SuccessResult')}
${extractFunction('createStep6OAuthConsentSuccessResult')}
${extractFunction('createStep6AddEmailSuccessResult')}
${extractFunction('createStep6RecoverableResult')}
${extractFunction('normalizeStep6Snapshot')}
${extractFunction('isOpenAiOAuthAuthorizationRoute')}
${extractFunction('isPostChooseAccountOAuthRoute')}
${extractFunction('waitForChooseAccountTransition')}
${extractFunction('step6ChooseExistingAccount')}

return {
  clicked,
  run() {
    return step6ChooseExistingAccount(
      { email: 'tall-slept-fancy@duck.com', loginIdentifierType: 'email', visibleStep: 7 },
      { state: 'choose_account_page', url: location.href }
    );
  },
};
`)();

  const result = await api.run();

  assert.deepEqual(api.clicked, ['target-card']);
  assert.equal(result.step6Outcome, 'success');
  assert.equal(result.state, 'unknown');
  assert.equal(result.skipLoginVerificationStep, true);
  assert.equal(result.directOAuthConsentPage, true);
  assert.equal(result.via, 'choose_account_oauth_authorization_route');
});

test('step 7 does not click choose-account page when target email is missing', async () => {
  const api = new Function(`
const clicked = [];
const location = {
  href: 'https://auth.openai.com/choose-an-account',
  pathname: '/choose-an-account',
};
const otherCard = {
  id: 'other-card',
  textContent: 'Other User other@example.com',
  value: '',
  parentElement: null,
  disabled: false,
  getAttribute(name) {
    if (name === 'role') return 'button';
    if (name === 'aria-disabled') return 'false';
    return '';
  },
  closest() {
    return null;
  },
};
const document = {
  body: {
    innerText: 'Welcome back Choose an account other@example.com',
    textContent: 'Welcome back Choose an account other@example.com',
  },
  querySelectorAll() {
    return [otherCard];
  },
};

function getOperationDelayRunner() {
  return async (_metadata, operation) => operation();
}
function isVisibleElement(element) {
  return Boolean(element);
}
function isActionEnabled(element) {
  return Boolean(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true';
}
function simulateClick(element) {
  clicked.push(element.id);
}
function inspectLoginAuthState() {
  return { state: 'choose_account_page', url: location.href, chooseAccountPage: true };
}
function throwIfStopped() {}
async function sleep() {}
async function humanPause() {}
function log() {}
async function finalizeStep6VerificationReady() { return { routed: 'verification' }; }
async function step6LoginFromPasswordPage() { return { routed: 'password' }; }
async function step6LoginFromEmailPage() { return { routed: 'email' }; }
async function step6LoginFromPhonePage() { return { routed: 'phone' }; }
async function createStep6LoginTimeoutRecoveryTransition() { return { action: 'recoverable', result: { routed: 'timeout' } }; }

${extractConst('CHOOSE_ACCOUNT_PAGE_PATTERN')}
${extractConst('CHOOSE_ACCOUNT_REMOVE_ACTION_PATTERN')}
${extractConst('CHOOSE_ACCOUNT_OTHER_ACCOUNT_PATTERN')}
${extractConst('CHOOSE_ACCOUNT_ACTION_SELECTOR')}
${extractFunction('getPageTextSnapshot')}
${extractFunction('normalizeAuthAccountIdentifier')}
${extractFunction('getChooseAccountCandidateText')}
${extractFunction('isChooseAccountPage')}
${extractFunction('isChooseAccountRemovalAction')}
${extractFunction('resolveChooseAccountClickTarget')}
${extractFunction('findChooseAccountButtonForEmail')}
${extractFunction('createStep6SuccessResult')}
${extractFunction('createStep6OAuthConsentSuccessResult')}
${extractFunction('createStep6AddEmailSuccessResult')}
${extractFunction('createStep6RecoverableResult')}
${extractFunction('normalizeStep6Snapshot')}
${extractFunction('isOpenAiOAuthAuthorizationRoute')}
${extractFunction('isPostChooseAccountOAuthRoute')}
${extractFunction('waitForChooseAccountTransition')}
${extractFunction('step6ChooseExistingAccount')}

return {
  clicked,
  run() {
    return step6ChooseExistingAccount(
      { email: 'target@example.com', loginIdentifierType: 'email', visibleStep: 7 },
      { state: 'choose_account_page', url: location.href }
    );
  },
};
`)();

  const result = await api.run();

  assert.deepEqual(api.clicked, []);
  assert.equal(result.step6Outcome, 'recoverable');
  assert.equal(result.reason, 'choose_account_target_not_found');
});
