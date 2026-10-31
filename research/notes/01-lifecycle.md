# 01 — Extension structure, manifest, lifecycle, settings, getContext

Source: `dev-st` = SillyTavern 1.19.0 @ 06bde93 (shallow clone). All paths relative to `dev-st/`.
Docs: `research/st-docs/For_Contributors/Writing-Extensions.md` (cited as `WE.md:line`).
Rule applied: source wins; mismatches listed in the last section.

---

## 1. Where extensions live and how URLs map

| Kind | Disk location | Internal name (key in `manifests`, `disabledExtensions`, `dependencies`) | URL |
|---|---|---|---|
| Built-in ("system") | `public/scripts/extensions/<name>/` | `<name>` (e.g. `memory`) | `/scripts/extensions/<name>/…` |
| Third-party, per-user ("local") | `data/<user-handle>/extensions/<Folder>/` | `third-party/<Folder>` | `/scripts/extensions/third-party/<Folder>/…` |
| Third-party, global ("global", "Install for all users") | `public/scripts/extensions/third-party/<Folder>/` | `third-party/<Folder>` | same URL as local |

- Dir constants: `src/constants.js:5-6` (`extensions`, `globalExtensions`), user subdir `extensions` `src/constants.js:37`.
- Discovery `GET /api/extensions/discover` `src/endpoints/extensions.js:480-534`: built-ins = subfolders of
  `public/scripts/extensions` except `third-party`; then user folders; then global folders **filtered out if a user
  folder with the same name exists** (`:527`, user wins). Folders without `manifest.json` are skipped with a server
  warning (`:497-503`). Only direct subfolders are scanned (no nesting).
- URL mapping: `src/users.js:1219` mounts `/scripts/extensions/third-party/*` → `createExtensionsRouteHandler`
  (`src/users.js:1092-1118`): serve from the user's `extensions` dir if the file exists, else from the global dir, else 404;
  path-traversal guarded (`isPathUnderParent`). So per-user and global extensions share one URL space.
- Folder name = `sanitize(basename(url, '.git'))` of the git URL at install (`src/endpoints/extensions.js:122`).
  The extension does NOT choose its folder name — never hard-code it. (See §6 for deriving it at runtime.)
- Whole extension system can be turned off by server config `extensions.enabled` (`default/config.yaml:297-299`);
  the guard 404s all `/api/extensions/*` and third-party file routes (`src/endpoints/extensions.js:72-81`, `src/users.js:1219`);
  client then skips loading (`public/script.js:8021-8033`).

### Relative import depth
Entry file of a third-party ext is served at `/scripts/extensions/third-party/<Folder>/index.js`, so:
- `/script.js` → `../../../../script.js`
- `/scripts/extensions.js` → `../../../extensions.js`
- `/scripts/<x>.js` → `../../../<x>.js`; `/lib.js` → `../../../../lib.js`
- each subfolder inside your extension adds one more `../`.
Built-ins sit one level shallower (`public/scripts/extensions/<name>/index.js` uses `'../../../script.js'`,
e.g. `public/scripts/extensions/token-counter/index.js:1`). Copying imports from a built-in into a third-party
extension therefore breaks (off by one `../`).

**Why `getContext()` is preferred** (WE.md:270-274, 1414-1424): a static `import { x } from '../../../../script.js'`
is resolved at module link time — if ST renames/removes `x`, the *whole module fails to link* and the extension does not
load at all (script `onerror` → load error, §3). A missing property on `SillyTavern.getContext()` is just `undefined`
at runtime and can be feature-detected. `SillyTavern` is a true global (`public/script.js:293-296`), so no path
arithmetic is needed and bundled (webpack) extensions can use it too.

### Install / update / delete (git) — `src/endpoints/extensions.js`
- Install `POST /api/extensions/install` `{url, global, branch}` (`:92-156`): http/https only; non-admin cannot
  `global:true` (403); 409 if folder exists; `git clone --depth 1 [--branch]` (`:134-138`). Manifest must parse as a
  JSON object or the clone is deleted (`:141-151`). Responds `{version, author, display_name, extensionPath, folderName}`.
- Client install (`public/scripts/extensions.js:1698-1775`): warning popup for non-`github.com/SillyTavern/*` URLs
  (`:69-75`, `:1713-1740`); after success calls `loadExtensionSettings({}, false, false)` which re-runs activation, so
  the new extension's JS is **loaded live without reload**, then emits `EXTENSION_SETTINGS_LOADED` and calls the
  `install` hook (`:1766-1772`). Order for a fresh install: script eval → `activate` hook → `install` hook.
- Update `POST /api/extensions/update` (`:169-215`): `git fetch` + `git pull origin <current branch>` if behind.
  Client calls `update` hook then toasts "Reload the page to apply updates" (`public/scripts/extensions.js:1383-1391`).
- Version check `POST /api/extensions/version` (`:387-432`) → `{currentBranchName, currentCommitHash, isUpToDate, remoteUrl}`;
  non-git folders report up-to-date (`:414-418`).
- Branches `POST /branches` (unshallows the repo, lists local+remote) `:217-264`; switch `POST /switch` `:266-327`;
  move local↔global `POST /move` (admin only) `:329-375`; delete `POST /delete` (`fs.rm` recursive) `:442-474`.
