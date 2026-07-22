const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { EventEmitter } = require('node:events');

const {
  activateConfigAdminResponse,
  openExternalUrl,
  refreshConfigAdminResponse,
  refreshConfigTokenAdminResponse,
  reportBusinessRequestError,
  registerProcessSafetyHandlers,
  selectApiModeAutoSwitchTarget,
  selectReloadedActiveConfig,
} = require('../openai');
const { inferGroupName } = require('../app/real-rate-sync');

test('selectApiModeAutoSwitchTarget chooses the lowest available lower-rate apikey', () => {
  const configs = [
    { type: 'apikey', rate: '0.17', runtime: { available: true } },
    { type: 'apikey', rate: '0.15', runtime: { available: true } },
    { type: 'apikey', rate: '0.12', runtime: { available: false } },
  ];

  assert.equal(selectApiModeAutoSwitchTarget(configs, configs[0]), configs[1]);
});

test('selectApiModeAutoSwitchTarget prefers real rates over local rates', () => {
  const configs = [
    { type: 'apikey', rate: '0.17', runtime: { realRate: '0.2', available: true } },
    { type: 'apikey', rate: '0.01', runtime: { realRate: '0.16', available: true } },
    { type: 'apikey', rate: '0.02', runtime: { realRate: '0.14', available: true } },
  ];

  assert.equal(selectApiModeAutoSwitchTarget(configs, configs[0]), configs[2]);
});

test('selectApiModeAutoSwitchTarget ignores apikey configs without a valid rate', () => {
  const configs = [
    { type: 'apikey', rate: '0.17', runtime: { available: true } },
    { type: 'apikey', rate: '', runtime: { available: true } },
    { type: 'apikey', runtime: { available: true } },
    { type: 'apikey', rate: false, runtime: { available: true } },
    { type: 'apikey', rate: '0.15', runtime: { available: true } },
  ];

  assert.equal(selectApiModeAutoSwitchTarget(configs, configs[0]), configs[4]);
});

test('selectApiModeAutoSwitchTarget ignores disabled apikey configs', () => {
  const configs = [
    { type: 'apikey', rate: '0.17', runtime: { available: true } },
    { type: 'apikey', rate: '0.01', enabled: false, runtime: { available: true } },
    { type: 'apikey', rate: '0.15', runtime: { available: true } },
  ];

  assert.equal(selectApiModeAutoSwitchTarget(configs, configs[0]), configs[2]);
});

test('selectApiModeAutoSwitchTarget only switches from an apikey config', () => {
  const tokenConfig = { type: 'token', runtime: { available: true } };
  const apikeyConfig = { type: 'apikey', rate: '0.1', runtime: { available: true } };

  assert.equal(selectApiModeAutoSwitchTarget([apikeyConfig], tokenConfig), null);
});

test('real rate sync supports Hanhe group rate multiplier responses', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'real-rate-sync.js'), 'utf8');
  assert.match(source, /api\/v1\/auth\/login/);
  assert.match(source, /api\/v1\/keys/);
  assert.match(source, /group\?\.rate_multiplier/);
});

test('real rate sync maps plus configs to the dedicated non-pro group', () => {
  const groups = {
    'gpt 官转专用分组': { ratio: 0.125 },
    'gpt稳定分组(不包括pro)': { ratio: 0.1 },
    'gpt专用分组(不包括pro)': { ratio: 0.05 },
  };

  assert.equal(inferGroupName({ description: 'plus', baseUrl: 'https://us-ai3.twskyhope.top' }, groups), 'gpt专用分组(不包括pro)');
  assert.equal(inferGroupName({ description: 'pro', baseUrl: 'https://us-ai3.twskyhope.top' }, {
    'gpt pro稳定分组': { ratio: 0.3 },
    'gpt pro专用分组': { ratio: 0.125 },
  }), 'gpt pro专用分组');
});

