const fs = require('node:fs');
const { requestBuffered } = require('./upstream-request');

const LOGIN_FILE = '/Users/wujunyan151646/login.json';
const TARGET_HOST = 'us-ai3.twskyhope.top';
const LOGIN_PATH = '/api/user/login?turnstile=';
const TOKEN_PATH = '/api/token/?p=1&size=100';
const GROUP_PATH = '/api/user/self/groups';
const HANHE_HOST = 'api.hanhegufei.online';
const HANHE_LOGIN_PATH = '/api/v1/auth/login';
const HANHE_KEYS_PATH = '/api/v1/keys?page=1&page_size=100&sort_by=created_at&sort_order=desc&timezone=Asia%2FShanghai';

function getSiteCredentials(loginFile = LOGIN_FILE, host = TARGET_HOST) {
    try {
        const parsed = JSON.parse(fs.readFileSync(loginFile, 'utf8'));
        const site = parsed?.sites?.[host];
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
        const proGroups = groupNames.filter(group => group.toLowerCase().includes('gpt pro'));
        return proGroups.find(group => group.includes('专用')) || proGroups[0] || '';
    }
    if (label.includes('plus')) {
        const plusGroups = groupNames.filter(group => {
            const normalizedGroup = group.toLowerCase();
            return normalizedGroup.includes('gpt') && normalizedGroup.includes('不包括pro');
        });
        return plusGroups.find(group => group.includes('专用')) || plusGroups[0] || '';
    }
    return '';
}

async function fetchRealApiKeyRates(options = {}) {
    const baseUrl = options.baseUrl || `https://${TARGET_HOST}`;
    const host = options.host || TARGET_HOST;
    const credentials = options.credentials || getSiteCredentials(options.loginFile, host);
    if (!credentials) throw new Error(`未找到 ${host} 登录配置`);

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

async function fetchHanheApiKeyRates(options = {}) {
    const baseUrl = options.baseUrl || `https://${HANHE_HOST}`;
    const credentials = options.credentials || getSiteCredentials(options.loginFile, HANHE_HOST);
    if (!credentials) throw new Error(`未找到 ${HANHE_HOST} 登录配置`);

    let accessToken = options.accessToken || '';
    async function login() {
        const result = await requestJson(baseUrl, HANHE_LOGIN_PATH, {
            method: 'POST',
            body: { email: credentials.username, password: credentials.password },
            timeoutMs: options.timeoutMs,
        });
        const payload = parseJsonResponse(result, 'Hanhe 倍率登录');
        const token = payload?.data?.access_token;
        if (payload.code !== 0 && !token) throw new Error(payload.message || 'Hanhe 倍率登录失败');
        return token;
    }

    if (!accessToken) accessToken = await login();
    let keyResult = await requestJson(baseUrl, HANHE_KEYS_PATH, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeoutMs: options.timeoutMs,
    });
    if (keyResult.statusCode === 401 || keyResult.statusCode === 403) {
        accessToken = await login();
        keyResult = await requestJson(baseUrl, HANHE_KEYS_PATH, {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeoutMs: options.timeoutMs,
        });
    }

    const payload = parseJsonResponse(keyResult, 'Hanhe Key 列表');
    const items = payload?.data?.items || payload?.data || [];
    const rates = {};
    for (const config of options.configs || []) {
        const target = normalizeApiKey(config.apiKey);
        const list = Array.isArray(items) ? items : [];
        const item = list.find(entry => normalizeApiKey(entry?.key || entry?.token) === target)
            || list.find(entry => {
                const configLabel = `${config.description || ''} ${config.baseUrl || ''}`.toLowerCase();
                const itemLabel = `${entry?.name || ''} ${entry?.group?.name || ''}`.toLowerCase();
                return configLabel.includes('pro') === itemLabel.includes('pro');
            })
            || (list.length === 1 ? list[0] : null);
        const rate = item?.rate
            ?? item?.ratio
            ?? item?.group_ratio
            ?? item?.price_ratio
            ?? item?.group?.rate_multiplier;
        if (typeof rate === 'number' && Number.isFinite(rate)) rates[config.index] = rate;
    }
    return { rates, accessToken };
}

module.exports = {
    fetchRealApiKeyRates,
    fetchHanheApiKeyRates,
    getSiteCredentials,
    findMatchingToken,
    inferGroupName,
};