- Client delete (`public/scripts/extensions.js:1561-1588`): optional `clean` hook → `delete` hook → server delete →
  `saveSettings()` → reload after 1 s. The extension's `extension_settings` key is NOT removed automatically —
  only your `clean` hook can do that.
- Auto-update: on ST version change if server `extensions.autoUpdate` (`default/config.yaml:301`) only for manifests with
  `auto_update: true` (`public/scripts/extensions.js:1988-2015`, called from `:1809-1811`). Daily "updates available"
  toast if user enabled "Notify on extension updates" (`:1819-1825`, `:1929-1981`; also only `auto_update` manifests).
- Non-admins are blocked client-side and server-side from update/delete/branch/move of global extensions.

---

## 2. manifest.json — what is actually read

Client loader reads manifests via `fetch('/scripts/extensions/<name>/manifest.json')` (`public/scripts/extensions.js:537-562`).
A manifest that fails to fetch/parse drops the extension (`:1800-1807`). Server reads only `version, author, display_name`
on install (`src/endpoints/extensions.js:146`).

| Field | Type | Read at | Effect / default |
|---|---|---|---|
| `display_name` | string | `extensions.js:49-50,581,917,1966` | Shown in Manage Extensions; secondary sort key; error messages fall back to internal name. Not validated (docs say "required"). |
| `loading_order` | number (or numeric string) | `:49` `parseInt(a)-parseInt(b) \|\| display_name compare` | Lower loads first and runs its interceptor first. Missing → `NaN` → comparator falls back to name comparison (ordering vs numbered manifests is inconsistent). Built-ins use 1–100. |
| `js` | string, path relative to ext folder | `:813-841` | Injected as `<script type="module" id="<name>-js" async src=…>`. Missing → nothing loaded but extension still counts as active (CSS-only ext is possible). |
| `css` | string | `:781-805` | `<link rel=stylesheet id="<name>-css">` in `<head>`. Only one file. |
| `i18n` | `{ "<locale>": "path.json" }` | `:848-877` | Only the current locale's file is fetched and passed to `addLocaleData` *before* the JS loads. Fetch errors are logged and ignored. |
| `requires` | string[] | `:578,595-602,986` | Extras API modules (deprecated Extras). Must all be present in `modules` or ext doesn't load. Non-array → warning, load allowed. |
| `optional` | string[] | `:972-983` | Display only ("Optional modules: …"). |
| `dependencies` | string[] of internal names (`"vectors"`, `"third-party/Foo"`) | `:579,608-624` | All must be discovered AND not disabled, else ext doesn't load (error recorded). Non-array → warning, allowed. No ordering guarantee — use `loading_order` to load after deps. |
| `minimum_client_version` | semver string | `:580,588-590` | `versionCompare(CLIENT_VERSION.split(':')[1], min)` = `localeCompare(..., {numeric:true}) > -1` (`public/scripts/utils.js:2898-2900`). Fail → not loaded + error. Comment says null passes, but code only skips `undefined` → `null` would be compared as the string "null" (UNVERIFIED runtime result; just omit the key). |
| `generate_interceptor` | string (global fn name) | `:2024-2049` | See §3.4. |
| `hooks` | `{install,update,delete,clean,enable,disable,activate: "<exportedFnName>"}` | `:388-466` | See §3.3. |
| `auto_update` | boolean | `:1958,1989,2008` | Opt-in to auto-update on ST version change and to update notifications. |
| `version` | string | `:918` | Displayed next to name (plus `(branch-commit)` from git). |
| `author` | string | server `:146` only | Returned by install endpoint; **never displayed** — the UI shows the GitHub owner parsed from the git remote (`:1898-1908`, `getAuthorFromUrl` `:2283-2300`). |
| `homePage` | string | — | **Not read anywhere** in client or server (grep). The name links to the git remote URL instead (`:1883-1896`). |

Missing deps / failed load: nothing throws to the user; messages are added to `extensionLoadErrors` and the
"Manage extensions" button gets a `warning` class (`:641-665`); the list shows them in red (`:1105-1120`).
`getContext().getExtensionManifest(name)` returns a deep clone of any manifest, short or full name (`:524-530`).

Minimal recommended manifest for a third-party extension:
```json
{
  "display_name": "My Extension",
  "loading_order": 100,
  "js": "index.js",
  "css": "style.css",
  "author": "you",
  "version": "1.0.0",
  "homePage": "https://github.com/you/my-extension",
  "auto_update": true,
  "minimum_client_version": "1.19.0",
  "hooks": { "activate": "init", "clean": "onClean" }
}
```

---

## 3. Loading order and activation

### 3.1 Boot sequence (`public/script.js`)
`jQuery(async () => { … await firstLoadInit(); })` (`:11101`, `:12591`). Inside `firstLoadInit` (`:694-791`):
1. CSRF token fetched (`:696-698`), loader overlay shown, `initLibraryShims()` (window.Fuse/DOMPurify/moment/…) (`:730`),
   `addDOMPurifyHooks()` (`:732`), client version, secrets state, locales.
