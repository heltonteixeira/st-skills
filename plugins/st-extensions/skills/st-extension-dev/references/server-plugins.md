# Server plugins (Node side)

Checked against SillyTavern 1.19.0. Loader: `src/plugin-loader.js`; middleware: `src/server-main.js`;
users: `src/users.js`. Docs: SillyTavern-Docs `For_Contributors/Server-Plugins.md`.

## Contents
1. When to use one
2. Enabling and installing (what to tell users)
3. File layout and module type
4. Exports and routes
5. What a request has already passed
6. Per-user data
7. Calling the plugin from the UI extension, and detecting it
8. Security checklist
9. Importing ST internals

## 1. When to use one

Only for what the browser cannot do: filesystem access beyond core endpoints, HTTP to services
without CORS, secrets that must never reach the browser, native packages, child processes,
background jobs. Costs: the user must edit `config.yaml` and restart; most users have plugins off;
one instance is shared by all users; the official extension index rejects extensions that
**require** a plugin. Usual design: UI extension + **optional** companion plugin that the UI detects,
disabling only the features that need it.

## 2. Enabling and installing

- `config.yaml`: `enableServerPlugins: true` (default **false**), then restart ST.
  Env override: `SILLYTAVERN_ENABLESERVERPLUGINS=true`.
- `enableServerPluginsAutoUpdate: true` (default) runs `git pull` on every plugin repo at each
  startup (system git required; **no `npm install`** - ship bundled code or no dependencies).
  Developers should turn it off in a dev clone.
- No UI installer. `node plugins.js install <git-url>` from the ST folder, or
  `git clone <url> plugins/<name>`, or copy the folder/file into `plugins/`. Docker: the `plugins` volume.
- Plugins load only at startup; there is no reload.

## 3. Layout and module type

- `plugins/<name>/` directory: `package.json` `main` if present, else `index.js`, `index.cjs`,
  `index.mjs`. Or a single `plugins/<file>.js|.cjs|.mjs`.
- `plugins/package.json` declares `"type": "commonjs"`, so a plain `.js` plugin without its own
  `package.json` is **CommonJS** (`module.exports`). For ESM use `.mjs` or give the plugin its own
  `package.json` with `"type": "module"`.
- Template for TypeScript + bundling: `SillyTavern/Plugin-WebpackTemplate` (bundle to one file, target Node).

## 4. Exports and routes

```js
// plugins/notes-store/index.js  (CommonJS)
const path = require('node:path');
const fs = require('node:fs');

const info = { id: 'notes-store', name: 'Notes Store', description: 'Saves per-user notes as JSON files' };

async function init(router) {
    router.post('/probe', (_req, res) => res.json({ version: '1.0.0' }));
    router.post('/save', async (req, res) => {
        try {
            const { name, text } = req.body ?? {};
            if (typeof name !== 'string' || !/^[\w-]{1,64}$/.test(name) || typeof text !== 'string' || text.length > 100_000) {
                return res.status(400).send('Bad request');
            }
            const dir = path.join(req.user.directories.root, 'notes-store');
            const file = path.resolve(dir, `${name}.json`);
            if (!file.startsWith(path.resolve(dir) + path.sep)) return res.status(400).send('Bad name');
            await fs.promises.mkdir(dir, { recursive: true });
            await fs.promises.writeFile(file, JSON.stringify({ savedAt: new Date().toISOString(), text }), 'utf8');
            res.sendStatus(204);
        } catch (error) {
            console.error('[notes-store]', error);
            res.status(500).send('Internal error');
        }
    });
}

async function exit() {}

module.exports = { info, init, exit };
```
- `info` needs string `id`, `name`, `description`. **`id` must match `/^[a-z0-9_-]+$/`** and be unique.
- `init(router)` gets an Express 4 `Router` (never `app`), may be async; a hanging `init` blocks startup.
- Routes mount at **`/api/plugins/<id>/...`**, and only if you registered at least one.
- `exit()` runs on SIGINT/SIGTERM: close handles, kill child processes.
- Exports may be named or under `default` (ESM default export works).
- The docs' hello-world `router.get('/foo', req, res, function () {...})` is invalid JS; use
  `router.get('/foo', (req, res) => res.send('bar'))`.

