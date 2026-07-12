const fs = require('node:fs');
const { requestBuffered } = require('./upstream-request');

const LOGIN_FILE = '/Users/wujunyan151646/login.json';
const TARGET_HOST = 'us-ai3.twskyhope.top';
const LOGIN_PATH = '/api/user/login?turnstile=';
const TOKEN_PATH = '/api/token/?p=1&size=100';
const GROUP_PATH = '/api/user/self/groups';

function getSiteCredentials(loginFile = LOGIN_FILE) {
    try {
        const parsed = JSON.parse(fs.readFileSync(loginFile, 'utf8'));
        const site = parsed?.sites?.[TARGET_HOST];
        const username = typeof site?.username === 'string' ? site.username.trim() : '';
        const password = typeof site?.password === 'string' ? site.password : '';
        return username && password ? { username, password } : null;
    } catch {
        return null;
    }
}

function parseSessionCookie(headers) {
    const values = headers?.['set-cookie'] || headers?.['Set-Cookie'] || [];
    const cookies = Array.isArray(values) ? values : [values];
    const session = cookies
        .map(value => String(value).split(';', 1)[0])
        .find(value => value.startsWith('session='));
    return session || '';
}

function parseLoginUserId(payload) {
    const userId = payload?.data?.id;
    return Number.isInteger(userId) || typeof userId === 'string' ? String(userId) : '';
}

function parseJsonResponse(result, label) {
    if (result.statusCode < 200 || result.statusCode >= 300) {
        throw new Error(`${label} HTTP ${result.statusCode}`);
    }

    try {
        return JSON.parse(result.bodyText || '{}');
    } catch (error) {
        throw new Error(`${label} 返回不是 JSON: ${error.message}`);
    }
}

async function requestJson(baseUrl, path, options = {}) {
    return requestBuffered({
        method: options.method || 'GET',
        targetUrl: new URL(path, `${baseUrl}/`).toString(),
        headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.cookie ? { Cookie: options.cookie } : {}),
            ...(options.userId ? { 'new-api-user': String(options.userId) } : {}),
            ...(options.headers || {}),
        },
        body: options.body ? Buffer.from(JSON.stringify(options.body)) : undefined,
        timeoutMs: options.timeoutMs,
        maxRedirects: 2,
    });
}

function normalizeApiKey(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function findMatchingToken(items, apiKey) {
    const target = normalizeApiKey(apiKey);
    if (!target) return null;
    return (Array.isArray(items) ? items : []).find(item => normalizeApiKey(item?.key) === target) || null;
}

function inferGroupName(config, groups) {
    const label = `${config.description || ''} ${config.baseUrl || ''}`.toLowerCase();
    const groupNames = Object.keys(groups || {});
    if (label.includes('pro')) {
        return groupNames.find(group => group.includes('gpt pro')) || '';
    }
    if (label.includes('plus')) {
        return groupNames.find(group => group.includes('gpt') && (group.includes('不包括pro') || !group.includes('pro'))) || '';
    }
    return '';
}

async function fetchRealApiKeyRates(options = {}) {
    const baseUrl = options.baseUrl || `https://${TARGET_HOST}`;
    const credentials = options.credentials || getSiteCredentials(options.loginFile);
    if (!credentials) throw new Error(`未找到 ${TARGET_HOST} 登录配置`);

    let sessionCookie = options.sessionCookie || '';
    let userId = options.userId || '';
    if (!sessionCookie) {
        const loginResult = await requestJson(baseUrl, LOGIN_PATH, {
            method: 'POST',
            body: credentials,
            timeoutMs: options.timeoutMs,
        });
        const loginPayload = parseJsonResponse(loginResult, '倍率登录');
        if (loginPayload.success === false) throw new Error(loginPayload.message || '倍率登录失败');
        sessionCookie = parseSessionCookie(loginResult.headers);
        userId = parseLoginUserId(loginPayload);
        if (!sessionCookie) throw new Error('倍率登录未返回 session');
    }

    let tokenResult = await requestJson(baseUrl, TOKEN_PATH, {
        cookie: sessionCookie,
        userId,
        timeoutMs: options.timeoutMs,
    });
    if (tokenResult.statusCode === 401 || tokenResult.statusCode === 403) {
        sessionCookie = '';
        const loginResult = await requestJson(baseUrl, LOGIN_PATH, {
            method: 'POST', body: credentials, timeoutMs: options.timeoutMs,
        });
        const loginPayload = parseJsonResponse(loginResult, '倍率重新登录');
        sessionCookie = parseSessionCookie(loginResult.headers);
        userId = parseLoginUserId(loginPayload);
        if (!sessionCookie) throw new Error('倍率重新登录未返回 session');
        tokenResult = await requestJson(baseUrl, TOKEN_PATH, { cookie: sessionCookie, userId, timeoutMs: options.timeoutMs });
    }

    const tokenPayload = parseJsonResponse(tokenResult, '倍率 Key 列表');
    const items = tokenPayload?.data?.items || [];
    const groupResult = await requestJson(baseUrl, GROUP_PATH, { cookie: sessionCookie, userId, timeoutMs: options.timeoutMs });
    const groupPayload = parseJsonResponse(groupResult, '倍率分组');
    const groups = groupPayload?.data || {};
    const rates = {};
    for (const config of options.configs || []) {
        const token = findMatchingToken(items, config.apiKey);
        const groupName = token?.group || inferGroupName(config, groups);
        const ratio = groupName && groups[groupName]?.ratio;
        if (typeof ratio === 'number' && Number.isFinite(ratio)) rates[config.index] = ratio;
    }

    return { rates, sessionCookie, userId };
}

module.exports = { fetchRealApiKeyRates, getSiteCredentials, findMatchingToken };