2. `await initExtensions()` (`:747`) — only builds the wand menu + Manage UI handlers (`public/scripts/extensions.js:2302-2324`).
3. `await getSettings()` (`:752`) → settings.json parsed → … → `loadExtensionSettings(settings, …)` (`:8021-8025`):
   `Object.assign(extension_settings, settings.extension_settings)` (`extensions.js:1784-1786`), emit
   `EXTENSIONS_FIRST_LOAD` (before discovery — your extension cannot hear it on first load), discover, fetch manifests,
   optional auto-update, then **`activateExtensions()`** (`:1813`), then `EXTENSION_SETTINGS_LOADED` (`script.js:8025`),
   then `settingsReady = true` and `SETTINGS_LOADED` (`script.js:8045-8047`).
4. Afterwards: `getCharacters()` (`:759`), world info, personas, slash autocomplete, etc.
5. `APP_INITIALIZED` (`:787`) → hide loader → `APP_READY` (`:790`). Both are "auto-fire" events: a listener added
   after they fired is invoked immediately with the last args (`public/scripts/events.js:113`, `public/lib/eventemitter.js:56-57,155-157`).

Consequences for your entry module:
- `extension_settings` already holds the saved values when your top-level code runs.
- `characters` is still `[]`, no chat is loaded, `characterId` is `undefined`, `settingsReady` is false
  (`saveSettings()` called now just re-schedules a debounced save, `script.js:8052-8056`).
- Do UI injection at init; do chat/character-dependent work in `APP_READY` / `CHAT_CHANGED` handlers.

### 3.2 activateExtensions (`public/scripts/extensions.js:568-666`)
- Manifests sorted by `loading_order` then name; for each (skipping already-active, disabled, unmet requires/deps/version):
  `addExtensionLocale(...).finally(() => Promise.all([script, style]))` then `activeExtensions.add(name)` and
  `callExtensionHook(name, 'activate')`. The loop **awaits each extension in turn** (`:634`), so extensions load
  sequentially; an `activate` hook (≤5 s, see below) blocks the next extension.
- Script promise resolves on the `<script type=module>` `load` event (`:832-837`) — i.e. after the module (and its static
  imports) evaluated. Link/fetch errors → `onerror` → recorded as load error. A runtime throw in top-level code is
  reported to the console but (UNVERIFIED, standard browser behaviour) still fires `load`, so the ext counts as active.
  Whether `load` waits for top-level `await` is UNVERIFIED — don't rely on TLA to block the loader.
- Note: if a `<script id>`/`<link id>` with the same id already exists, the promise never settles (`:790,823`) — edge case.

### 3.3 Manifest lifecycle hooks (`:388-466`)
`callExtensionHook` does `await import('/scripts/extensions/<name>/<js>')`, calls the exported function with **no args**,
awaits it raced against a **5000 ms timeout** (on timeout: warn and continue; the hook keeps running), catches/logs errors.

| Hook | Called from | When |
|---|---|---|
| `activate` | `:636-638` | After JS+CSS loaded, every page load (also live after install). |
| `install` | `:1769-1772` | After install + live activation. |
| `update` | `:1388-1389` | After a git pull that changed something (before reload). |
| `delete` | `:1568` | Before server deletion. |
| `clean` | `:1446-1455`, `:1564-1566` | "Clean extension data" button (only rendered if the hook exists, `:1039-1041`) or delete-with-cleanup checkbox; then `saveSettings()` + reload. |
| `enable` / `disable` | `:473-500` | Before toggling `disabledExtensions` and `saveSettings()`; page reload follows (unless batch toggle). |

Source-derived caveats (not in docs):
- ES modules are cached by URL, so `update`/`delete` hooks run the **already-loaded (old) module's** function, not the
  newly pulled code (inference from `import(url)` semantics; high confidence).
- For a *disabled* extension, `enable`/`clean`/`delete` hooks `import()` the module, which **executes its top-level code**
  in a session where it is supposed to be off. Keep top-level code side-effect-free; put setup in `init`.
- `hooks` support version is UNVERIFIED (shallow clone). On an older ST that ignores `hooks`, an extension whose only
  entry point is `hooks.activate` would never initialise → pin `minimum_client_version`, or use the jQuery pattern.

### 3.4 Generate interceptors (`:2024-2049`, call site `public/script.js:4562-4564`)
Not dry-run only. For every manifest with `generate_interceptor`, sorted by `loading_order`, calls
`globalThis[name](chat, contextSize, abort, type)` and awaits it; errors logged; `abort(true)` stops later interceptors.
Function must be assigned on `globalThis` (built-ins: `stable-diffusion` → `SD_ProcessTriggers`, `vectors` → `vectors_rearrangeChat`).

