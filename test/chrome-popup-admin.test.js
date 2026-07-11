const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
  assert.match(popupScript, /Number\(left\?\.index \?\? 0\) - Number\(right\?\.index \?\? 0\)/);
});

test('chrome popup exposes config editing controls and update request', () => {
  assert.match(popupHtml, /data-action="cancel-edit-config"/);
  assert.match(popupScript, /data-action="edit-config"/);
  assert.match(popupScript, /method: editing \? 'PUT' : 'POST'/);
  assert.match(popupScript, /配置项已更新并热重载/);
});
