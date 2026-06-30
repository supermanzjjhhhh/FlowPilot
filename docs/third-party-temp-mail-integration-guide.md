# 第三方临时邮箱集成指南

> 本文档为 FlowPilot 添加新的第三方临时邮箱服务提供者提供完整的集成路线图。
> 基于 	emp-mail-api（temp-mail.org）提供者的实现经验总结，覆盖所有必须修改的文件和检查点。

---

## 目录

1. [架构概览](#1-架构概览)
2. [集成清单](#2-集成清单)
3. [各文件详细说明](#3-各文件详细说明)
4. [验证码轮询参数调优](#4-验证码轮询参数调优)
5. [Cloudflare/反爬检测与降级策略](#5-cloudflare反爬检测与降级策略)
6. [测试要求](#6-测试要求)
7. [发布检查清单](#7-发布检查清单)
8. [现有提供者参考](#8-现有提供者参考)

---

## 1. 架构概览

FlowPilot 的临时邮箱体系分为 **三个层次**：

`
┌─────────────────────────────────────────────────────────┐
│  UI 层 (sidepanel/)                                     │
│  - 邮箱提供者选择、配置参数输入                           │
├─────────────────────────────────────────────────────────┤
│  调度层 (background.js)                                 │
│  - normalizeMailProvider：名称归一化                      │
│  - getMailProviderConfig：返回 content script 注入配置    │
│  - verification-flow.js：验证码轮询调度                  │
│  - mail-rule-registry.js：Flow 规则路由                  │
├─────────────────────────────────────────────────────────┤
│  提供者层                                                │
│  - *-utils.js：HTTP API 客户端（根目录）                  │
│  - background/*-provider.js：业务逻辑封装                │
│  - content/*-mail.js：页面 content script（如需）         │
│  - flows/*/mail-rules.js：Flow 级别的轮询参数覆盖         │
└─────────────────────────────────────────────────────────┘
`

**核心原则**：每个提供者是自包含模块，通过 deps 注入与调度层解耦。

---

## 2. 集成清单

添加新的第三方临时邮箱提供者时，**必须**修改以下文件：

| # | 文件 | 作用 | 必须 |
|---|------|------|------|
| 1 | <provider>-utils.js | API 客户端：会话创建、消息拉取、验证码提取 | ✅ 新建 |
| 2 | ackground/<provider>-provider.js | 业务封装：地址获取 + 验证码轮询 | ✅ 新建 |
| 3 | mail-provider-utils.js | 
ormalizeMailProvider switch 中注册 provider 标识 | ✅ 修改 |
| 4 | mail-provider-utils.js | getMailProviderConfig 中添加配置分支 | ✅ 修改 |
| 5 | ackground.js | 导入 provider 模块 + 连接到调度逻辑 | ✅ 修改 |
| 6 | ackground/verification-flow.js | 为新 provider 定制轮询参数 | ✅ 修改 |
| 7 | lows/*/mail-rules.js | 每个 Flow 的 mail-rules 添加轮询参数覆盖 | ✅ 修改 |
| 8 | 	ests/<provider>.test.js | 测试文件 | ✅ 新建 |
| 9 | sidepanel/ 相关 UI | 设置面板中添加 provider 选项和配置 UI | ✅ 修改 |
| 10 | content/<provider>-mail.js | 页面脚本（仅页面型 provider 需要） | ⬜ 条件 |

**可选修改**：

| # | 文件 | 作用 |
|---|------|------|
| 11 | ackground/mail-rule-registry.js | 注册全局 mail rule |
| 12 | sidepanel/<provider>-manager.js | 独立的 provider 管理面板 |

---

## 3. 各文件详细说明

### 3.1 <provider>-utils.js（根目录，新建）

这是 API 客户端模块，负责与第三方 HTTP API 通信。

**必须实现**（参考 	emp-mail-api-utils.js）：

`javascript
(function providerUtilsModule(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }
  root.YourProviderUtils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createYourProviderUtils() {
  const BASE_API = 'https://api.your-provider.com';

  // 1. 自定义错误类（如有反爬检测）
  class AntiBotBlockError extends Error {
    constructor(message) {
      super(message);
      this.name = 'AntiBotBlockError';
      this.isAntiBotBlock = true;
    }
  }

  // 2. API 客户端类
  class YourProviderClient {
    constructor(token, email) {
      this.token = token;
      this.email = email;
    }

    // 底层请求方法 —— 必须携带足够的请求头
    async _fetchApi(endpoint, method = 'GET', extraOptions = {}) {
      // 实现请求逻辑
      // 检查反爬拦截 → 抛出 AntiBotBlockError
      // 解析响应 JSON
    }

    // 验证码等待 —— 核心方法
    async waitForVerificationCode(codeRegex, optionsOrMaxRetries) {
      // 轮询消息列表
      // 提取验证码（bodyPreview / subject / 详情 fallback）
      // 返回 { code, fullText, sender } 或抛出 Timeout
    }

    // 换号（如支持）
    async changeMailbox() { /* ... */ }
  }

  // 3. 会话创建（模块入口）
  async function createSession() {
    // 返回 YourProviderClient 实例
  }

  // 4. Token 恢复（如支持）
  function fromToken(token) {
    // 从已有 token 恢复客户端
  }

  return { YourProviderClient, createSession, fromToken };
});
`

**关键要点**：
- 使用 IIFE + UMD 包装，同时支持浏览器和 Node.js 测试环境
- Client 类必须暴露给测试（return 中导出）
- waitForVerificationCode 的返回格式必须包含 { code, fullText, sender }
- 反爬检测错误应有独立类型（isAntiBotBlock = true）以便上层区分处理
- JWT 解码注意 base64url 兼容：aw.replace(/-/g, '+').replace(/_/g, '/')

---

### 3.2 ackground/<provider>-provider.js（新建）

业务逻辑封装，暴露两个核心函数：

`javascript
function createYourProviderProvider(deps = {}) {
  const {
    addLog,
    getState,
    setState,
    sleepWithStop,
    throwIfStopped,
    YOUR_PROVIDER_CONSTANT = 'your-provider',
  } = deps;

  let currentClient = null;

  async function ensureYourProviderAddress(options = {}) {
    // 1. 优先恢复缓存的 token/邮箱
    // 2. 缓存不存在 → 调用 createSession()
    // 3. options.generateNew → 调用 changeMailbox()
    // 4. 持久化邮箱到 state
    // 5. 返回邮箱地址字符串
  }

  async function pollYourProviderVerificationCode(step, state, pollPayload) {
    // 1. 取出 pollPayload 中的参数
    // 2. 调用 client.waitForVerificationCode()
    // 3. 返回 { ok, code, emailTimestamp, mailId }
  }

  return { ensureYourProviderAddress, pollYourProviderVerificationCode };
}
`

**关键要点**：
- 两个函数签名必须与其他 provider 一致（ensure*Address + poll*VerificationCode）
- deps 注入风格与现有 provider 保持一致
- pollPayload 参数来自 erification-flow.js 和 mail-rules.js

---

### 3.3 mail-provider-utils.js（修改）

#### 3.3.1 
ormalizeMailProvider — 注册标识

`javascript
function normalizeMailProvider(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  switch (normalized) {
    case HOTMAIL_PROVIDER:
    case TEMP_MAIL_API_PROVIDER:
    case YYDS_MAIL_PROVIDER:
    case 'your-provider':    // ← 添加这一行
      return normalized;
    default:
      return '163';
  }
}
`

#### 3.3.2 getMailProviderConfig — 返回 content script 配置

对于 **API 型** provider（如 temp-mail-api），不需要 content script：

`javascript
if (provider === 'your-provider') {
  return {
    source: 'your-provider-api',
    label: 'Your Provider 邮箱（API）',
    navigateOnReuse: false,   // 无需打开网页
    inject: [],               // 无需 content script
    injectSource: null,
  };
}
`

对于 **页面型** provider（需打开网页邮箱）：

`javascript
if (provider === 'your-page-provider') {
  return {
    source: 'your-page-provider-mail',
    url: 'https://your-provider.com/inbox',
    label: 'Your Page Provider 邮箱',
    navigateOnReuse: true,
    inject: ['content/activation-utils.js', 'content/utils.js', 'content/your-provider-mail.js'],
    injectSource: 'your-provider-mail',
  };
}
`

---

### 3.4 ackground.js（修改）

需要修改 **至少 4 处**：

1. **常量定义**：添加 const YOUR_PROVIDER = 'your-provider';

2. **
ormalizeMailProvider 的 switch**：添加 case

3. **provider 标签映射**（如 getMailProviderLabel）：
   `javascript
   if (provider === YOUR_PROVIDER) {
     return { provider: YOUR_PROVIDER, label: 'Your Provider 邮箱' };
   }
   `

4. **ensure*Address 和 poll*VerificationCode 的分发调用**：
   `javascript
   if (requestedMailProvider === YOUR_PROVIDER) {
     email = await yourProviderModule.ensureYourProviderAddress({ generateNew });
   }
   // ...
   if (provider === YOUR_PROVIDER) {
     return yourProviderModule.pollYourProviderVerificationCode(step, state, pollPayload);
   }
   `

5. **可选：消息处理器**（如需 sidepanel 读取 provider 状态）：
   `javascript
   if (message.type === 'GET_YOUR_PROVIDER_TOKEN') {
     chrome.storage.local.get(['yourProviderToken']).then(sendResponse);
     return true;
   }
   `

---

### 3.5 ackground/verification-flow.js（修改）

为新的 provider 定制轮询参数：

`javascript
function getVerificationPollPayload(step, state = {}, overrides = {}) {
  const isYourProvider = state?.mailProvider === YOUR_PROVIDER;
  // ...
  return {
    maxAttempts: is2925Provider
      ? MAIL_2925_VERIFICATION_MAX_ATTEMPTS
      : (isYourProvider ? 20 : (isTempMailApi ? 20 : 5)),  // ← 按需设置
    intervalMs: is2925Provider
      ? MAIL_2925_VERIFICATION_INTERVAL_MS
      : (isYourProvider ? 5000 : (isTempMailApi ? 5000 : 3000)),  // ← 按需设置
    ...overrides,
  };
}
`

**参数参考**：

| Provider | maxAttempts | intervalMs | 说明 |
|----------|-------------|------------|------|
| 2925 | 15 | 15000 | 邮件延迟高 |
| temp-mail-api | 20 | 5000 | Cloudflare 可能导致延迟 |
| hotmail | 5 | 3000 | 通常较快 |
| 默认 | 5 | 3000 | 兜底 |

根据新 provider 的实测送达时间设置合适的值。

---

### 3.6 lows/*/mail-rules.js（修改）

每个 Flow（如 lows/openai/mail-rules.js）的 getRuleDefinition 中需要同样的分支：

`javascript
function getRuleDefinition(stepIndex, state) {
  // ...
  const yourProviderProvider = isYourProviderProvider(state);
  return {
    maxAttempts: mail2925Provider
      ? MAIL_2925_VERIFICATION_MAX_ATTEMPTS
      : (yourProviderProvider ? 20 : (tempMailApiProvider ? 20 : 5)),
    intervalMs: mail2925Provider
      ? MAIL_2925_VERIFICATION_INTERVAL_MS
      : (yourProviderProvider ? 5000 : (tempMailApiProvider ? 5000 : 3000)),
  };
}
`

**注意**：目前每个 Flow 的 mail-rules 有自己的一套分支逻辑，需逐一修改。

---

### 3.7 sidepanel/ UI 修改

1. **邮箱选择下拉**中添加新 provider 选项
2. 如需配置参数（如 API Key、BaseUrl），添加对应的设置面板
3. 如需管理面板，创建 sidepanel/<provider>-manager.js

---

### 3.8 content/<provider>-mail.js（条件新建）

仅当 provider 需要在网页邮箱中通过 content script 提取验证码时才需要。

参考 content/qq-mail.js、content/mail-163.js。

API 型 provider **不需要**此文件。

---

## 4. 验证码轮询参数调优

### 4.1 决策框架

`
实测端到端送达时间 → 决定 intervalMs
  送达 < 5s    → intervalMs = 2000~3000
  送达 5~10s   → intervalMs = 3000~5000
  送达 > 10s   → intervalMs = 5000~8000

送达稳定性 → 决定 maxAttempts
  非常稳定   → maxAttempts = 10
  偶有延迟   → maxAttempts = 15~20
  不确定     → maxAttempts = 20~30
`

### 4.2 参数配置位置

轮询参数在 **两个位置** 定义，必须同步修改：

1. ackground/verification-flow.js → getVerificationPollPayload()
2. lows/*/mail-rules.js → getRuleDefinition()

两处的逻辑应当一致。

---

## 5. Cloudflare/反爬检测与降级策略

### 5.1 检测方式

第三方邮箱服务普遍使用 Cloudflare 等反爬机制。检测方法：

`javascript
// 1. HTTP 状态码 + Content-Type 检查
const contentType = (res.headers.get('content-type') || '').toLowerCase();
if (!contentType.includes('json') && res.status === 403) {
  throw new AntiBotBlockError('API 被反爬拦截');
}

// 2. 响应体关键词检测
const text = await res.text();
if (text.includes('cloudflare') || text.includes('Attention Required')) {
  throw new AntiBotBlockError('API Cloudflare 拦截');
}
`

### 5.2 降级策略（参考 temp-mail-api 的三级降级）

`
策略1：API 直接拉取消息列表
  ↓ 被 CF 拦截
策略2：消息详情页 API（/messages/:id）
  ↓ 也被 CF 拦截
策略3：通过已打开的 Tab 页面注入 fetch 请求
  （chrome.scripting.executeScript 在 temp-mail.org tab 中执行）
`

### 5.3 Tab 页面注入模式

当 API 直连被全面拦截时，可通过背景脚本注入到已打开的 provider 页面中执行 fetch：

`javascript
async _fetchViaPage(messageId) {
  const [tab] = await chrome.tabs.query({ url: '*://your-provider.com/*' });
  if (!tab) throw new Error('未找到已打开的 your-provider.com 页面');

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (token, msgId) => {
      return fetch('/api/messages/' + msgId, {
        headers: { 'Authorization': 'Bearer ' + token }
      }).then(r => r.json()).then(d => ({ status: 200, body: JSON.stringify(d) }))
        .catch(e => ({ error: e.message }));
    },
    args: [this.token, messageId],
  });

  const result = results?.[0]?.result;
  if (result?.error) throw new Error('页面API请求失败: ' + result.error);
  return result;
}
`

---

## 6. 测试要求

### 6.1 必须覆盖的测试点

1. **utils 模块**：
   - createSession 返回有效 client
   - waitForVerificationCode 在有验证码邮件时正确提取
   - waitForVerificationCode 超时抛出 Error
   - 反爬拦截时抛出特定错误类型
   - base64url JWT 解码兼容性

2. **provider 模块**：
   - ensureAddress 优先使用缓存
   - ensureAddress({ generateNew: true }) 重新获取
   - pollVerificationCode 正确传递 pollPayload 参数

3. **mail-rules / verification-flow**：
   - 新 provider 的 maxAttempts 和 intervalMs 配置正确
   - 非 provider 使用默认值

### 6.2 测试文件模板

`javascript
// tests/your-provider.test.js
const { describe, it } = require('node:test');
const assert = require('assert');

// 测试 utils 模块（Node.js 环境）
const { YourProviderClient } = require('./your-provider-utils.js');

test('YourProviderClient extracts verification code from bodyPreview', () => {
  // 模拟消息列表
  const client = new YourProviderClient('fake-token', 'test@example.com');
  // mock _fetchApi 返回带验证码的消息
  // 断言提取结果
});

test('Mail rules configures your-provider polling correctly', () => {
  const fs = require('fs');
  const source = fs.readFileSync('flows/openai/mail-rules.js', 'utf8');
  const globalScope = {};
  new Function('self', ${source};)(globalScope);
  const rulesFactory = globalScope.MultiPageOpenAiMailRules.createOpenAiMailRules({
    getHotmailVerificationRequestTimestamp: () => 0,
    MAIL_2925_VERIFICATION_INTERVAL_MS: 15000,
    MAIL_2925_VERIFICATION_MAX_ATTEMPTS: 15,
  });

  const state = { mailProvider: 'your-provider', email: 'test@example.com' };
  const payload = rulesFactory.getRuleDefinition(4, state);
  assert.equal(payload.maxAttempts, 20);
  assert.equal(payload.intervalMs, 5000);
});
`

### 6.3 运行命令

`powershell
npm test
# 或单独运行
node --test tests/your-provider.test.js
`

---

## 7. 发布检查清单

- [ ] <provider>-utils.js 实现完整，通过单元测试
- [ ] ackground/<provider>-provider.js 实现完整
- [ ] mail-provider-utils.js 中 
ormalizeMailProvider 注册了新标识
- [ ] mail-provider-utils.js 中 getMailProviderConfig 有新分支
- [ ] ackground.js 中常量定义 + switch + 分发逻辑 + 标签映射
- [ ] ackground/verification-flow.js 中轮询参数配置
- [ ] 所有 lows/*/mail-rules.js 中轮询参数配置
- [ ] sidepanel/ UI 中有新 provider 选项和配置入口
- [ ] 	ests/<provider>.test.js 测试通过
- [ ] 
pm test 全套测试通过
- [ ] 手动端到端测试：注册流程中使用新 provider 完成验证码接收

---

## 8. 现有提供者参考

| Provider | 标识 | 类型 | API 文档 | 关键文件 |
|----------|------|------|----------|----------|
| Hotmail | hotmail-api | 混合 | Microsoft Graph | hotmail-utils.js |
| 2925邮箱 | mail2925 | 页面 | — | mail2925-utils.js, content/mail-2925.js |
| Temp-Mail.org | 	emp-mail-api | API | docs/temp-mail-api-design.md | 	emp-mail-api-utils.js, ackground/temp-mail-provider.js |
| YYDS Mail | yyds-mail | API | — | yyds-mail-utils.js, ackground/yyds-mail-provider.js |
| Cloudflare Temp Email | cloudflare-temp-email | API | — | cloudflare-temp-email-utils.js, ackground/cloudflare-temp-email-provider.js (内联) |
| CloudMail | cloudmail | API | — | cloudmail-utils.js, ackground/cloudmail-provider.js |
| LuckMail | luckmail | API | — | luckmail-utils.js |

选择一个与你要集成的服务最接近的已有 provider 作为参考模板。

---

## 修订历史

| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| V1 | 2026-06-30 | FlowPilot | 基于 temp-mail-api 集成经验，提炼通用集成指南 |
