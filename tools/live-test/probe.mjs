// Debug helper: log in as the test user, load ST, wait, and report what the page shows.
const { ST_URL, ST_USER, CDP_URL } = process.env;
const waitMs = Number(process.argv[2] || 20000);
const tab = await (await fetch(`${CDP_URL}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res) => { ws.onopen = res; });
let id = 1; const pend = new Map(); const logs = [];
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
    if (m.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200));
};
const send = (method, params = {}) => new Promise(r => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))?.result?.value;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
await send('Runtime.enable');
await send('Page.navigate', { url: `${ST_URL}/login` });
await sleep(2500);
console.log('login:', await ev(`(async () => { const { token } = await (await fetch('/csrf-token')).json();
  const r = await fetch('/api/users/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify({ handle: ${JSON.stringify(ST_USER)}, password: '' }) }); return r.status + ' ' + await r.text(); })()`));
await send('Page.navigate', { url: `${ST_URL}/` });
await sleep(waitMs);
console.log(JSON.stringify(await ev(`({
  url: location.href,
  hasST: !!window.SillyTavern,
  preloader: !!document.querySelector('#preloader'),
  popups: [...document.querySelectorAll('dialog.popup[open]')].map(d => d.innerText.slice(0, 300)),
  visibility: document.visibilityState,
  chars: window.SillyTavern ? SillyTavern.getContext().characters.length : null,
})`), null, 2));
console.log(logs.slice(0, 20).join('\n'));
await fetch(`${CDP_URL}/json/close/${tab.id}`);
process.exit(0);
