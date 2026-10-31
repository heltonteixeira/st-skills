# Manifest, locations and lifecycle

Checked against SillyTavern 1.19.0. Loader: `public/scripts/extensions.js`; install/update/delete:
`src/endpoints/extensions.js`; URL mapping: `src/users.js`.

## Contents
1. Where extensions live and their URLs
2. manifest.json fields
3. Load sequence
4. Hooks
5. Generate interceptor
6. Install, update, delete, auto-update
7. Import depth (if you must import)

## 1. Where extensions live

| Kind | Disk | Internal name | URL |
|---|---|---|---|
| Built-in | `public/scripts/extensions/<name>/` | `<name>` | `/scripts/extensions/<name>/...` |
| Third-party, per user ("local") | `data/<user>/extensions/<Folder>/` | `third-party/<Folder>` | `/scripts/extensions/third-party/<Folder>/...` |
| Third-party, all users ("global") | `public/scripts/extensions/third-party/<Folder>/` | `third-party/<Folder>` | same URL |

- Per-user and global share one URL space; a user folder shadows a global one with the same name.
- `<Folder>` = sanitized basename of the git URL used to install it. Do not hard-code it; derive it:
  `decodeURIComponent(new URL('.', import.meta.url).pathname).replace(/^\/scripts\/extensions\//, '').replace(/\/$/, '')`
  gives `third-party/<Folder>`, the first argument of `renderExtensionTemplateAsync`.
- Only direct subfolders with a `manifest.json` are discovered.
- The server can disable all extensions (`extensions.enabled: false` in `config.yaml`).

## 2. manifest.json