### 3.5 Entry-point patterns
**Current built-in convention (all 14 built-ins):** export `init` and declare `"hooks": {"activate": "init"}`
(e.g. `public/scripts/extensions/token-counter/manifest.json`, `token-counter/index.js:104`, `translate/index.js:710`,
`memory/index.js:1066`). No built-in uses `jQuery(async () => …)` as an entry point any more.
```js
// index.js
export async function init() {
    const ctx = SillyTavern.getContext();
    const html = await ctx.renderExtensionTemplateAsync('third-party/my-ext', 'settings');
    $('#extensions_settings2').append(html);
    ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, onChatChanged);
}
```
**Legacy/third-party convention (st-extension-example, still works):**
```js
jQuery(async () => { /* build UI, bind events */ });
```
jQuery is 3.5.1 (`public/index.html:8201`); since jQuery 3 ready-callbacks are always async, so this runs shortly
*after* the loader has moved on — i.e. it is not part of the sequential load and is not awaited. Docs guidance
(WE.md:144-148): `activate` hook for setup during loading; `APP_INITIALIZED` for after-all-extensions setup while loader
is visible; `APP_READY` for non-blocking work (handler is awaited → defer heavy work with a timer).

### 3.6 UI mount points
- Settings drawers: `#extensions_settings` (left column) / `#extensions_settings2` (right) (`public/index.html:5773,5791`),
  each pre-seeded with built-in `#<x>_container` divs. Third-party: append to one of the two columns.
- Wand ("Extensions") menu: `#extensionsMenu` from `public/scripts/templates/wandMenu.html`, with
  `#<x>_wand_container` slots; third-party add a `.list-group-item` to `#extensionsMenu` (button auto-shows when
  it has visible children, `extensions.js:228-242`). Item markup idiom: `token-counter/index.js:105-110`.
- Drawer markup idiom (`.inline-drawer` / `.inline-drawer-toggle` / `.inline-drawer-content`): `caption/settings.html:2-8`, WE.md:249-264.

---

## 4. Templates

```js
renderExtensionTemplateAsync(extensionName, templateId, templateData = {}, sanitize = true, localize = true)
// public/scripts/extensions.js:137-139 → renderTemplateAsync(`scripts/extensions/${extensionName}/${templateId}.html`, …, fullPath=true)
renderExtensionTemplate(...)  // sync XHR, @deprecated (:125-127)
```
- `extensionName` is the path under `scripts/extensions/`: built-in `'memory'`, third-party `'third-party/<Folder>'`.
  `templateId` is a path without `.html` (subfolders allowed, e.g. `'templates/foo'`).
- Engine (`public/scripts/templates.js:60-88`): fetch by XHR → **Handlebars.compile** (cached per path in
  `TEMPLATE_CACHE`, no invalidation until reload) → `DOMPurify.sanitize` (if `sanitize`) → `applyLocale` (`data-i18n`) (if `localize`).
  On error: console error + toastr "Error rendering template" and returns `undefined` (does not throw).
- Sanitization uses ST's global DOMPurify with hooks from `public/scripts/chats.js:1901-1908`: every element having a
  `target` property (`<a>`, `<form>`) gets `target="_blank" rel="noopener"`. Default DOMPurify strips `<script>` and
  inline `on*=` handlers → bind events with jQuery/`addEventListener` after insertion, never inline.
- Handlebars helpers: `getContext().registerHelper` is a no-op, deprecated ("Handlebars for extensions are no longer
  supported") `public/scripts/st-context.js:177-178`. Use plain `{{var}}`, `{{#if}}`, `{{#each}}`.
- `{{var}}` is HTML-escaped by Handlebars; `{{{var}}}` is raw but still passes through DOMPurify (when sanitize=true).

---

## 5. Settings and persistence

### 5.1 `extension_settings` (global, per user)
- `export const extension_settings = {…}` (`public/scripts/extensions.js:141-226`) — a single object, never reassigned
  (filled via `Object.assign` `:1785`), so caching `const { extensionSettings } = SillyTavern.getContext()` is safe.
  Built-in defaults for built-in keys live there; third-party keys are absent until you create them.
- Persisted inside the user's `settings.json` as `extension_settings` by `saveSettings()` (`public/script.js:8051-8115`;
  payload `:8085`) via `POST /api/settings/save` — the WHOLE settings payload is posted each time (large data = slow).
- Shallow `Object.assign` on load: a saved key wholly replaces the default sub-object → always merge defaults yourself.
- `saveSettingsDebounced` = `debounce(saveSettings, 1000ms)` (`script.js:466,470`; `debounce_timeout.relaxed`
  `public/scripts/constants.js:14`). Use it for UI changes. `saveSettings` (immediate, awaitable) is **not in getContext**;
  core uses it before reloads (`extensions.js:477,494,1451,1584`). Before `settingsReady` it just re-schedules.
- `extension_settings.disabledExtensions` (array of internal names) is the enable/disable state (`:146,475,492`).

Canonical safe init (docs WE.md:312-326; built-in equivalents `translate/index.js:162-167`, `memory/index.js:141-150`):
```js
const MODULE = 'my_extension';
const defaultSettings = Object.freeze({ enabled: false, option1: 'default', list: [] });
function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    if (!extensionSettings[MODULE]) extensionSettings[MODULE] = structuredClone(defaultSettings);
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(extensionSettings[MODULE], key)) {
            extensionSettings[MODULE][key] = structuredClone(defaultSettings[key]);
        }
    }
    return extensionSettings[MODULE];
}
```
(The docs version copies `defaultSettings[key]` by reference — fine for primitives, shares arrays/objects with the
frozen default otherwise; clone them.) Docs alternative (WE.md:1469-1475):
`extensionSettings[MODULE] = SillyTavern.libs.lodash.merge(structuredClone(defaultSettings), extensionSettings[MODULE])`
— caveat: `_.merge` merges arrays index-by-index (saved `[a]` + default `[x,y]` → `[a,y]`), so avoid non-empty default arrays with it.