test('real rate sync only starts when API mode is enabled', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'openai.js'), 'utf8');
  const functionStart = source.indexOf('function startRealRateSyncMonitor()');
  const functionEnd = source.indexOf('\n}\n\nfunction isRateConfiguredApiKey', functionStart);
  const functionSource = source.slice(functionStart, functionEnd);
  assert.match(functionSource, /if \(!apiModeAutoSwitchEnabled\)/);
  assert.match(source.slice(source.indexOf('async function refreshRealApiKeyRates()'), functionStart), /if \(!apiModeAutoSwitchEnabled \|\| realRateSyncRunning\)/);
});

test('real rate sync reuses site sessions until the upstream rejects them', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'openai.js'), 'utf8');
  assert.match(source, /const realRateSyncSessions = new Map\(\)/);
  assert.match(source, /sessionCookie: session\.sessionCookie/);
  assert.match(source, /accessToken: session\.accessToken/);
  assert.match(source, /realRateSyncSessions\.set\(syncTasks\[index\]\.key, session\)/);
});

test('latest responses parser accepts a top-level model from token mode streams', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'openai.js'), 'utf8');
  assert.match(source, /!completedPayload && eventPayload\.model/);
  assert.match(source, /response_model: responsePayload\?\.model/);
});

test('stream response capture extracts the model while forwarding chunks', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'openai.js'), 'utf8');
  assert.match(source, /captureStreamResponseModel\(chunk\)/);
  assert.match(source, /captureContext\.responseModel = responseModel/);
});

test('admin snapshot marks the active config used by the OpenAI route', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'openai.js'), 'utf8');
  const functionStart = source.indexOf('function buildConfigAdminResponse()');
  const functionEnd = source.indexOf('async function refreshConfigAdminResponse', functionStart);
  const functionSource = source.slice(functionStart, functionEnd);

  assert.match(functionSource, /openAiRoutePredicate/);
  assert.match(functionSource, /getActiveConfig\(openAiRoutePredicate\)/);
  assert.match(functionSource, /ensureActiveConfig\('admin_snapshot', openAiRoutePredicate\)/);
  assert.match(functionSource, /latest_request: latestRequestResponse/);
});

test('refreshConfigAdminResponse refreshes all quotas before building the admin snapshot in token mode', async () => {
  const calls = [];
  const manager = {
    refreshQuotas: async reason => {
      calls.push(reason);
    },
  };
  const expectedResponse = {
    mode: 'token',
    configs: [],
  };

  const response = await refreshConfigAdminResponse({
    accountManager: manager,
    shouldRefreshQuota: true,
    buildResponse: () => expectedResponse,
  });

  assert.deepEqual(calls, ['admin_refresh']);
  assert.equal(response, expectedResponse);
});

test('refreshConfigAdminResponse refreshes only the active config when requested', async () => {
  const configs = [{ type: 'token' }, { type: 'token' }];
  const calls = [];
  const manager = {
    getActiveConfig: () => configs[1],
    refreshQuotas: async (reason, options) => {
      calls.push({ reason, selected: configs.filter(options.refreshPredicate) });
    },
  };

  await refreshConfigAdminResponse({
    accountManager: manager,
    shouldRefreshQuota: true,
    refreshCurrentOnly: true,
    buildResponse: () => ({})
  });

  assert.deepEqual(calls, [{ reason: 'admin_refresh', selected: [configs[1]] }]);
});

test('refreshConfigAdminResponse refreshes all enabled token configs for manual refresh', async () => {
  const configs = [
    { type: 'token', enabled: true },
    { type: 'token', enabled: false },
    { type: 'apikey', enabled: true },
  ];
  const calls = [];
  const manager = {
    refreshQuotas: async (reason, options) => {
      calls.push({ reason, selected: configs.filter(options.refreshPredicate) });
    },
  };

  await refreshConfigAdminResponse({
    accountManager: manager,
    shouldRefreshQuota: true,
    buildResponse: () => ({}),
  });

  assert.deepEqual(calls, [{ reason: 'admin_refresh', selected: [configs[0]] }]);
});

