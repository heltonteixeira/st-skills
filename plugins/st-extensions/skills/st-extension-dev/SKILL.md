---
name: st-extension-dev
description: Write SillyTavern (ST) extensions the way ST itself does - folder layout, manifest.json, the init/activate entry point, getContext() APIs, saved settings, chat and character data, events, prompt injection, generate interceptors, background LLM calls (generateQuietPrompt, generateRaw, Connection Manager), function-calling tools, slash commands (STscript), macros, i18n, and optional companion server plugins. Use this whenever the user wants to create, extend, fix, review or modernize a SillyTavern extension or ST server plugin - even if they only say "ST", "Tavern", "a /command", "an extension that reacts to messages" or describe the feature without naming the API. Pair with st-extension-ui for HTML/CSS and native-looking UI.
---

# SillyTavern extension development

Checked against SillyTavern 1.19.0 (`release`). File references are relative to the ST root; when
something here may have changed, read that file in the user's ST install or a clone of
`SillyTavern/SillyTavern` - the source is the authority, the official docs lag behind it in places.

An ST "UI extension" is an ES module that runs in the browser inside ST's single page, next to
~15 built-ins and any number of third-party extensions, for users on any ST install (single or
multi-user, any API backend, desktop or phone). Most of the rules below exist because of that:
your code shares one document, one settings file and one event bus with everybody else, and must
survive ST updates.

## Core rules

1. **Use `SillyTavern.getContext()`, not imports from ST files.** A static import of a renamed
   export stops the whole module from linking, so the extension silently fails to load; a missing
   `getContext()` property is just `undefined` and can be feature-checked. Libraries come from
   `SillyTavern.libs` (lodash, DOMPurify, moment, Fuse, showdown, localforage, ...).
2. **Call `getContext()` again every time you need state.** It returns a fresh snapshot;
   `chatMetadata`, `characterId`, `chatId`, `extensionPrompts` are replaced when the chat changes.
3. **Namespace everything** with one id: settings key, `chatMetadata` key, `message.extra` key,
   prompt keys, slash command names, DOM ids, CSS selectors, log prefix.
4. **Survive chat switches.** After any `await`, check the chat is still the same before writing.
5. **Make every save explicit and debounced**: `saveSettingsDebounced()`, `saveMetadataDebounced()`,
   `await saveChat()` after changing messages.
6. **Degrade, don't break.** Missing Connection Manager, tool calling off, server plugin absent,
   group chat, no chat open: detect and skip, with a toast if the user asked for the action.

## Skeleton of a new extension

```
my-extension/                 (the folder name comes from the git repo name on install)
  manifest.json
  index.js
  settings.html               (UI: see st-extension-ui)
  style.css
  i18n/de-de.json             (optional translations)
```

`manifest.json`:
```json
{
    "display_name": "My Extension",
    "loading_order": 100,
    "js": "index.js",
    "css": "style.css",
    "author": "your-name",
    "version": "1.0.0",
    "homePage": "https://github.com/you/my-extension",
    "auto_update": true,
    "minimum_client_version": "1.17.0",
    "hooks": { "activate": "init" }
}
```
- `hooks.activate` names an **exported** function the loader calls after loading your JS and CSS.
  That is how every built-in starts in 1.19.0. Hooks exist since ST **1.17.0** (`clean` since
  **1.18.0**), so set `minimum_client_version` accordingly: older ST then shows a clear load error
  instead of silently never calling `init`.
- Every field, all hooks (`install`, `update`, `delete`, `clean`, `enable`, `disable`),
  `generate_interceptor`, `dependencies` and `i18n` are in `references/manifest-and-lifecycle.md`.

`index.js`:
```js
const MODULE = 'my_extension';                       // settings / metadata / extra key
const LOG = '[My Extension]';
// "third-party/<folder>" without hard-coding the folder (it comes from the user's git URL):
const EXT_PATH = decodeURIComponent(new URL('.', import.meta.url).pathname)
    .replace(/^\/scripts\/extensions\//, '').replace(/\/$/, '');

const defaultSettings = Object.freeze({ enabled: true, depth: 2, items: [] });

function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    extensionSettings[MODULE] ??= {};
    const s = extensionSettings[MODULE];
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (!Object.hasOwn(s, key)) s[key] = structuredClone(value);   // clone: never share default arrays
    }
    return s;
}

export async function init() {
    const ctx = SillyTavern.getContext();
    const settings = getSettings();

    const html = await ctx.renderExtensionTemplateAsync(EXT_PATH, 'settings');
    $('#extensions_settings2').append(html);
    $('#my_extension_enabled').prop('checked', settings.enabled).on('input', function () {
        settings.enabled = $(this).prop('checked');
        ctx.saveSettingsDebounced();
    });

    ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, onChatChanged);
    registerCommands();
}
```
- Keep **top-level code side-effect free** (constants and function definitions only). The loader
  `import()`s your module to run hooks even while the extension is disabled, so top-level DOM work
  or event registration would run for a disabled extension.
