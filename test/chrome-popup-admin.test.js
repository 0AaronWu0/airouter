const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const popupHtml = fs.readFileSync(path.join(__dirname, '..', 'chrome-popup-admin', 'popup.html'), 'utf8');
const popupScript = fs.readFileSync(path.join(__dirname, '..', 'chrome-popup-admin', 'popup.js'), 'utf8');

test('chrome popup shows the backend admin button before service controls', () => {
  const openAdminIndex = popupHtml.indexOf('id="openAdminButton"');
  const startIndex = popupHtml.indexOf('id="startServiceButton"');

  assert.ok(openAdminIndex >= 0, 'open backend admin button should exist');
  assert.ok(startIndex > openAdminIndex, 'open backend admin button should be before start button');
  assert.match(popupScript, /const openAdminButton = document\.getElementById\('openAdminButton'\);/);
  assert.match(popupScript, /buildUrl\('\/admin\/configs'\)/);
});

test('chrome popup switch button prevents details summary click handling', () => {
  const switchHandlerStart = popupScript.indexOf('const switchConfigButton = event.target.closest');
  const switchHandlerEnd = popupScript.indexOf('const deleteApiKeyButton = event.target.closest', switchHandlerStart);
  const switchHandler = switchHandlerStart >= 0 && switchHandlerEnd > switchHandlerStart
    ? popupScript.slice(switchHandlerStart, switchHandlerEnd)
    : '';

  assert.match(popupScript, /data-action="switch-config"/);
  assert.match(popupScript, /\/admin\/api\/configs\/\$\{index\}\/activate/);
  assert.doesNotMatch(popupScript, /\/admin\/api\/configs\/\$\{index\}\/switch-runtime/);
  assert.match(switchHandler, /event\.preventDefault\(\);/);
  assert.match(switchHandler, /event\.stopPropagation\(\);/);
  assert.match(switchHandler, /await activateConfig\(switchConfigButton\.dataset\.index\);/);
});

test('chrome popup hides the top-priority action from config cards', () => {
  assert.doesNotMatch(popupScript, /data-action="move-config"/);
  assert.doesNotMatch(popupScript, /\/admin\/api\/configs\/\$\{index\}\/move-up/);
});

test('chrome popup exposes API mode toggle, filters, and AIRouter branding', () => {
  assert.match(popupHtml, /<title>AIRouter Admin<\/title>/);
  assert.match(popupHtml, /id="apiModeAutoSwitchButton"/);
  assert.match(popupHtml, /data-filter="all"/);
  assert.match(popupHtml, /data-filter="token"/);
  assert.match(popupHtml, /data-filter="apikey"/);
  assert.match(popupHtml, /id="apiKeyRateInput"/);
  assert.match(popupScript, /api_mode_auto_switch/);
});

test('chrome popup renders apikey rate and puts the active config first', () => {
  assert.match(popupScript, /function renderApiKeyRate\(item\)/);
  assert.match(popupScript, /item\.item\.rate/);
  assert.match(popupScript, /class="badge rate"/);
  assert.match(popupScript, /config-identity mono.*\$\{renderApiKeyRate\(item\)\}/s);
  assert.match(popupScript, /left\?\.is_active \? -1 : 1/);
  assert.match(popupScript, /const hasLeftRate = leftRate !== null;/);
  assert.match(popupScript, /const hasRightRate = rightRate !== null;/);
  assert.match(popupScript, /return leftRate - rightRate;/);
  assert.match(popupScript, /Number\(left\?\.index \?\? 0\) - Number\(right\?\.index \?\? 0\)/);
});

test('chrome popup sorts active config first and remaining rates ascending', () => {
  const getConfigTypeStart = popupScript.indexOf('function isConfigEnabled(');
  const getVisibleConfigsStart = popupScript.indexOf('function getVisibleConfigs(');
  const getVisibleConfigsEnd = popupScript.indexOf('\nfunction getSelectedConfigMode', getVisibleConfigsStart);
  const getVisibleConfigs = vm.runInNewContext(
    `${popupScript.slice(getConfigTypeStart, getVisibleConfigsEnd)}; getVisibleConfigs`,
    { selectedConfigFilter: 'apikey' }
  );

  const configs = [
    { index: 0, item: { type: 'apikey', rate: '0.15' } },
    { index: 1, item: { type: 'apikey', rate: '0.04' } },
    { index: 2, item: { type: 'apikey', rate: '' } },
    { index: 3, item: { type: 'apikey', rate: '0.1' }, is_active: true },
    { index: 4, item: { type: 'apikey', rate: '0.04' } },
    { index: 5, item: { type: 'apikey', rate: false } },
    { index: 6, item: { type: 'apikey', rate: 'not-a-number' }, },
    { index: 7, item: { type: 'apikey', rate: '0.01', enabled: false } },
  ];

  assert.deepEqual(Array.from(getVisibleConfigs(configs), item => item.index), [3, 1, 4, 0, 2, 5, 6, 7]);
});