test('refreshConfigAdminResponse skips quota refresh when no token configs exist', async () => {
  let called = false;
  const manager = {
    refreshQuotas: async () => {
      called = true;
    },
  };
  const expectedResponse = {
    mode: 'apikey',
    configs: [],
  };

  const response = await refreshConfigAdminResponse({
    accountManager: manager,
    shouldRefreshQuota: false,
    buildResponse: () => expectedResponse,
  });

  assert.equal(called, false);
  assert.equal(response, expectedResponse);
});

test('activateConfigAdminResponse switches the active runtime config without refreshing quotas', async () => {
  const calls = [];
  const manager = {
    activateConfig: (index, reason) => {
      calls.push(['activate', index, reason]);
    },
    refreshQuotas: async reason => {
      calls.push(['refresh', reason]);
    },
  };
  const expectedResponse = {
    active_config_index: 1,
  };

  const response = await activateConfigAdminResponse(1, {
    accountManager: manager,
    buildResponse: () => expectedResponse,
  });

  assert.deepEqual(calls, [['activate', 1, 'admin_manual_activate']]);
  assert.equal(response, expectedResponse);
});

test('selectReloadedActiveConfig preserves active config during reorder reloads', () => {
  const calls = [];
  const activeConfig = {
    index: 2,
    runtime: {
      available: false,
    },
  };
  const manager = {
    getActiveConfig: () => {
      calls.push('getActiveConfig');
      return activeConfig;
    },
    ensureActiveConfig: reason => {
      calls.push(['ensureActiveConfig', reason]);
      return {
        index: 0,
      };
    },
  };

  const selected = selectReloadedActiveConfig(manager, 'admin_move_config', {
    preserveActiveConfig: true,
  });

  assert.equal(selected, activeConfig);
  assert.deepEqual(calls, ['getActiveConfig']);
});

test('activateConfigAdminResponse activates the first config without rewriting the file', async () => {
  const calls = [];
  const manager = {
    activateConfig: (index, reason) => {
      calls.push(['activate', index, reason]);
    },
  };
  const response = await activateConfigAdminResponse(0, {
    accountManager: manager,
    readParsedConfigFile: () => {
      calls.push('read');
      return { configs: [] };
    },
    persistAndReloadConfig: async () => {
      calls.push('persist');
    },
    buildResponse: () => ({ active_config_index: 0 }),
  });

  assert.deepEqual(calls, [['activate', 0, 'admin_manual_activate']]);
  assert.deepEqual(response, { active_config_index: 0 });
});

test('admin reorder route moves the selected config to the top', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'openai.js'), 'utf8');
  const routeStart = source.indexOf("app.post('/admin/api/configs/:index/move-up'");
  const routeEnd = source.indexOf("app.post('/admin/api/configs/:index/refresh-token'", routeStart);
  const routeSource = routeStart >= 0 && routeEnd > routeStart
    ? source.slice(routeStart, routeEnd)
    : '';

  assert.match(routeSource, /moveConfigItem\(parsed,\s*targetIndex,\s*0\)/);
  assert.match(routeSource, /preserveActiveConfig:\s*true/);
  assert.doesNotMatch(routeSource, /accountManager\.activateConfig\(0,\s*'admin_move_config'\)/);
});

test('admin config edit route updates an existing config through the config editor', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'openai.js'), 'utf8');
  const routeStart = source.indexOf("app.put('/admin/api/configs/:index'");
  const routeEnd = source.indexOf("app.post('/admin/api/apikeys'", routeStart);
  const routeSource = routeStart >= 0 && routeEnd > routeStart
    ? source.slice(routeStart, routeEnd)
    : '';

  assert.match(routeSource, /updateConfigItem\(parsed, targetIndex, nextItem\)/);
  assert.match(routeSource, /preserve|created_at/);
});