- When `init` runs, `extensionSettings` already holds saved values, but no chat is open and the
  character list is empty. Put chat-dependent work in `CHAT_CHANGED` / `APP_READY` handlers
  (`APP_READY` fires immediately for a listener added after it happened). The loader waits for
  `init` up to 5 s before moving on to the next extension - defer slow work.
- `renderExtensionTemplateAsync(EXT_PATH, 'settings', data)` runs Handlebars, DOMPurify and i18n.
  Inline `on*=` handlers and `<script>` are stripped; bind events in JS.
- The older `jQuery(async () => { ... })` entry point still works and appears in the official
  example repo, but it is not part of the sequential load and built-ins no longer use it. Use it only
  if the user must support ST older than 1.17.
- Built-in extensions in `public/scripts/extensions/` are good examples of behaviour (`token-counter`
  is the smallest complete one) but **not of imports**: they import internals with paths one level
  shallower than a third-party extension's, which is exactly what rule 1 avoids.

## What to use for what

| Goal | API (all from `getContext()` unless noted) | Reference |
|---|---|---|
| Global settings | `extensionSettings[MODULE]` + `saveSettingsDebounced()` | `references/data-and-persistence.md` |
| Per-chat state | `chatMetadata[MODULE]` (re-read each time) + `saveMetadataDebounced()` | same |
| Per-message data | `chat[i].extra[MODULE]` + `await saveChat()` (follows the active swipe) | same |
| Per-character data (travels with the card) | `writeExtensionField(characterId, MODULE, value)` | same |
| Small per-account value | `accountStorage.setItem/getItem` | same |
| Secrets (API keys) | **not in the browser** - a server plugin | `references/server-plugins.md` |
| React to messages, chat switch, generation | `eventSource.on(eventTypes.X, fn)` | `references/events.md` |
| Add text to the prompt | `setExtensionPrompt(key, text, position, depth, scan, role)` | `references/generation.md` |
| Rewrite the chat sent to the model | manifest `generate_interceptor` | `references/generation.md` |
| Ask the LLM in the background | `generateQuietPrompt` / `generateRaw` / `ConnectionManagerRequestService` | `references/generation.md` |
| Let the model call your code | `registerFunctionTool({...})` | `references/generation.md` |
| `{{myMacro}}` in prompts | `macros.register(...)` (+ legacy fallback) | `references/generation.md` |
| `/mycommand` in STscript | `SlashCommandParser.addCommandObject(SlashCommand.fromProps({...}))` | `references/slash-commands.md` |
| Translations | `t\`...\``, `data-i18n`, manifest `i18n` | `references/i18n.md` |
| Token count | `await getTokenCountAsync(text)` | `references/generation.md` |
| Call ST's server | `fetch(url, { method: 'POST', headers: getRequestHeaders(), body })` | `references/context-api.md` |
| Filesystem, CORS-blocked HTTP, secrets, child processes | companion **server plugin** | `references/server-plugins.md` |
| Anything else on `getContext()` | full inventory, deprecated members | `references/context-api.md` |

## Patterns worth copying exactly

**Chat-switch guard** (built-in `memory` does this):
```js
async function summarizeMessage(messageId) {
    const before = SillyTavern.getContext();
    const chatId = before.getCurrentChatId();
    const text = before.chat[messageId]?.mes;
    if (!text) return;

    const summary = await before.generateRaw({ prompt: `Summarize in one sentence:\n\n${text}` });

    const now = SillyTavern.getContext();
    if (now.getCurrentChatId() !== chatId) return;      // user switched chats while we waited
    const message = now.chat[messageId];
    if (!message) return;
    message.extra ??= {};
    message.extra[MODULE] = { summary: summary.trim() };
    await now.saveChat();
}
```
`chat` is the same array object across chats (ST refills it in place), so a stored index silently
points into another chat after a switch - only the id comparison catches it.

**Event handlers that do not stall ST.** `eventSource.emit` awaits every listener in turn, so a
slow listener delays message rendering and saving. Return quickly and do heavy work un-awaited or
debounced (`SillyTavern.libs.lodash.debounce`). Filter events by type, e.g. `MESSAGE_RECEIVED`
also fires for `'first_message'` (every time a one-message chat opens), `'command'`, `'extension'`,
per group member and per tool-call round. Do not trigger your own background generation from
events caused by a quiet generation (`GENERATION_STARTED` type `'quiet'`).

