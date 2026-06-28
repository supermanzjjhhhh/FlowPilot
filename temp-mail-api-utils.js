(function tempMailApiUtilsModule(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
    return;
  }
  root.TempMailApiUtils = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createTempMailApiUtils() {
  
  const BASE_API = 'https://web2.temp-mail.org';

  class TempMailClient {
    constructor(token, email) {
      this.token = token;
      this.email = email;
    }

    async _fetchApi(endpoint, method = 'GET') {
      const url = BASE_API + endpoint;
      const res = await fetch(url, {
        method,
        headers: {
          'Authorization': 'Bearer ' + this.token,
          'Accept': 'application/json, text/plain, */*',
          'Content-Type': 'application/json'
        }
      });
      if (!res.ok) throw new Error('TempMail API Error: ' + res.status);
      return await res.json().catch(() => ({}));
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
          const messages = await this._fetchApi('/messages', 'GET');
          
          if (Array.isArray(messages) && messages.length > 0) {
            for (const msg of messages) {
              const textContent = String(msg.mail_text || msg.mail_html || msg.subject || '').replace(/\s+/g, ' ');
              const match = textContent.match(codeRegex);
              if (match) {
                return {
                  code: match[0],
                  fullText: textContent,
                  sender: msg.mail_from
                };
              }
            }
          }
          if (onProgress) onProgress(i + 1, maxRetries, messages, null);
        } catch (err) {
          console.warn('TempMail poll error:', err.message);
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
        const payload = JSON.parse(atob(jwt.split('.')[1]));
        return payload.mailbox;
      } catch (e) {
        return null;
      }
    }
  }

  return {
    async createSession() {
      const res = await fetch(BASE_API + '/mailbox', {
        method: 'POST',
        headers: { 'Accept': 'application/json, text/plain, */*', 'Content-Type': 'application/json' }
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