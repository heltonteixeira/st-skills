// Page-side checks, run as async function bodies inside SillyTavern after APP_READY.
const HELPERS = String.raw`
const ctx = () => SillyTavern.getContext();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const exec = async (s) => {
    const r = await ctx().executeSlashCommandsWithOptions(s, { handleParserErrors: false, handleExecutionErrors: false });
    return r?.pipe;
};
async function openChat() {
    const c = ctx();
    const changed = new Promise(r => c.eventSource.once(c.eventTypes.CHAT_CHANGED, r));
    await c.selectCharacterById(0);
    await Promise.race([changed, sleep(8000)]);
    await sleep(1500);
}
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const visible = (el) => !!el && getComputedStyle(el).display !== 'none';
const openPopups = () => [...document.querySelectorAll('dialog.popup[open]')];
async function closeTopPopup() {
    const d = openPopups().at(-1);
    if (!d) return;
    (d.querySelector('.popup-button-cancel') || d.querySelector('.popup-button-close') || d.querySelector('.popup-button-ok'))?.click();
    await sleep(600);
}
`;

export const TESTS = {
    baseline: HELPERS + String.raw`
        await openChat();
        return { chatLen: ctx().chat.length };
    `,

    loadOnly: HELPERS + String.raw`
        await openChat();
        const tm = ctx().ToolManager;
        const tools = Array.isArray(tm?.tools) ? tm.tools.map(t => t.toFunctionOpenAI?.()?.function?.name ?? '?') : null;
        return { chatLen: ctx().chat.length, tools, extensionPrompts: Object.keys(ctx().extensionPrompts || {}) };
    `,

    // Invokes every tool the extension registered, as ST would after a model tool call.
    toolInvoke: HELPERS + String.raw`
        await openChat();
        const tm = ctx().ToolManager;
        const before = new Set(['GenerateImage']);
        const names = tm.tools.map(t => t.toFunctionOpenAI().function.name).filter(n => !before.has(n));
        const out = { tools: names, results: {} };
        for (const name of names) {
            const params = JSON.stringify({ notation: '2d6+3', formula: '2d6+3', dice: '2d6+3', expression: '2d6+3', reason: 'harness test' });
            try { out.results[name] = String(await tm.invokeFunctionTool(name, params)).slice(0, 300); }
            catch (e) { out.results[name] = 'THREW: ' + e.message; }
        }
        await sleep(2500);
        return out;
    `,

    wordcount: HELPERS + String.raw`
        await openChat();
        await exec('/send one two three');
        await exec('/sendas name=Seraphina four five');
        await exec('/sys six seven eight nine');
        let c = ctx();
        const sysIdx = c.chat.length - 1;
        await exec('/hide ' + sysIdx);
        c = ctx();
        const last = c.chat.slice(-10);
        const out = {
            chatLen: c.chat.length,
            sysIsSystem: c.chat[sysIdx].is_system,
            expectedAll: last.reduce((a, m) => a + words(m.mes), 0),
            expectedNoSys: last.filter(m => !m.is_system).reduce((a, m) => a + words(m.mes), 0),
        };
        try { out.plain = await exec('/wordcount'); } catch (e) { out.plainError = String(e.message); }
        try { out.piped = await exec('/wordcount | /pass'); } catch (e) { out.pipedError = String(e.message); }
        const es = c.extensionSettings;
        let found = null;
        for (const [k, v] of Object.entries(es)) {
            if (v && typeof v === 'object' && !Array.isArray(v)) {
                for (const [kk, vv] of Object.entries(v)) if (typeof vv === 'boolean' && /system/i.test(kk)) found = [k, kk, vv];
            }
        }
        out.setting = found;
        if (found) {
            es[found[0]][found[1]] = !found[2];
            try { out.toggled = await exec('/wordcount'); } catch (e) { out.toggledError = String(e.message); }
            es[found[0]][found[1]] = found[2];
        }
        return out;
    `,

    sceneNotes: HELPERS + String.raw`
        const out = {};
        const blocks = [...document.querySelectorAll('#extensions_settings > *, #extensions_settings2 > *')]
            .filter(el => /scene notes/i.test(el.textContent));
        out.found = blocks.length;
        const b = blocks[0];
        if (!b) return out;
        out.column = b.parentElement.id;
        const toggle = b.querySelector('.inline-drawer-toggle');
        const content = b.querySelector('.inline-drawer-content');
        out.hasInlineDrawer = !!(toggle && content);
        out.initiallyOpen = visible(content);
        if (toggle) { toggle.click(); await sleep(900); out.openAfterOneClick = visible(content); }
        out.controls = {
            checkbox: !!b.querySelector('input[type=checkbox]'), textarea: !!b.querySelector('textarea'),
            select: !!b.querySelector('select'), range: !!b.querySelector('input[type=range]'),
        };
        const range = b.querySelector('input[type=range]');
        if (range) {
            range.value = '7';
            range.dispatchEvent(new Event('input', { bubbles: true }));
            range.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(300);
            const shown = [...b.querySelectorAll('input[type=number], span, small, output, label, div')]
                .filter(el => el !== range && el.children.length === 0)
                .some(el => (el.value ?? el.textContent ?? '').trim() === '7');
            out.sliderShows7 = shown;
        }
        const ta = b.querySelector('textarea');
        if (ta) { ta.value = 'keep me'; ta.dispatchEvent(new Event('input', { bubbles: true })); }
        const clearCandidates = [...b.querySelectorAll('.menu_button, button, input[type=button], [role=button]')]
            .filter(el => /^\s*clear\b/i.test((el.textContent || el.value || el.title || '').trim()));
        const clearBtn = clearCandidates[0];
        out.clearCandidates = clearCandidates.map(e => e.outerHTML.slice(0, 160));
        out.clearFound = !!clearBtn;
        const before = openPopups().length;
        const origConfirm = window.confirm;
        let nativeConfirm = false;
        window.confirm = () => { nativeConfirm = true; return false; };
        if (clearBtn) { clearBtn.click(); await sleep(900); }
        window.confirm = origConfirm;
        out.nativeConfirmUsed = nativeConfirm;
        out.stPopupOpened = openPopups().length > before;
        if (out.stPopupOpened) await closeTopPopup();
        out.textAfterCancel = ta?.value;
        return out;
    `,

    tokenButtons: HELPERS + String.raw`
        await openChat();
        await exec('/send hello there friend');
        await exec('/sendas name=Seraphina general kenobi');
        await sleep(800);
        const out = {};
        const html = await (await fetch('/')).text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        // Classes ST adds at runtime (keyboard/a11y observers) are not extension buttons.
        const coreClasses = new Set([...doc.querySelectorAll('#message_template *')].flatMap(e => [...e.classList]).concat(['interactable', 'not_focusable']));
        const newEls = (root) => [...root.querySelectorAll('*')].filter(e => [...e.classList].some(c => !coreClasses.has(c)) && !e.closest('.mes_text, .mes_reasoning, .mes_img_container'));
        const mes = [...document.querySelectorAll('#chat .mes')];
        out.messages = mes.length;
        out.messagesWithNewButton = mes.filter(m => newEls(m.querySelector('.mes_buttons') || m).length > 0).length;
        const lastNew = newEls(mes.at(-1)?.querySelector('.mes_buttons') || mes.at(-1) || document.body);
        out.newButtonClasses = lastNew.slice(0, 3).map(e => e.className);
        if (lastNew[0]) {
            const before = openPopups().length;
            lastNew[0].click();
            await sleep(1500);
            const p = openPopups().at(-1);
            out.messagePopupOpened = openPopups().length > before;
            out.messagePopupText = p ? p.innerText.slice(0, 300) : null;
            out.messagePopupHasNumber = p ? /\d/.test(p.innerText) : false;
            if (p) await closeTopPopup();
        }
        const tmpl = await (await fetch('/scripts/templates/wandMenu.html')).text();
        const tdoc = new DOMParser().parseFromString('<div>' + tmpl + '</div>', 'text/html');
        // token_counter is the built-in Token Counter extension's wand item.
        const coreIds = new Set([...tdoc.querySelectorAll('[id]')].map(e => e.id).concat(['token_counter']));
        const items = [...document.querySelectorAll('#extensionsMenu .list-group-item, #extensionsMenu > *')]
            .filter(e => /token/i.test(e.textContent) && !coreIds.has(e.id));
        out.wandItems = items.map(e => ({ id: e.id, cls: e.className, text: e.textContent.trim().slice(0, 60) }));
        out.wandButtonVisible = visible(document.querySelector('#extensionsMenuButton'));
        if (items[0]) {
            const before = openPopups().length;
            items[0].click();
            await sleep(2500);
            const p = openPopups().at(-1);
            out.wandPopupOpened = openPopups().length > before;
            out.wandPopupClasses = p ? p.className : null;
            out.wandPopupText = p ? p.innerText.slice(0, 300) : null;
            if (p) await closeTopPopup();
        }
        return out;
    `,
};
