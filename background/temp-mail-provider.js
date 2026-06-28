(function tempMailProviderModule(root, factory) {
  root.MultiPageBackgroundTempMailProvider = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createTempMailProviderModule() {
  function createTempMailProvider(deps = {}) {
    const {
      addLog = async () => {},
      getState = async () => ({}),
      setState = async () => {},
      persistRegistrationEmailState = null,
      setEmailState = async () => {},
      sleepWithStop = async () => {},
      throwIfStopped = () => {},
      TEMP_MAIL_API_PROVIDER = 'temp-mail-api',
    } = deps;

    let currentClient = null;

    async function persistResolvedEmailState(state = null, email, options = {}) {
      if (typeof persistRegistrationEmailState === 'function') {
        await persistRegistrationEmailState(state, email, options);
        return;
      }
      await setEmailState(email, options);
    }

    async function createSessionViaApi() {
      await addLog('temp邮箱：正在通过 API 直接获取初始会话...', 'info');
      try {
        currentClient = await self.TempMailApiUtils.createSession();
        await addLog('temp邮箱：成功通过 API 获取初始会话', 'ok');
        return currentClient;
      } catch (err) {
        throw new Error('temp邮箱获取初始会话失败：' + err.message);
      }
    }

    async function ensureTempMailAddress(options = {}) {
      throwIfStopped();
      const latestState = await getState();
      const cachedToken = latestState?.tempMailApiToken;
      const cachedEmail = latestState?.tempMailApiEmail;

      if (!options.generateNew && cachedToken && cachedEmail) {
        if (!currentClient) {
          currentClient = self.TempMailApiUtils.fromToken(cachedToken);
          currentClient.email = cachedEmail;
        }
        await persistResolvedEmailState(latestState, cachedEmail, options);
        return cachedEmail;
      }

      await createSessionViaApi();
      let newEmail = null;
      if (!options.generateNew && currentClient.email) {
        newEmail = currentClient.email;
      } else {
        try {
          await addLog('temp邮箱：正在通过 API 分配全新临时邮箱地址...', 'info');
          newEmail = await currentClient.changeMailbox();
        } catch (err) {
          await addLog('temp邮箱 Token 失效，正在重新获取新 Token...', 'warn');
          await createSessionViaApi();
          newEmail = await currentClient.changeMailbox();
        }
      }

      await setState({
        tempMailApiToken: currentClient.token,
        tempMailApiEmail: newEmail
      });
      await persistResolvedEmailState(await getState(), newEmail, options);
      await addLog(`temp邮箱：已准备就绪 -> ${newEmail}`, 'ok');
      return newEmail;
    }

    async function pollTempMailVerificationCode(step, state, pollPayload = {}) {
      throwIfStopped();
      const latestState = state || await getState();
      const token = latestState?.tempMailApiToken;
      const email = latestState?.tempMailApiEmail || latestState?.registrationEmail;
      if (!token) {
        throw new Error('temp邮箱 Token 未就绪，无法轮询验证码。');
      }
      if (!currentClient) {
        currentClient = self.TempMailApiUtils.fromToken(token);
        currentClient.email = email;
      }
      await addLog(`temp邮箱：正在持续请求 API 轮询 (${email}) 的验证码...`, 'info');
      const maxAttempts = pollPayload.maxAttempts || 20;
      const intervalMs = pollPayload.intervalMs || 3000;
      const result = await currentClient.waitForVerificationCode(/\b\d{4,6}\b/, {
        maxRetries: maxAttempts,
        intervalMs,
        sleepFn: sleepWithStop,
        onProgress: async (attempt, total, messages, error) => {
          if (error) {
            await addLog(`temp邮箱：轮询 ${attempt}/${total} API错误: ${error.message}`, 'warn');
          } else {
            const msgCount = Array.isArray(messages) ? messages.length : 0;
            await addLog(`temp邮箱：轮询 ${attempt}/${total} 收到${msgCount}封邮件`, 'info');
          }
        }
      });
      if (result && result.code) {
        await addLog(`temp邮箱：成功拉取到验证码 -> ${result.code}`, 'ok');
        return { ok: true, code: result.code, emailTimestamp: result.emailTimestamp || Date.now(), mailId: result.mailId || '' };
      }
      throw new Error('temp邮箱超时：未能在指定时间内从 API 拉取到验证码邮件。');
    }

    return {
      ensureTempMailAddress,
      pollTempMailVerificationCode
    };
  }

  return {
    createTempMailProvider
  };
});
