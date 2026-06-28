const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// Verify TEMP_MAIL_API_PROVIDER is destructured in fetch-signup-code.js (step4) deps
const step4Source = fs.readFileSync('flows/openai/background/steps/fetch-signup-code.js', 'utf8');
assert.ok(step4Source.includes('TEMP_MAIL_API_PROVIDER,'), 'step4 deps must include TEMP_MAIL_API_PROVIDER');
assert.ok(step4Source.includes('mail.provider === TEMP_MAIL_API_PROVIDER'), 'step4 must check mail.provider === TEMP_MAIL_API_PROVIDER');

// Verify TEMP_MAIL_API_PROVIDER is destructured in fetch-login-code.js (step8) deps
const step8Source = fs.readFileSync('flows/openai/background/steps/fetch-login-code.js', 'utf8');
assert.ok(step8Source.includes('TEMP_MAIL_API_PROVIDER,'), 'step8 deps must include TEMP_MAIL_API_PROVIDER');
assert.ok(step8Source.includes('mail.provider === TEMP_MAIL_API_PROVIDER'), 'step8 must check mail.provider === TEMP_MAIL_API_PROVIDER');

// Verify background.js passes TEMP_MAIL_API_PROVIDER into step4Executor and step8Executor
const bgSource = fs.readFileSync('background.js', 'utf8');
const step4Idx = bgSource.indexOf('step4Executor = self.MultiPageBackgroundStep4');
const step8Idx = bgSource.indexOf('step8Executor = self.MultiPageBackgroundStep8');
assert.ok(step4Idx > -1, 'step4Executor creation found in background.js');
assert.ok(step8Idx > -1, 'step8Executor creation found in background.js');

// Extract the deps block for each (from the opening { to the closing })
function extractDepsBlock(source, startIdx) {
  let depth = 0;
  let i = source.indexOf('{', startIdx);
  if (i === -1) return '';
  const start = i;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    if (depth === 0) return source.substring(start, i + 1);
  }
  return '';
}

const step4Deps = extractDepsBlock(bgSource, step4Idx);
const step8Deps = extractDepsBlock(bgSource, step8Idx);
assert.ok(step4Deps.includes('TEMP_MAIL_API_PROVIDER'), 'background.js step4Executor deps must pass TEMP_MAIL_API_PROVIDER');
assert.ok(step8Deps.includes('TEMP_MAIL_API_PROVIDER'), 'background.js step8Executor deps must pass TEMP_MAIL_API_PROVIDER');

// Verify no duplicate pollTempMailVerificationCode in verificationFlowHelpers deps
const vfIdx = bgSource.indexOf('verificationFlowHelpers = self.MultiPageBackgroundVerificationFlow');
assert.ok(vfIdx > -1, 'verificationFlowHelpers creation found');
const vfDeps = extractDepsBlock(bgSource, vfIdx);
const pollCount = (vfDeps.match(/pollTempMailVerificationCode/g) || []).length;
assert.equal(pollCount, 1, 'verificationFlowHelpers should have exactly 1 pollTempMailVerificationCode (no duplicates)');