## 5. What a request has already passed

Global middleware applies to plugin routes: helmet, compression, JSON and urlencoded body parsers
(500 MB limit - `req.body` is ready, do not add `express.json()`), CORS (cross-origin effectively
blocked), basic auth / IP whitelist if configured, session, `req.user`, **CSRF on every non-GET**
(header `X-CSRF-Token`), login check (403 without a user), and a multer that only accepts a
multipart file field named **`avatar`** (`req.file`). Prefer base64 inside JSON for binary data.

Express 4 does not catch rejected promises: an unhandled error in an async handler can become an
uncaught exception, and ST exits on those. **Wrap every async handler in try/catch.**

## 6. Per-user data

- `req.user.profile`: `{ handle, name, admin, enabled, ... }` (contains the password hash and salt -
  never send it to the client). Accounts off -> always `default-user` (admin).
- `req.user.directories`: absolute paths under `data/<handle>/` - `root`, `chats`, `characters`,
  `groups`, `groupChats`, `worlds`, `user`, `userImages`, `files` (`user/files`, served to the user
  at `/user/files/<name>`), `extensions`, `assets`, `backgrounds`, `thumbnails*`, `vectors`,
  `backups`, `themes`, `quickreplies`, `comfyWorkflows`, presets folders, `sysprompt`, `reasoning`...
- Keep your files in your own subfolder (e.g. `path.join(req.user.directories.root, '<plugin-id>')`);
  key in-memory state by `req.user.profile.handle`; gate admin features with `req.user.profile.admin`.

## 7. From the UI extension

```js
const { getRequestHeaders } = SillyTavern.getContext();

async function isPluginAvailable() {
    try {
        const res = await fetch('/api/plugins/notes-store/probe', { method: 'POST', headers: getRequestHeaders() });
        return res.ok;
    } catch { return false; }
}

await fetch('/api/plugins/notes-store/save', {
    method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ name, text }),
});
```
- There is no endpoint listing plugins; probing a route is the core convention (Office, Fandom and
  Edge TTS integrations do it). 404 means "plugins disabled or plugin not installed"; return
  `{ version }` from the probe if you need compatibility checks. `await` the probe (a core
  integration has a bug from forgetting it).
- Errors not from your plugin: 403 (CSRF / not logged in), 404 HTML (not loaded), 401 (basic auth).
- The manifest has no field to declare a plugin dependency, and a UI extension cannot install its plugin.

## 8. Security checklist

- No sandbox: full filesystem, network and process access for every user's requests.
- Validate the type and size of every body field; reject anything unexpected with 400.
- File names from the client: `sanitize-filename`, reject `/ \` and NUL, and confirm the resolved path
  stays under your base directory (`path.resolve` + prefix check).
- Return generic error messages; log details server-side.
- Keep secrets server-side; never return them (ST masks keys from the browser on purpose).
- Outbound requests to user-supplied URLs: SSRF risk - validate hosts; core's
  `getUntrustedRequestAgent()` (`src/private-request-filter.js`) exists for this.
- Child processes: `spawn`/`execFile` with an argument array, never a shell string built from input.
- Keep state-changing routes non-GET so CSRF protection applies.

## 9. Importing ST internals

Plugins can `import()` ST modules (`../../src/util.js`, `../../src/users.js`...; ST is ESM, so from
CommonJS use dynamic `await import()`), but these are internals that change between releases. Prefer
self-contained code; if you must, guard the import with try/catch. `process.serverEvents` emits
`SERVER_STARTED` (`{ url }`) after plugins initialised.