**Prompt injection that survives chat loads.** `clearChat()` wipes **all** extension prompts on
every chat load and reload, so set yours again on `CHAT_CHANGED` (and when the value changes):
```js
// Mirrors of extension_prompt_types / extension_prompt_roles in public/script.js. They are not on
// getContext(), and importing them from script.js would break rule 1; the values have been stable.
const PROMPT_POSITION = Object.freeze({ NONE: -1, IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2 });
const PROMPT_ROLE = Object.freeze({ SYSTEM: 0, USER: 1, ASSISTANT: 2 });

const { setExtensionPrompt } = SillyTavern.getContext();
// argument order: key, value, position, depth, scan, role   (scan BEFORE role)
setExtensionPrompt(MODULE, `Scene location: ${location}`, PROMPT_POSITION.IN_CHAT, 4, false, PROMPT_ROLE.SYSTEM);
setExtensionPrompt(MODULE, '', PROMPT_POSITION.IN_CHAT, 4);   // remove
```

**Slash command arguments are strings and defaults are not applied.** `defaultValue`, `isRequired`,
`typeList` and `enumList` only drive help and autocomplete. Parse and default inside the callback
and always return a string:
```js
callback: async (args, value) => {
    const count = Number(args.count ?? 10);
    if (!Number.isInteger(count) || count < 1) throw new Error('count must be a positive integer');
    return String(result);
}
```

**Calling ST endpoints or your server plugin.** Every non-GET request needs the CSRF header:
`headers: getRequestHeaders()` (`getRequestHeaders({ omitContentType: true })` for `FormData`).

## Security

- Treat chat text, character cards, model output and imported files as untrusted HTML: insert with
  `.text()`, or `SillyTavern.libs.DOMPurify.sanitize()` before `.html()`. Popups and slash-command
  `helpString` are inserted as raw HTML.
- Never `eval`/`new Function` user content. Never store API keys in `extensionSettings` (plain text
  in `settings.json`, readable by every extension) - use a server plugin.
- Server plugins run with full Node access for every user of the server: validate every body
  field, sanitize file names, keep files under `req.user.directories`, and try/catch every async
  route (an unhandled rejection can take down the whole ST server).

## Before you finish - checklist

- [ ] `manifest.json` has `display_name`, `js`, `version`, `loading_order`, `hooks.activate` + matching `export`, `minimum_client_version`.
- [ ] No imports from ST internals (or, if unavoidable, isolated in one module with the correct `../../../../` depth and a comment why).
- [ ] Top-level code has no side effects; setup lives in `init`.
- [ ] Settings defaults merged per key with `structuredClone`; saves debounced.
- [ ] Every async path re-reads `getContext()` and guards against a chat switch before writing.
- [ ] Extension prompts re-applied on `CHAT_CHANGED`; message changes followed by `await saveChat()`.
- [ ] Event handlers filtered by type, cheap, and not re-entrant with your own generations.
- [ ] Slash commands: prefixed name, values parsed from strings, explicit defaults, string return, `t`-localized help.
- [ ] Untrusted text escaped or sanitized; no secrets in settings.
- [ ] Works with no chat open, in group chats, and with the optional feature (tool calling, Connection Manager, server plugin) unavailable.
- [ ] A `clean` hook removes your settings key if the extension stores anything sizeable (needs ST 1.18).
- [ ] Install notes: repo URL for "Install extension"; for a server plugin, `enableServerPlugins: true` and a restart.

## Reference files (read the one you need)

- `references/manifest-and-lifecycle.md` - every manifest field, install locations and URLs, load order, hooks, update/delete behaviour, import depth.
- `references/context-api.md` - full `getContext()` inventory (with deprecated members), `SillyTavern.libs`, server endpoints.
- `references/data-and-persistence.md` - settings, chat metadata, message objects and `extra`, adding/editing/deleting messages, character cards, account storage.
- `references/events.md` - every event with payload and when it fires; `on/once/makeFirst/makeLast/removeListener`; emit semantics.
- `references/generation.md` - generation pipeline order, `setExtensionPrompt`, interceptors, LLM call APIs compared, tool calling, macros, variables, world info, tokens.
- `references/slash-commands.md` - registration, argument props, enum providers, closures, calling STscript from JS.
- `references/i18n.md` - `t`, `translate`, `data-i18n`, manifest `i18n`, locale codes.
- `references/server-plugins.md` - Node-side plugins: loading, exports, routes, `req.user`, security, probing from the UI, install.