| Field | Type | Effect |
|---|---|---|
| `display_name` | string | Name in Manage Extensions; secondary sort key. Not enforced, but always set it. |
| `loading_order` | number | Lower loads first and its interceptor runs first. Built-ins use 1-100; third-party commonly 100+. Missing -> sorted by name, inconsistently. |
| `js` | string | Entry module, injected as `<script type="module">`. Missing -> nothing runs (CSS-only extension). |
| `css` | string | One stylesheet, appended to `<head>` after core CSS. |
| `version` | string | Shown next to the name. |
| `author` | string | Returned on install, **not displayed** (the UI shows the git remote's owner). |
| `homePage` | string | Read nowhere by ST; harmless documentation. The UI links to the git remote. |
| `auto_update` | boolean | Opt in to auto-update when ST updates (if the server allows) and to update notifications. |
| `minimum_client_version` | semver string | Older ST refuses to load the extension with an error. Omit the key rather than setting `null`. |
| `hooks` | `{ activate, install, update, delete, clean, enable, disable }` -> exported function names | Section 4. Since 1.17.0 (`clean` since 1.18.0). |
| `generate_interceptor` | string | Name of a function on `globalThis`. Section 5. |
| `dependencies` | string[] of internal names (`"vectors"`, `"third-party/Foo"`) | All must exist and be enabled or this extension does not load. No ordering guarantee - use `loading_order`. |
| `i18n` | `{ "<locale>": "path.json" }` | Translations for the current locale, loaded before your JS (`i18n.md`). |
| `requires`, `optional` | string[] | Extras API modules - deprecated (Extras is gone) but `requires` is still enforced. Leave empty/out. |

Load failures (missing dependency, version too old, script error at link time) are not thrown at
the user: they appear in red in Manage Extensions and the button gets a warning mark. Check the
browser console during development.

## 3. Load sequence (`public/script.js` `firstLoadInit`)

1. CSRF token, library shims, locales.
2. Settings loaded -> `extension_settings` filled (`Object.assign`, shallow) -> `EXTENSIONS_FIRST_LOAD`
   (before discovery, so your extension never hears it on first load).
3. Discovery, manifests, optional auto-update, then **`activateExtensions()`**: sorted by
   `loading_order`; for each one, sequentially: locale file -> JS + CSS -> `hooks.activate` (awaited,
   up to 5 s, then the loader moves on while your hook keeps running).
4. `EXTENSION_SETTINGS_LOADED`, `SETTINGS_LOADED`.
5. Characters, world info, personas...
6. `APP_INITIALIZED` (loader overlay still visible) -> `APP_READY`. Both are "sticky": a listener
   added afterwards runs immediately with the last arguments.

At `init`: `extensionSettings` holds saved values; `characters` is empty; no chat is open;
`characterId` is undefined. Docs guidance: `activate` for setup during loading, `APP_INITIALIZED` for
work after all extensions loaded, `APP_READY` for non-blocking work (its handlers are awaited, so
defer heavy work with a timer).

Installing an extension from the UI activates it **live, without reload**: script -> `activate` -> `install`.

## 4. Hooks

The loader `await import()`s your `js` and calls the named export with no arguments, raced against a
5 s timeout; errors are logged.

| Hook | When |
|---|---|
| `activate` | every page load after JS+CSS loaded (and right after a live install) - your entry point |
| `install` | after a fresh install and activation |
| `update` | after an update pulled changes, before the reload prompt - runs the **old, already loaded** module |
| `delete` | before the folder is deleted |
| `clean` | "Clean extension data" button (only shown when the hook exists) or delete-with-cleanup; then settings are saved and the page reloads |
| `enable` / `disable` | before the extension is toggled; a reload follows |

- Hooks import the module even for a **disabled** extension, so module top level must not touch the
  DOM or register listeners.
- ST never removes your `extension_settings` key on uninstall. Implement `clean`:
  ```js
  export function onClean() {
      const { extensionSettings, saveSettingsDebounced } = SillyTavern.getContext();
      delete extensionSettings[MODULE];
      saveSettingsDebounced();      // ST also saves and reloads after clean
  }
  ```
  `"hooks": { "activate": "init", "clean": "onClean" }` + `"minimum_client_version": "1.18.0"`.

## 5. Generate interceptor

```json
"generate_interceptor": "myExtension_intercept"
```
```js
globalThis.myExtension_intercept = async function (chat, contextSize, abort, type) {
    if (type === 'quiet') return;            // background generations usually should be left alone
    // chat: array of SHALLOW COPIES of the messages that will be sent (system/hidden ones removed)
};
```
- Called for every real generation (not dry runs), in `loading_order`, awaited.
- `abort(true)` cancels the generation and skips later interceptors; `abort(false)` cancels but lets
  the rest run.
- **Copies, not the real chat** (the docs say otherwise; the source wins): adding, removing,
  reordering items or assigning `chat[i].mes` changes **only this prompt**. Mutating nested objects
  (`chat[i].extra.x = ...`) changes the real message - clone `extra` first if you don't want that.
- To hide a message from this prompt without changing the count: `chat[i].extra = { ...chat[i].extra, [SillyTavern.getContext().symbols.ignore]: true }`.
- The function must be on `globalThis`; that is the one global ST expects from you.

## 6. Install, update, delete

- Users install from a git URL (Manage Extensions -> Install extension), per user or for all users
  (admin). ST runs `git clone --depth 1` and rejects the clone if `manifest.json` is not a JSON object.
  URLs outside `github.com/SillyTavern/*` show a security warning.
- Update = `git fetch` + `pull` of the current branch; then "Reload the page to apply updates".
  Non-git folders always report up to date.
- Auto-update runs when ST's version changes, only for `auto_update: true` and only if the server
  setting `extensions.autoUpdate` allows it.
- Non-admin users cannot update, delete or switch branches of global extensions.
- The official content index does not accept extensions that **require** a server plugin.

## 7. Import depth (only if `getContext()` truly lacks something)

Entry file URL: `/scripts/extensions/third-party/<Folder>/index.js`, so:
- `/script.js` -> `'../../../../script.js'`
- `/scripts/extensions.js` -> `'../../../extensions.js'`
- `/scripts/<x>.js` -> `'../../../<x>.js'`; `/lib.js` -> `'../../../../lib.js'`
- each subfolder inside your extension adds one `../`.

Built-ins are one level shallower (`'../../../script.js'`) - copying their imports breaks. A static
import of a name ST later renames makes your module fail to link (extension does not load at all).
Isolate unavoidable imports in one file, or use a dynamic `await import(url)` inside try/catch so a
breakage disables one feature instead of the whole extension. The docs ask authors to request
missing functions in `getContext()` upstream.

TypeScript types: add `global.d.ts` in the extension root with `import '../../../../public/global';`
(per-user install) to get `SillyTavern` typings.
