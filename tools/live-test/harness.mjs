// Live test harness: installs one generated extension for a test user in a throwaway SillyTavern,
// loads ST in a Chrome tab over CDP, collects console errors and runs a named check in the page.
//
// Usage: node harness.mjs <extensionDir|-> <folderName> <testName> <outJson>
// Env:   ST_URL (e.g. http://127.0.0.1:8300), ST_DATA (ST data root), ST_USER (test account handle),
//        CDP_URL (e.g. http://127.0.0.1:9222). The test account must exist without a password.
import fs from 'node:fs';
import path from 'node:path';
import { TESTS } from './tests.mjs';

const [extDir, folderName, testName, outJson] = process.argv.slice(2);
const { ST_URL, ST_DATA, ST_USER, CDP_URL } = process.env;
if (!ST_URL || !ST_DATA || !ST_USER || !CDP_URL || !testName || !outJson) {
    console.error('Missing args or env (ST_URL, ST_DATA, ST_USER, CDP_URL)');
    process.exit(2);
}

const userDir = path.join(ST_DATA, ST_USER);
const extRoot = path.join(userDir, 'extensions');

// 1. Fresh extension folder and fresh chats.
fs.rmSync(extRoot, { recursive: true, force: true });
fs.mkdirSync(extRoot, { recursive: true });
if (extDir !== '-') fs.cpSync(extDir, path.join(extRoot, folderName), { recursive: true });
fs.rmSync(path.join(userDir, 'chats'), { recursive: true, force: true });
fs.mkdirSync(path.join(userDir, 'chats'), { recursive: true });

// 2. New tab + CDP session.
const tab = await (await fetch(`${CDP_URL}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 1;
const pending = new Map();
const errors = [];
ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
        return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        errors.push({ kind: 'exception', text: d.exception?.description || d.text, url: d.url || '' });
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.push({ kind: 'console.error', text: msg.params.args.map(a => a.value ?? a.description ?? '').join(' ') });
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        errors.push({ kind: 'log', text: msg.params.entry.text, url: msg.params.entry.url || '' });
    }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, timeoutMs = 60000) => {
    const r = await Promise.race([
        send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('evaluate timeout')), timeoutMs)),
    ]);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');

const result = { test: testName, folder: folderName, ok: false };
try {
    // 3. Log in as the test user, then load the app.
    result.step = 'login';
    await send('Page.navigate', { url: `${ST_URL}/login` });
    await sleep(2500);
    await evaluate(`(async () => {
        const { token } = await (await fetch('/csrf-token')).json();
        const r = await fetch('/api/users/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
            body: JSON.stringify({ handle: ${JSON.stringify(ST_USER)}, password: '' }) });
        return r.status;
    })()`);
    errors.length = 0;
    await send('Page.navigate', { url: `${ST_URL}/` });

    result.step = 'boot';
    // 4. Wait for APP_READY (sticky event), then give extensions a moment.
    for (let i = 0; i < 120; i++) {
        const ready = await evaluate('!!(window.SillyTavern && SillyTavern.getContext)').catch(() => false);
        if (ready) break;
        await sleep(500);
    }
    result.step = 'app_ready';
    // Arm a sticky APP_READY flag, then poll; dismiss the first-run onboarding dialog if it blocks boot.
    await evaluate(`(() => { const c = SillyTavern.getContext(); window.__appReady = false;
        c.eventSource.on(c.eventTypes.APP_READY, () => { window.__appReady = true; }); return true; })()`);
    let appReady = false;
    for (let i = 0; i < 180 && !appReady; i++) {
        appReady = await evaluate('window.__appReady === true').catch(() => false);
        if (!appReady) {
            await evaluate(`(() => { const d = [...document.querySelectorAll('dialog.popup[open]')]
                .find(x => /Welcome to SillyTavern/i.test(x.innerText)); d?.querySelector('.popup-button-ok')?.click(); return !!d; })()`).catch(() => false);
            await sleep(500);
        }
    }
    if (!appReady) throw new Error('APP_READY never fired');
    await sleep(2500);

    result.step = 'checks';
    result.loadWarning = await evaluate(`document.querySelector('#extensions_details')?.classList.contains('warning') ?? null`);
    result.checks = await evaluate(`(async () => { ${TESTS[testName]} })()`, 120000);
    result.ok = true;
} catch (e) {
    result.error = String(e?.stack || e);
}
await sleep(500);
result.errors = errors;
fs.writeFileSync(outJson, JSON.stringify(result, null, 2));
try { await fetch(`${CDP_URL}/json/close/${tab.id}`); } catch { /* ignore */ }
ws.close();
console.log(JSON.stringify({ test: testName, step: result.step, ok: result.ok, loadWarning: result.loadWarning, errors: errors.length, error: result.error?.split('\n')[0] }));
process.exit(0);