test('chrome popup renders enable and disable actions', () => {
  assert.match(popupScript, /data-action="toggle-enabled"/);
  assert.match(popupScript, /配置项已禁用，不再参与自动切换/);
  assert.match(popupScript, /function isConfigEnabled\(item\)/);
  assert.match(popupScript, /renderEnableButton\(item\).*data-action="edit-config"/s);
  assert.match(popupScript, /return 'is-disabled';/);
  assert.match(popupScript, /item\.is_active \|\| !isConfigEnabled\(item\)/);
  assert.doesNotMatch(popupScript, /badge warn">已禁用/);
});

test('chrome popup hides runtime quota summaries from config cards', () => {
  assert.match(popupScript, /function renderRuntimeHighlights\(item\)/);
  assert.match(popupScript, /function renderRuntimeSummary\(item\)/);
  assert.match(popupScript, /return `不可用原因：\$\{reason \|\| '未知原因'\}`;/);
  assert.match(popupScript, /class="config-runtime-line is-unavailable"/);
  assert.match(popupScript, /config-runtime-line/);
  assert.match(popupScript, /已刷新启用账号额度/);
});

test('chrome popup shows quota refresh countdown only for the active token config', () => {
  assert.match(popupScript, /function getQuotaRefreshCountdownSeconds\(item\)/);
  assert.match(popupScript, /!item\?\.is_active/);
  assert.match(popupScript, /data-quota-countdown/);
  assert.match(popupScript, /<strong>\$\{seconds\}秒<\/strong>/);
  assert.match(popupScript, /QUOTA_REFRESH_INTERVAL_SECONDS = 5 \* 60/);
  assert.match(popupScript, /setInterval\(updateQuotaRefreshCountdowns, 1000\)/);
});

test('chrome popup renders latest upstream response fields', () => {
  assert.match(popupScript, /function renderLatestResponse\(latestRequest, item\)/);
  assert.match(popupScript, /addField\('total_tokens'/);
  assert.match(popupScript, /addField\('缓存 Token'/);
  assert.match(popupScript, /function renderLatestResponseSummary\(latestRequest, item\)/);
  assert.match(popupScript, /latest-response-summary/);
  assert.match(popupScript, /latestRequest\.response_model/);
  assert.doesNotMatch(popupScript, /addField\('返回模型'/);
  assert.doesNotMatch(popupScript, /addField\('本次花费'/);
  assert.doesNotMatch(popupScript, /请求模型：/);
  assert.doesNotMatch(popupScript, /请求使用的配置：/);
  assert.doesNotMatch(popupScript, /状态码：/);
  assert.doesNotMatch(popupScript, /响应 ID：/);
  assert.doesNotMatch(popupScript, /响应状态：/);
  assert.doesNotMatch(popupScript, /响应类型：/);
  assert.doesNotMatch(popupScript, /input_tokens：/);
  assert.doesNotMatch(popupScript, /output_tokens：/);
  assert.doesNotMatch(popupScript, /input_tokens_details：/);
  assert.doesNotMatch(popupScript, /output_tokens_details：/);
  assert.match(popupScript, /toLocaleString\('en-US'\)/);
  assert.doesNotMatch(popupScript, /预估花费：未配置价格/);
  assert.doesNotMatch(popupScript, /响应体预览/);
  assert.match(popupScript, /latest_request/);
});

test('chrome popup exposes config editing controls and update request', () => {
  assert.match(popupHtml, /data-action="cancel-edit-config"/);
  assert.match(popupScript, /data-action="edit-config"/);
  assert.match(popupScript, /method: editing \? 'PUT' : 'POST'/);
  assert.match(popupScript, /配置项已更新并热重载/);
});

test('chrome popup keeps config action buttons in one non-wrapping group', () => {
  assert.match(popupScript, /data-action="toggle-enabled"/);
  assert.match(popupScript, /data-action="edit-config"/);
  assert.match(popupScript, /data-action="delete-config"/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'chrome-popup-admin', 'popup.css'), 'utf8'), /\.config-button-group \{[\s\S]*?flex-wrap: nowrap;[\s\S]*?flex: 0 0 auto;/);
});