### 5.2 Per-chat: `chatMetadata`
- `export let chat_metadata = {}` (`public/script.js:454`) is **reassigned** on every chat load/clear
  (`:900,1351,7099,7657,7663,7748,10640,10756,10928`) and by `updateChatMetadata` (`:8978-8980`).
  `getContext().chatMetadata` is a snapshot of the reference → **always re-read `SillyTavern.getContext().chatMetadata`**,
  never cache it (WE.md:342-344 agrees). `chat` array, by contrast, is mutated in place (`chat.splice(0, …)`) so its
  reference is stable, but re-reading is still the safe habit.
- Persisted in the chat file (JSONL header) with the chat. `saveMetadata()` = `saveChatConditional()` (`script.js:9408-9440`)
  saves the whole chat (or group chat). `saveMetadataDebounced()` (`extensions.js:89-113`, 1000 ms) re-checks that
  character/group didn't change before saving — preferred for frequent writes. Built-in example:
  `quick-reply/src/QuickReplySettings.js:71-77` (`chat_metadata.quickReply = …; saveMetadataDebounced();`).
- Namespace your key (`chatMetadata[MODULE]`). Listen to `CHAT_CHANGED` (`script.js:1723,7700,10760`) to reload state.
- Per-message data: store under `message.extra.<your_key>` then save the chat (`getContext().saveChat`) — UNVERIFIED as an
  official convention (events/chat agent's area).

### 5.3 Per-character: `writeExtensionField`
`writeExtensionField(characterId, key, value)` (`extensions.js:2070-2120`): `characterId` is the **array index**
(`this_chid`), not a stable id. Sets `characters[id].data.extensions[key]` and `json_data` in memory, then
`POST /api/characters/merge-attributes` `{avatar, data:{extensions:{[key]:value}}}` (writes into the card PNG; travels
with exported cards). Pass `getContext().constants.unset` (`UNSET_VALUE` `:2061`) to delete the key; `null` keeps it as null.
Errors only `console.error` (no throw). Bulk: `writeExtensionFieldBulk(avatars|null, key, value, {filterPath})` (`:2152-2221`)
— by avatar filename, `null`/`[]` = all characters.
Read back: `getContext().characters[id].data?.extensions?.[key]`. Pitfall: with `performance.lazyLoadCharacters`
(`src/endpoints/characters.js:35`) non-current characters are **shallow** — `data.extensions` only has `fav` and `world`
(`:369-393`); call `await getContext().unshallowCharacter(id)` first. `characterId` is `undefined` in group chats.

### 5.4 Other stores
- Presets: `getContext().getPresetManager().writePresetExtensionField({path, value, name?})` / `readPresetExtensionField` (WE.md:394-421; not re-verified here).
- `getContext().accountStorage` (`public/scripts/util/AccountStorage.js:40-145`): per-account string KV saved inside
  settings.json (`script.js:8071`), `setItem` triggers `saveSettingsDebounced`. Server-synced alternative to `localStorage`
  (which is per-browser/origin and shared by all ST users on that browser).
- Large data: `SillyTavern.libs.localforage` (IndexedDB) per WE.md:1363-1377 — browser-local, not synced, shared across ST users of the same browser profile.

### 5.5 Secrets
No secret API for UI extensions. `/api/secrets/write` accepts any key (`src/endpoints/secrets.js:511-527`) but the
state/read side only iterates the built-in `SECRET_KEYS` (`:343-365`) and `/find` requires `allowKeysExposure` (`:560-570`),
so a custom key cannot be read back by the browser. `getContext()` exposes no secrets helpers. Docs: never store keys in
`extensionSettings` (plain text, readable by every extension); use a server plugin (WE.md:1329-1340).

---

## 6. getContext() — full inventory (`public/scripts/st-context.js:115-309`)

`SillyTavern.getContext()` builds a **new object on every call**; primitive fields (`characterId`, `groupId`, `chatId`,
`name1`, `name2`, `onlineStatus`, `maxContext`, `mainApi`, `menuType`, `chatMetadata` ref) are snapshots at call time.
Call it again whenever you need current state. Imported internally as `getContext` from `extensions.js` too (`extensions.js:14-18`).

State / data (line 117-135, 152, 200-201, 218-229)
- `accountStorage` — per-account KV (above). `chat` — current chat message array (mutable). `characters` — character list.
- `groups` — group list. `name1` / `name2` — user / character display name. `characterId` — index into `characters` (undefined in groups/none).
- `groupId` — selected group id. `chatId` — current chat file name (derived). `onlineStatus` — API connection status string.
- `maxContext` — context size (Number). `chatMetadata` — current chat's metadata object (re-read!). `extensionPrompts` — injected prompt map.
- `mainApi` — active API type. `extensionSettings` — global extension settings. `tags`, `tagMap` — tag list / entity→tags.
- `menuType` — current right-panel menu. `createCharacterData` — the create-character form state (`create_save`).
- `chatCompletionSettings` (`oai_settings`), `textCompletionSettings`, `powerUserSettings` — live settings objects.
- `CONNECT_API_MAP` — /api command mapping. `symbols.ignore` (IGNORE_SYMBOL), `constants.unset` (UNSET_VALUE).

Persistence: `saveSettingsDebounced`, `saveMetadataDebounced`, `saveMetadata`, `updateChatMetadata(newValues, reset)`,
`saveChat` (= saveChatConditional), `writeExtensionField`, `writeExtensionFieldBulk`, `getPresetManager`.

Network: `getRequestHeaders({omitContentType})` — JSON content-type + `X-CSRF-Token` (`script.js:647-658`).

Events: `eventSource`, `eventTypes`; `event_types` (**deprecated** alias, `:222-223`).

Chat / messages: `getCurrentChatId`, `reloadCurrentChat`, `renameChat`, `openCharacterChat`, `openGroupChat`,
`addOneMessage` (render a message), `deleteLastMessage`, `deleteMessage(id, …)`, `sendSystemMessage`, `saveReply`,
`updateMessageBlock` (re-render one message), `appendMediaToMessage`, `ensureMessageMediaIsArray`, `getMediaDisplay`,
`getMediaIndex`, `scrollChatToBottom`, `scrollOnMediaLoad`, `printMessages`, `clearChat` (visual only),
`messageFormatting` (message → HTML), `messageFormatter` (formatting-pipeline hooks), `activateSendButtons` /
`deactivateSendButtons`, `swipe.{left,right,to,show,hide,refresh,isAllowed,state()}`.

Generation: `generate` (= `Generate`), `generateQuietPrompt`, `generateRaw`, `generateRawData` (raw incl. reasoning),
`sendStreamingRequest`, `sendGenerationRequest`, `stopGeneration`, `streamingProcessor` (current, snapshot),
`extractMessageFromData`, `setExtensionPrompt`, `ChatCompletionService`, `TextCompletionService`,
`ConnectionManagerRequestService`, `getChatCompletionModel`, `getTextGenServer`, `updateReasoningUI`,
`parseReasoningFromString`, `getReasoningTemplateByName`.

Tokens: `tokenizers`, `getTextTokens`, `getTokenCountAsync`, `getTokenizerModel`; `getTokenCount` (**deprecated**).

Characters / groups: `getCharacters` (reload list), `getOneCharacter(avatar)` (refresh one), `getCharacterCardFields`,
`getCharacterSource`, `selectCharacterById(index)`, `unshallowCharacter`, `unshallowGroupMembers`, `getThumbnailUrl(type, file)`,
`importTags`, `importFromExternalUrl`.

Macros / substitution: `substituteParams`, `substituteParamsExtended`, `macros` (new registry);
`registerMacro`, `unregisterMacro` (**deprecated** → `macros.register` / `macros.registry.unregisterMacro`).

Variables: `variables.local.{get,set,del,add,inc,dec,has}`, `variables.global.{…}`.

World info: `loadWorldInfo`, `saveWorldInfo`, `reloadWorldInfoEditor`, `updateWorldInfoList`, `convertCharacterBook`,
`getWorldInfoPrompt`, `getWorldInfoNames()` (copy of names).

Slash commands: `SlashCommandParser`, `SlashCommand`, `SlashCommandArgument`, `SlashCommandNamedArgument`,
`SlashCommandEnumValue`, `ARGUMENT_TYPE`, `executeSlashCommandsWithOptions`; `registerSlashCommand` and
`executeSlashCommands` (**deprecated**).

Tools: `registerFunctionTool`, `unregisterFunctionTool`, `isToolCallingSupported`, `canPerformToolCalls`, `ToolManager`.

UI: `Popup`, `POPUP_TYPE`, `POPUP_RESULT`, `callGenericPopup`, `loader` (action loader); `callPopup`,
`showLoader`, `hideLoader` (**deprecated**). `isMobile`, `shouldSendOnEnter`, `registerDebugFunction`,
`registerDataBankScraper`, `openThirdPartyExtensionMenu(suggestUrl)`.

Extension helpers: `renderExtensionTemplateAsync`; `renderExtensionTemplate` (**deprecated**); `registerHelper`
(**deprecated no-op**); `getExtensionManifest(name)`; `ModuleWorkerWrapper` (= `SimpleMutex`, a non-reentrant
"run callback unless busy" wrapper, `public/scripts/util/SimpleMutex.js`).

i18n / misc: `t` (tagged template), `translate`, `getCurrentLocale`, `addLocaleData` (only for current locale, never overrides
existing keys — `public/scripts/i18n.js:22-39`), `timestampToMoment`, `uuidv4`, `humanizedDateTime`.

Not in getContext (must import from module if needed, unstable): `saveSettings` (immediate), `extension_settings`
helpers like `findExtension`, `enableExtension`/`disableExtension`, `doExtrasFetch`, `modules`, `secret_state`,
`isAdmin` (`public/scripts/user.js:38`).

Deriving your own folder/template path at runtime (no hard-coding): `new URL(import.meta.url).pathname` gives
`/scripts/extensions/third-party/<Folder>/index.js`; strip to get `third-party/<Folder>` for
`renderExtensionTemplateAsync`. (Pattern, not used by built-ins; UNVERIFIED as official guidance.)

### SillyTavern global and libs
`globalThis.SillyTavern = { libs, getContext }` (`public/script.js:293-296`; typed in `public/global.d.ts:176`).
`SillyTavern.libs` = default export of `public/lib.js:84-110`:
`lodash, Fuse, DOMPurify, hljs, localforage, Handlebars, css (@adobe/css-tools), Bowser, DiffMatchPatch, Readability,
isProbablyReaderable, SVGInject, showdown, moment, seedrandom, Popper, droll, morphdom, slideToggle, chalk, yaml,
chevrotain, gzipSync, gzip, sha256 (js-sha256)`.
Legacy window shims (`lib.js:33-83`): `Fuse, DOMPurify, hljs, localforage, Handlebars, diff_match_patch, SVGInject,
showdown, moment, Popper, droll` — **not** lodash. Classic globals from `<script>` tags (`public/index.html:8200-8213`):
`$`/`jQuery` (3.5.1) + jQuery UI, `toastr`, select2, cropper, etc. `lib.js:32` comment says new extensions are "encouraged to
import the libraries directly from lib.js"; docs say use `SillyTavern.libs` (WE.md:170-205) — `SillyTavern.libs` is the
path-independent choice.

TypeScript: `global.d.ts` in the extension root with `import '../../../../public/global';` (user-scoped) /
`import '../../../../global';` (global-scoped) — both paths resolve correctly to `public/global.d.ts` given §1 layout (WE.md:209-225).

---

## 7. Module boundaries (stable vs internal)

- Docs: "Using imports from SillyTavern code is unreliable and can break at any time … getContext provides a more stable
  API" (WE.md:272-274); "Prefer getContext() over direct imports" (WE.md:1414-1424); "If you're missing any functions in
  getContext, get in touch / send a PR" (WE.md:166-168).
- There is no formal stability marker in source; `st-context.js` is the de-facto public API and keeps deprecated
  members as aliases (e.g. `event_types`, `registerSlashCommand`, `callPopup`) rather than removing them.
  `script.js` has ~218 `export` statements — all internal implementation detail.
- Built-ins import directly (`'../../../script.js'`, `'../../extensions.js'`) because they ship in lockstep; third-party
  should not copy that.
- `SillyTavern.libs` + `getContext()` cover most needs; residual direct imports (e.g. `isAdmin`, `secret_state`) should be
  isolated in one adapter module so breakage is local, or done via dynamic `import()` in try/catch (WE.md:50-73 shows a
  webpack-safe `importFromUrl` helper with fallback).

---

## 8. Canonical built-in examples

1. **`public/scripts/extensions/token-counter/`** (118 lines) — smallest complete ext: manifest with `hooks.activate`,
   `export function init()`, wand-menu button into `#token_counter_wand_container`, `renderExtensionTemplateAsync`
   + `callGenericPopup` for a window template (`window.html`), debounced input, `SlashCommandParser.addCommandObject`,
   `t\`\`` i18n. (`index.js:12-43,104-117`).
2. **`public/scripts/extensions/translate/`** (804 lines) — settings pattern: `defaultSettings` + key-backfill
   `loadSettings()` (`index.js:33-39,162-174`), settings template into a container, change handlers writing
   `extension_settings.translate.*` + `saveSettingsDebounced()` (`:724-753`), event subscriptions incl.
   `eventSource.makeFirst` (`:768-774`), slash command with enum provider, exposing a global (`globalThis.translate`, `:708`).
3. **`public/scripts/extensions/memory/`** (Summarize) — settings template rendered with data
   (`renderExtensionTemplateAsync('memory','settings',{defaultSettings})` `:1068`), `CHAT_CHANGED` handling,
   `makeLast` on render events, macro registration with feature-detection between new `macros.register` and legacy
   `MacrosParser` (`:1110-1130`). Chat-metadata persistence example: `quick-reply/src/QuickReplySettings.js:71-77`;
   character-card field example: `regex/engine.js:148`, `stable-diffusion/index.js:5247-5259`.
Caveat: built-ins import internals with built-in-relative paths and use `extension_settings.<key>` pre-seeded in core
(`extensions.js:141-226`); third-party must use `getContext()` and create their own key.

---

## 9. Best practices & pitfalls (docs + source)

Naming / isolation
- Unique settings key / module name (WE.md:1426-1436); prefix DOM ids/classes and CSS selectors (all extensions share one
  document; your CSS is global — `<link>` in `<head>`, `extensions.js:791-802`). Log with `[MyExt]` prefix (WE.md:1446-1456).
- Avoid globals except where required (`generate_interceptor` fn on `globalThis`). Modules already give you scope.
- Don't hard-code the folder name — it comes from the git URL (§1); a user may also have it global or local.

Lifecycle / cleanup
- Keep top-level module code side-effect-light: hooks `import()` the module even when disabled (§3.3).
- Remove listeners you no longer need: `eventSource.removeListener(type, fn)` (WE.md:1379-1388).
- Provide a `clean` hook to delete your `extensionSettings[MODULE]`, `localforage`/`accountStorage` keys; core never does it.
- Make `APP_READY` handlers non-blocking (they're awaited during boot) (WE.md:148).
- Use `CHAT_CHANGED` + fresh `getContext()` instead of caching `chatMetadata`, `characterId`, etc.

Multi-user
- Settings, chats and per-user extensions are per user (`data/<handle>/…`); global extensions are shared code but still get
  per-user settings. Non-admins cannot manage global extensions (`src/endpoints/extensions.js:96-99,181-184,454-457`; `/move` admin-only `:341-344`).
- `localStorage`/`localforage` are per browser origin, shared between ST accounts on the same browser → prefix keys with
  something user-specific or prefer `accountStorage` for small per-account values.

Performance
- `extension_settings` is part of the full settings POST on every save — keep it small (WE.md:1363-1377). Use
  `saveSettingsDebounced`, not repeated immediate saves. `saveMetadata` writes the whole chat file → debounce it.
- Templates are cached after first fetch; render once and reuse DOM where possible.

Security
- Sanitize any untrusted HTML with `SillyTavern.libs.DOMPurify.sanitize` before inserting (WE.md:1342-1355); templates
  are sanitized by default (§4). Prefer `.text()`/`textContent` for plain strings. No `eval`/`Function` (WE.md:1357-1359).
- No secrets in `extensionSettings` (§5.5).
- Calling ST server endpoints: every non-GET request needs the CSRF header — use
  `fetch(url, { method:'POST', headers: getContext().getRequestHeaders(), body: JSON.stringify(...) })`.
  Token is per-session (`csrf-sync`, `src/server-main.js:168-202`); `$.ajax` gets it automatically via
  `$.ajaxPrefilter` (`public/script.js:667-669`). For `FormData` uploads use `getRequestHeaders({ omitContentType: true })`.
- CSP: helmet with `contentSecurityPolicy: false` (`src/server-main.js:104-106`) → no CSP; external scripts/fetches are
  allowed by ST, but cross-origin `fetch` is still subject to the *remote* server's CORS. ST's `/proxy/<url>` CORS proxy
  exists only if `enableCorsProxy: true` (`default/config.yaml:76`, `src/server-main.js:257-258`) — off by default, don't
  depend on it in community extensions.
- Third-party installs from non-SillyTavern GitHub orgs show a security warning (`extensions.js:1713-1740`).

Mobile
- `getContext().isMobile()` exists (`st-context.js:213`); the settings columns are `wide50p` side-by-side on desktop.
  No extension-specific mobile guidance in docs (UNVERIFIED beyond that).

---

## 10. Docs vs source mismatches

1. **`display_name`, `author`, `js` "required"** (WE.md:111-115): loader enforces none. Missing `js` = nothing loads but
   the extension is marked active; `author` is never displayed (git remote owner shown instead); `homePage` (in the docs'
   example) is read nowhere.
2. **Template sanitization "forced"/"automatically"** (WE.md:231; JSDoc `extensions.js:131-132`): `sanitize`/`localize` are
   optional params defaulting to `true` and can be passed `false`.
3. **`activate` hook "synchronous setup"** (WE.md:146): it is awaited (async allowed), with a 5 s cap, and is what all
   built-ins now use as their entry point (`init`). Docs never show the `hooks.activate` entry-point pattern explicitly,
   nor the `jQuery(async…)` pattern still used by the linked example repo.
4. **Hook table vs example**: top manifest example (WE.md:98-105) omits `clean`; the table includes it (WE.md:686). Source supports 7 hooks.
5. **Dependencies "folder name as it appears in `public/extensions`"** (WE.md:127): real path is `public/scripts/extensions`,
   and third-party names are `third-party/<Folder>` regardless of local vs global install.
6. **"Every extension must have a folder in `data/<user-handle>/extensions`"** (WE.md:77): also built-in and global
   (`public/scripts/extensions/third-party`) locations; same-name user folder overrides global.
7. **`requires`/`optional` "deprecated"** (WE.md:134-139): still enforced/displayed by the loader.
8. **Shared libraries list** (WE.md:174-195): omits `sha256`; `css` is `@adobe/css-tools`, not the linked repo. `lib.js:32`
   recommends importing from `lib.js`, docs recommend `SillyTavern.libs`.
9. **Chat metadata** (WE.md:340-357): docs show only `saveMetadata()`; `saveMetadataDebounced()` (with char/group-switch
   guard) is also in getContext and used by built-ins.
10. **`minimum_client_version`** comment says `null` passes; code only skips `undefined` (`extensions.js:586-590`).
11. **Settings init snippet** (WE.md:319-323) back-fills defaults by reference (shared arrays/objects); lodash-merge variant
    (WE.md:1469-1475) merges arrays by index.
12. **`install` hook "after … settings are loaded"** (WE.md:681): more precisely after live activation (script already ran,
    `activate` already called) — install does not require a reload.
13. Docs omit: `getContext()` returns snapshots (re-call it); `saveSettings` (immediate) is not in getContext; characters
    may be shallow (`unshallowCharacter`); `writeExtensionField` silently logs on failure.