test('refreshConfigTokenAdminResponse refreshes and persists a token config', async () => {
  const persisted = [];
  const response = await refreshConfigTokenAdminResponse(0, {
    configFile: '/tmp/openai.json',
    readParsedConfigFile: () => ({
      configs: [{
        access_token: 'old-access',
        refresh_token: 'old-refresh',
        client_id: 'old-client',
      }],
    }),
    refreshOpenAIToken: async payload => {
      assert.equal(payload.refreshToken, 'old-refresh');
      assert.equal(payload.clientId, 'old-client');
      return {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        client_id: 'new-client',
      };
    },
    persistTokenRefreshForConfig: payload => {
      persisted.push(payload);
    },
    buildResponse: () => ({ ok: true }),
    timeoutMs: 1234,
  });

  assert.deepEqual(persisted, [{
    config: { index: 0 },
    accessToken: 'new-access',
    refreshToken: 'new-refresh',
    clientId: 'new-client',
  }]);
  assert.deepEqual(response, { ok: true });
});

test('refreshConfigTokenAdminResponse rejects configs without refresh_token', async () => {
  await assert.rejects(
    () => refreshConfigTokenAdminResponse(0, {
      configFile: '/tmp/openai.json',
      readParsedConfigFile: () => ({
        configs: [{
          access_token: 'old-access',
          account_id: 'account-1',
        }],
      }),
    }),
    /当前配置项没有 refresh_token/
  );
});

test('openExternalUrl reports opener spawn errors without leaving an unhandled child error', async () => {
  const child = new EventEmitter();
  const warnings = [];
  child.unref = () => {};

  await assert.rejects(
    async () => {
      const opened = openExternalUrl('https://chatgpt.com/api/auth/session', {
        platform: 'linux',
        spawnImpl: () => child,
        warn: (...args) => warnings.push(args.join(' ')),
      });

      child.emit('error', Object.assign(new Error('spawn xdg-open ENOENT'), {
        code: 'ENOENT',
        path: 'xdg-open',
      }));

      await opened;
    },
    /打开外部链接失败: spawn xdg-open ENOENT/
  );

  assert.deepEqual(warnings, ['打开外部链接失败: spawn xdg-open ENOENT']);
  assert.equal(child.listenerCount('error'), 0);
});

test('registerProcessSafetyHandlers logs business crashes without marking the process for exit', () => {
  const processLike = new EventEmitter();
  const errors = [];
  processLike.exitCode = undefined;

  const unregister = registerProcessSafetyHandlers({
    process: processLike,
    error: (...args) => errors.push(args.join(' ')),
  });

  processLike.emit('uncaughtException', new Error('route exploded'), 'uncaughtException');
  processLike.emit('unhandledRejection', new Error('async job exploded'), Promise.resolve());

  assert.equal(processLike.exitCode, undefined);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /业务异常已捕获，服务继续运行/);
  assert.match(errors[0], /route exploded/);
  assert.match(errors[1], /未处理的 Promise 异常已捕获，服务继续运行/);
  assert.match(errors[1], /async job exploded/);

  unregister();
  assert.equal(processLike.listenerCount('uncaughtException'), 0);
  assert.equal(processLike.listenerCount('unhandledRejection'), 0);
});

test('reportBusinessRequestError returns a controlled 500 response for unexpected business errors', () => {
  const responses = [];
  const res = {
    headersSent: false,
    writableEnded: false,
    statusCode: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      responses.push(payload);
      this.writableEnded = true;
      return this;
    },
  };

  reportBusinessRequestError(res, new Error('handler failed'), '测试业务请求失败', {
    error: () => {},
  });

  assert.equal(res.statusCode, 500);
  assert.deepEqual(responses, [{
    error: 'Internal Server Error',
    message: 'handler failed',
  }]);
});
