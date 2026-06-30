(function tempMailApiUtilsModule(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }
  root.TempMailApiUtils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createTempMailApiUtils() {
  
  const BASE_API = 'https://web2.temp-mail.org';

  class CloudflareBlockError extends Error {
    constructor(message) {
      super(message);
      this.name = 'CloudflareBlockError';
      this.isCloudflareBlock = true;
    }
  }

  class TempMailClient {
    constructor(token, email) {
      this.token = token;
      this.email = email;
    }

    async _fetchApi(endpoint, method = 'GET', extraOptions = {}) {
      const url = BASE_API + endpoint;
      const headers = {
        'Authorization': 'Bearer ' + this.token,
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://temp-mail.org',
        'Referer': 'https://temp-mail.org/'
      };
      if (method === 'POST' || method === 'PUT') {
        headers['Content-Type'] = 'application/json';
      }
      const res = await fetch(url, {
        method,
        headers,
        credentials: extraOptions.includeCredentials ? 'include' : 'same-origin',
      });
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (text.includes('cloudflare') || text.includes('Attention Required') || (!contentType.includes('json') && res.status === 403)) {
          throw new CloudflareBlockError('TempMail API 被 Cloudflare 拦截: ' + endpoint);
        }
        throw new Error('TempMail API Error: ' + res.status + ' for ' + endpoint);
      }
      if (contentType.includes('json')) {
        return await res.json().catch(() => ({}));
      }
      return await res.text().catch(() => '');
    }

    async getMessageDetail(messageId) {
      return await this._fetchApi('/messages/' + messageId, 'GET');
    }

    async getMessageBody(messageId) {
      return await this._fetchApi('/messages/' + messageId + '/body', 'GET');
    }

    // 通过已加载的 temp-mail.org 页面（有 CF cookie）的 fetch 来获取消息详情
    async getMessageDetailViaPage(messageId) {
      const isExtension = typeof chrome !== 'undefined' && chrome.scripting;
      if (!isExtension) {
        throw new Error('不在扩展环境中，无法通过页面获取消息详情');
      }
      // 查找已打开 temp-mail.org 的标签页
      const tabs = await chrome.tabs.query({ url: 'https://temp-mail.org/*' });
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        throw new Error('未找到已打开的 temp-mail.org 标签页，请先打开 https://temp-mail.org/');
      }
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'ISOLATED',
        func: async (token, msgId) => {
          try {
            const res = await fetch('https://web2.temp-mail.org/messages/' + msgId, {
              method: 'GET',
              headers: {
                'Authorization': 'Bearer ' + token,
                'Accept': 'application/json, text/plain, */*',
                'Origin': 'https://temp-mail.org',
                'Referer': 'https://temp-mail.org/'
              },
              credentials: 'include',
            });
            if (!res.ok) {
              const text = await res.text().catch(() => '');
              return { error: 'HTTP ' + res.status, body: text.substring(0, 200) };
            }
            return await res.json();
          } catch (err) {
            return { error: err.message };
          }
        },
        args: [this.token, messageId],
      });
      const result = results && results[0] && results[0].result;
      if (!result) throw new Error('页面注入执行未返回结果');
      if (result.error) throw new Error('页面API请求失败: ' + result.error + ' ' + (result.body || ''));
      return result;
    }

    async waitForVerificationCode(codeRegex = /\b\d{4,6}\b/, optionsOrMaxRetries = 20) {
      const options = typeof optionsOrMaxRetries === 'number'
        ? { maxRetries: optionsOrMaxRetries }
        : (optionsOrMaxRetries || {});
      const maxRetries = options.maxRetries ?? 20;
      const intervalMs = options.intervalMs ?? 3000;
      const onProgress = options.onProgress;
      for (let i = 0; i < maxRetries; i++) {
        try {
          const response = await this._fetchApi('/messages', 'GET');
          const messages = Array.isArray(response) ? response : (response.messages || []);

          if (messages.length > 0) {
            for (const msg of messages) {
              const textContent = String(msg.bodyPreview || msg.subject || '').replace(/\s+/g, ' ');
              const match = textContent.match(codeRegex);
              if (match) {
                return {
                  code: match[0],
                  fullText: textContent,
                  sender: msg.from
                };
              }
            }

            // bodyPreview 中没有匹配到验证码，尝试获取消息详情
            for (const msg of messages) {
              if (!msg._id) continue;
              try {
                // 策略1: 直接调用 /messages/:id（可能返回 JSON 或 HTML 格式的邮件正文）
                const detail = await this.getMessageDetail(msg._id);
                let detailText = '';
                if (typeof detail === 'string') {
                  // 详情 API 返回了纯文本/HTML → 先剥离 HTML 标签避免 CSS 颜色值等误匹配
                  detailText = detail.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
                } else if (detail && (detail.bodyPreview || detail.body || detail.text || detail.html)) {
                  const raw = String(detail.bodyPreview || detail.body || detail.text || detail.html || '');
                  // body/html 字段可能包含 HTML 标签，剥离后匹配
                  detailText = raw.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
                }
                if (detailText) {
                  const match = detailText.match(codeRegex);
                  if (match) {
                    return {
                      code: match[0],
                      fullText: detailText,
                      sender: detail.from || msg.from
                    };
                  }
                }
              } catch (detailErr) {
                if (detailErr.isCloudflareBlock) {
                  // 策略2: 消息详情被 CF 拦截，尝试 /messages/:id/body
                  try {
                    const bodyDetail = await this.getMessageBody(msg._id);
                    if (bodyDetail) {
                      const bodyRaw = String(typeof bodyDetail === 'string' ? bodyDetail : (bodyDetail.text || bodyDetail.html || ''));
                      const bodyText = bodyRaw.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
                      const match = bodyText.match(codeRegex);
                      if (match) {
                        return {
                          code: match[0],
                          fullText: bodyText,
                          sender: msg.from
                        };
                      }
                    }
                  } catch (_) {}

                  // 策略3: 通过已加载的 temp-mail.org 页面（有 CF cookie）获取详情
                  try {
                    const pageDetail = await this.getMessageDetailViaPage(msg._id);
                    if (pageDetail) {
                      const pageRaw = String(pageDetail.bodyPreview || pageDetail.body || pageDetail.text || pageDetail.html || '');
                      const pageText = pageRaw.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
                      const match = pageText.match(codeRegex);
                      if (match) {
                        return {
                          code: match[0],
                          fullText: pageText,
                          sender: pageDetail.from || msg.from
                        };
                      }
                    }
                  } catch (pageErr) {
                    if (!pageErr.message.includes('未找到已打开的 temp-mail.org')) {
                      console.warn('TempMail page detail fallback error:', pageErr.message);
                    }
                  }
                }
              }
            }
          }
          if (onProgress) onProgress(i + 1, maxRetries, messages, null);
        } catch (err) {
          if (err.isCloudflareBlock) {
            console.warn('TempMail API Cloudflare block detected, waiting before retry...', err.message);
          } else {
            console.warn('TempMail poll error:', err.message);
          }
          if (onProgress) onProgress(i + 1, maxRetries, null, err);
        }
        if (i < maxRetries - 1) {
          if (options.sleepFn) {
            await options.sleepFn(intervalMs);
          } else {
            await new Promise(resolve => setTimeout(resolve, intervalMs));
          }
        }
      }
      throw new Error('Timeout: 未能在指定时间内收到包含验证码的邮件。');
    }

    async changeMailbox() {
      const response = await this._fetchApi('/mailbox', 'POST');
      if (response && response.token) {
        this.token = response.token;
        this.email = response.mailbox || this._parseEmailFromToken(this.token);
        return this.email;
      }
      throw new Error('Failed to change mailbox.');
    }

    _parseEmailFromToken(jwt) {
      try {
        const raw = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(raw));
        return payload.mailbox;
      } catch (e) {
        return null;
      }
    }
  }

  return {
    TempMailClient, // 暴露给测试用
    async createSession() {
      const res = await fetch(BASE_API + '/mailbox', {
        method: 'POST',
        headers: { 'Accept': 'application/json, text/plain, */*', 'Content-Type': 'application/json', 'Origin': 'https://temp-mail.org', 'Referer': 'https://temp-mail.org/' }
      });
      if (!res.ok) throw new Error('TempMail createSession Error: ' + res.status);
      const data = await res.json().catch(() => ({}));
      if (!data.token) throw new Error('TempMail createSession: no token in response');
      const client = new TempMailClient(data.token, data.mailbox || null);
      if (!client.email) client.email = client._parseEmailFromToken(data.token);
      return client;
    },
    fromToken(token) {
      const client = new TempMailClient(token, null);
      client.email = client._parseEmailFromToken(token);
      return client;
    }
  };
});