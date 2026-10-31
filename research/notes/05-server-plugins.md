# 05 — Server plugins (Node side) and UI-extension ↔ server communication

Source: `dev-st` = SillyTavern 1.19.0, commit 06bde93. All paths relative to `dev-st/`.
Docs checked: `research/st-docs/For_Contributors/Server-Plugins.md` (SP.md), `Writing-Extensions.md` (WE.md).
Express installed: 4.22.1 (`node_modules/express/package.json:4`; `package.json:51` `^4.21.0`). Node `>= 20` (`package.json:101`).

## 1. Enabling (opt-in, OFF by default)

- `default/config.yaml:393-396`:
  ```yaml
  # -- SERVER PLUGIN CONFIGURATION --
  enableServerPlugins: false
  enableServerPluginsAutoUpdate: true
  ```
- Read once at module load: `src/plugin-loader.js:10-11`
  `getConfigValue('enableServerPlugins', false, 'boolean')`, `getConfigValue('enableServerPluginsAutoUpdate', true, 'boolean')`.
- Env-var override works for any config key: `keyToEnv = 'SILLYTAVERN_' + key.toUpperCase().replace(/\./g,'_')`
  (`src/util.js:38`, checked first in `getConfigValue` `src/util.js:88-96`) → `SILLYTAVERN_ENABLESERVERPLUGINS=true`.
- No CLI flag for plugins (`src/command-line.js` has none; grep "plugin" → nothing).
- Changing config requires server restart (values cached in module constants). Plugins load only at startup.
- Consequence for extension authors: any feature depending on a plugin must degrade gracefully; most users have
  plugins disabled. WE.md:32 (content-repo submission rules): "Extensions that have a server plugin requirement
  to function will not be accepted."

## 2. Discovery and loading — `src/plugin-loader.js`

Called from `preSetupTasks()` in `src/server-main.js:312-313`:
`const pluginsDirectory = path.join(serverDirectory, 'plugins'); const cleanupPlugins = await loadPlugins(app, pluginsDirectory);`
→ folder is `<ST root>/plugins/` (ships with `.gitkeep` + `package.json`; `/plugins/` is git-ignored, `.gitignore:51`).

`loadPlugins(app, pluginsPath)` (`plugin-loader.js:40-90`):
1. Return no-op if disabled (`:46`), folder missing (`:51`), or empty (`:58`).
2. `await updatePlugins(pluginsPath)` — git auto-update BEFORE loading (`:62`, see §4).
3. For each entry of `fs.readdirSync(pluginsPath)` (`:55,64`):
   - directory (`fs.statSync` → follows symlinks) → `loadFromDirectory` (`:67-69`). Dot-directories are NOT skipped here (only in auto-update).
   - file: only `.js`/`.cjs` (`isCommonJS`, `:24`) or `.mjs` (`isESModule`, `:31`); others ignored (`:73`).
4. Logs `N server plugin(s) are currently loaded. Make sure you know exactly what they do...` (`:80-82`).
5. Returns cleanup fn `() => Promise.all(exitHooks.map(exitFn => exitFn()))` (`:85`).
6. Whole loop wrapped in try/catch → `'Plugin loading failed.'`; one throw here (e.g. statSync) aborts remaining plugins (`:86-89`).

`loadFromDirectory` (`:92-119`) precedence:
1. `package.json` with `main` → `path.join(dir, packageJson.main)` (`:101-106`, `loadFromPackage :129-140`).
   If `main` missing, JSON invalid, or that load fails → falls through.
2. `index.js`, then `index.cjs`, then `index.mjs` (`:109`), first one that initializes successfully wins.

`loadFromFile` (`:150-160`): ALWAYS `await import(url.pathToFileURL(path))` — the .js/.cjs vs .mjs split is only a
filename filter. Module type of a `.js` is decided by Node's nearest `package.json` `"type"`:
- `plugins/package.json` = `{"name":"sillytavern-plugins","type":"commonjs"}` → a loose `plugins/foo.js`, or a
  plugin dir WITHOUT its own package.json, is CommonJS (`module.exports`).
- A plugin dir with its own `package.json` `"type":"module"` can use ESM `.js`.
- Errors in import/init are caught and logged: `Failed to load plugin from <path>: <error>` → returns false (`:156-158`).

Docs mismatch: SP.md:23 lists only `.js` (CJS) and `.mjs` (ESM); SP.md:82-86 lists `index.js`, `index.mjs`. Source also
accepts `.cjs` and `index.cjs` (`:24,109`).

## 3. Required exports, validation, mounting — `initPlugin` (`plugin-loader.js:179-231`)

- Exports may be named OR on `default` (ESM default export / CJS interop):
  `plugin.info || plugin.default?.info` (`:180`), same for `init` (`:195`) and `exit` (`:225`).
- `info` must be an object (`:181`) with string `id`, `name`, `description` (`:188-193`) — all three required even
  though "We don't currently use 'name' or 'description'" (`:186`).
- `init` must be a function (`:196`).
- ID rule: `/^[a-z0-9_-]+$/` (`isValidPluginID`, `:167-169`) — lowercase only, no dots/spaces. Not in docs.
- Duplicate id → rejected: `plugin ID '<id>' is already in use` (`:208-211`). First loaded wins (readdir order).
- Router: `const router = express.Router(); await init(router);` (`:214-216`). Plugin never receives `app`.
  `init` may be sync or async (awaited). A never-resolving `init` blocks server startup (UNVERIFIED by test; follows from `await`).
- Mount: only if routes were registered — `if (router.stack.length > 0) app.use(\`/api/plugins/${id}\`, router)` (`:221-223`).
  → `router.post('/probe')` in plugin `foo` = `POST /api/plugins/foo/probe`.
- `exit` optional (`:225-228`); called on SIGINT/SIGTERM/uncaughtException via `exitProcess` (`src/server-main.js:317-336`),
  after `statsOnExit()`, before `process.exit()`. Docs say exit "must return a Promise" (SP.md:29); source just
  `Promise.all(...)`s the return value, so sync is fine.
- No unload/reload: no API to list, disable, or hot-reload; `loadedPlugins` Map is module-private (`:17`).

Docs mismatch / bug: SP.md:57 example `router.get('/foo', req, res, function () {...})` is invalid JS (req/res undefined).
Correct: `router.get('/foo', (req, res) => res.send('bar'));`. SP.md:69 uses `module.exports` — valid only as CJS (see §2).

Minimal CJS plugin (`plugins/my-plugin/index.js`, no own package.json):
```js
const info = { id: 'my-plugin', name: 'My Plugin', description: 'Does X' };
async function init(router) {
  router.post('/probe', (_req, res) => res.sendStatus(204));
  router.post('/do', async (req, res) => {
    try { /* validate req.body */ res.json({ ok: true }); }
    catch (e) { console.error('[my-plugin]', e); res.status(500).send('Internal error'); }
  });
}
async function exit() {}
module.exports = { info, init, exit };
```

## 4. Auto-update via git (`plugin-loader.js:237-293`)

- Runs on every startup when `enableServerPluginsAutoUpdate` (default true) and the plugins folder is non-empty.
- Only non-dot directories (`:242-244`) that are a git repo ROOT (`CheckRepoActions.IS_REPO_ROOT`, `:264`).
- Requires system `git` on PATH (`commandExistsSync('git')`, `:252`); uses `simple-git` directly — ignores the
  `git.backend: auto|system|builtin` config (`default/config.yaml:312-317`) that `/api/extensions/install` honors.
- Logic: `fetch` → compare `HEAD` vs `@{u}` (tracking branch, `:269-275`) → `pull()` if behind (`:282`).
  No upstream / dirty tree / conflict → caught, logged `Failed to update plugin <dir>: ...` (`:285-287`), plugin still loads.
- No `npm install` after pull → new dependencies break the plugin. Commit a bundled build (docs' bundling advice).
- Dev tip: in a dev clone set `enableServerPluginsAutoUpdate: false`, else your working repo gets pulled on every start.

## 5. Install / update tooling (no UI installer)

- No HTTP endpoint installs server plugins. `/api/extensions/*` only handles UI extensions (§9).
- CLI script `plugins.js` (`plugins.js:1-5`): `node plugins.js install <git-url>` → shallow clone (`depth: 1`) into
  `./plugins/<basename(url,'.git')>` via `createGitClient` (backend from env `SILLYTAVERN_GIT_BACKEND`, `:18,93`);
  `node plugins.js update` → same fetch/pull logic as auto-update, also follows symlinked dirs (`:42-45`).
- Manual: `git clone <repo> plugins/<name>` (or copy a file), set `enableServerPlugins: true`, restart.
- Docker: `./plugins` volume (`docker/docker-compose.yml:16`), created in image (`Dockerfile:28-29`).
- Docs: official plugins listed at `github.com/search?q=topic%3Aplugin+org%3ASillyTavern` (SP.md:17);
  directory example `SillyTavern/SillyTavern-DiscordRichPresence-Server` (SP.md:90);
  Webpack+TypeScript template `https://github.com/SillyTavern/Plugin-WebpackTemplate` (SP.md:96) — UNVERIFIED (not opened).
- Bundling guidance (SP.md:92-94): bundle all deps into one file, target "Node". Unbundled imports like `express`
  resolve up the directory tree to ST's own `node_modules` (standard Node resolution; UNVERIFIED by test) — works but
  couples you to ST's dependency versions.

## 6. What a request to a plugin route has already passed through

Global middleware is registered at top level of `src/server-main.js` before plugins load in `preSetupTasks`
(`:487`), so ALL of it applies to `/api/plugins/<id>/*`, in this order:

| line | middleware | effect on plugin routes |
|---|---|---|
| 104 | `helmet({contentSecurityPolicy:false})` | security headers |
| 107-108 | compression, responseTime | — |
| 110 | `bodyParser.json({ limit: '500mb' })` | `req.body` parsed for `Content-Type: application/json` |
| 111 | `bodyParser.urlencoded({ extended: true, limit: '500mb' })` | form bodies |
| 113-138 | `cors(...)`, `cors.origin` default `'null'` (`:116`) | cross-origin browser calls effectively blocked |
| 141-142 | basicAuth (if `listen && basicAuthMode`) | |
| 145-147 | IP whitelist (`whitelistMode`, default true `default/config.yaml:60`) | |
| 150 | hostWhitelist | |
| 156-162 | cookieSession | `req.session` |
| 164 | `setUserDataMiddleware` | sets `req.user` (§7) |
| 167-202 | csrf-sync (unless `disableCsrfProtection`) | non-GET needs `X-CSRF-Token` header (`:177`) |
| 248 | `requireLoginMiddleware` | `403` if no `req.user` (`src/users.js:1027-1033`) |
| 269 | `multer({dest: uploads, limits:{fieldSize:500MB}}).single('avatar')` | multipart: file field MUST be named `avatar` → `req.file` |
| 270 | multerMonkeyPatch | decodes `req.file.originalname` latin1→utf8 |
| 488 | 404 page registered after plugins (`apply404Middleware :455-459`) | unknown plugin routes → 404 HTML |

- CSRF ignored methods: `["GET","HEAD","OPTIONS"]` (`node_modules/csrf-sync/lib/index.js:5`) → GET plugin routes need
  no token; POST/PUT/PATCH/DELETE do. Bad token → 403 "Invalid CSRF token..." (`server-main.js:199`).
- Body parsers are global: do NOT add `express.json()` again unless you need a different limit/type
  (UNVERIFIED: re-parsing is a no-op since body already consumed). For raw/binary bodies use base64 inside JSON
  (what ST's own `/api/files/upload` does, `src/endpoints/files.js:28-47`) or a multipart field named `avatar`.
- Express 4 does not catch rejected promises from async handlers. ST registers
  `process.on('uncaughtException', ... exitProcess())` (`server-main.js:332-335`); an unhandled rejection becomes an
  uncaught exception under Node ≥15 default → can SHUT DOWN the whole server (inferred, UNVERIFIED by test).
  Always try/catch inside async handlers (every core endpoint does, e.g. `src/endpoints/extensions.js:92-156`).

## 7. `req.user` and per-user data directories

- Typing: `index.d.ts:55-61` → `req.user: { profile: User; directories: UserDirectoryList }`.
- `setUserDataMiddleware` (`src/users.js:955-1019`): accounts disabled (`enableUserAccounts` false, `:29`) →
  always `DEFAULT_USER` (`handle 'default-user'`, `admin: true`, `src/constants.js:54-62`). Accounts enabled →
  user from session; missing/disabled → no `req.user` → `requireLoginMiddleware` returns 403.
- `User` fields (`src/users.js:51-60`): `handle, name, created, password (hash), salt, enabled, admin`.
  Never send `profile` back to the client wholesale (contains password hash + salt).
- `getUserDirectories(handle)` (`src/users.js:683-697`): each value = `path.join(DATA_ROOT, handle, template[key])`, cached.
  Template `src/constants.js:16-48` (key → subpath under `data/<handle>/`):
  `root ''`, `thumbnails`, `thumbnailsBg 'thumbnails/bg'`, `thumbnailsAvatar`, `thumbnailsPersona`, `worlds`, `user`,
  `avatars 'User Avatars'`, `userImages 'user/images'`, `groups`, `groupChats 'group chats'`, `chats`, `characters`,
  `backgrounds`, `novelAI_Settings`, `koboldAI_Settings`, `openAI_Settings`, `textGen_Settings`, `themes`, `movingUI`,
  `extensions`, `instruct`, `context`, `quickreplies 'QuickReplies'`, `assets`, `comfyWorkflows 'user/workflows'`,
  `files 'user/files'`, `vectors`, `backups`, `sysprompt`, `reasoning`.
- Publicly served (to the logged-in user) via `userDataRouter` (`src/users.js:1212-1219`): `/backgrounds/*`,
  `/characters/*`, `/User%20Avatars/*`, `/assets/*`, `/user/images/*`, `/user/files/*`,
  `/scripts/extensions/third-party/*`. Files a plugin writes into `directories.files` are fetchable at `/user/files/<name>`.
- Plugin is ONE instance shared by all users: keep per-user state keyed by `req.user.profile.handle`, and store
  per-user files under `req.user.directories.*` (e.g. `path.join(req.user.directories.root, 'my-plugin')` — own
  subfolder convention is UNVERIFIED best practice, not an ST API). `globalThis.DATA_ROOT` (`index.d.ts:67`) is the data root.
- Admin gating: `req.user.profile.admin`, or import `requireAdminMiddleware` (`src/users.js:1129-1140`).
- Safe write pattern used in core: `write-file-atomic` sync (`src/endpoints/chats.js:9`, `files.js:44`).

## 8. Server modules a plugin can import (NOT a stable API)

Plugins live in `plugins/<dir>/`, so ST modules are at `../../src/...` (ESM-only: ST root is `"type":"module"`,
`package.json:112` → from a CJS plugin use `await import()`). These are internals; they change between releases
without notice — prefer self-contained code, guard imports with try/catch.
- `src/util.js`: `getConfigValue` (`:88`, read config.yaml/env), `color` (chalk, `:525`), `isValidUrl` (`:993`),
  `isPathUnderParent(parent, child)` (`:1407-1414`), `tryReadFileSync`/`tryWriteFileSync`/`tryDeleteFile` (`:1514-1544`),
  `ensureDirectory` (`:394`), `uuidv4` (`:531`), `delay` (`:173`), `getVersion` (`:136`).
  `setConfigValue` is deprecated no-op (`:111-117`) — config is read-only.
- `src/endpoints/secrets.js`: `readSecret(directories, key, id?)` (`:448`), `writeSecret` (`:428`), `deleteSecret`
  (`:437`), `readSecretState` (`:457`), `SECRET_KEYS` (`:9`) — per-user `secrets.json` (`:8`).
- `src/users.js`: `getUserDirectories`, `getAllUserHandles` (`:672`), `requireAdminMiddleware` (`:1129`).
- `src/middleware/validateFileName.js`: `getFileNameValidationFunction(field)` → 400 if body field contains `/`, `\`
  (Windows) or NUL (`:3,19-41`).
- `src/private-request-filter.js`: `getUntrustedRequestAgent()` (`:218-226`) — SSRF-safe agent for user-supplied URLs
  (used `src/endpoints/search.js:440`).
- `src/server-events.js`: `serverEvents` / `EVENT_NAMES.SERVER_STARTED` (`:8-21`); also exposed as
  `process.serverEvents` (`:9`, typed `index.d.ts:24-31`) — no import needed. Emitted in `postSetupTasks`
  (`server-main.js:449`) AFTER plugin init, so subscribing in `init` works. Payload `{ url: URL }` (`index.d.ts:10-15`).
- `sanitize-filename` and `simple-git` are ST dependencies (`package.json:83,87`) resolvable from plugins (see §5 caveat).

## 9. Calling a plugin from a UI extension

- `getRequestHeaders({ omitContentType = false } = {})` (`public/script.js:647-658`):
  `{ 'Content-Type': 'application/json', 'X-CSRF-Token': token }`. Token fetched from `GET /csrf-token`
  (`public/script.js:696-698`). Exposed on `SillyTavern.getContext().getRequestHeaders` (`public/scripts/st-context.js:129`).
  jQuery `$.ajax` gets the header automatically (`public/script.js:667-669`); `fetch` does not.
- Pattern:
  ```js
  const { getRequestHeaders } = SillyTavern.getContext();
  const res = await fetch('/api/plugins/my-plugin/do', {
      method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ name }) });
  if (!res.ok) throw new Error(`my-plugin: ${res.status} ${await res.text()}`);
  const data = await res.json();
  ```
  For `FormData` uploads use `getRequestHeaders({ omitContentType: true })` and field name `avatar` (§6).
- Status codes the client may see that do NOT come from the plugin: 403 (CSRF bad / not logged in / session
  invalidated `users.js:993-1000`), 404 HTML (plugin not loaded), 401 (basic auth).
- Detecting the plugin: there is NO list endpoint (grep `api/plugins` in `src/` → only the mount in plugin-loader).
  Core convention = probe route returning 2xx:
  `public/scripts/utils.js:2105-2111` (`/api/plugins/office/probe`), `public/scripts/scrapers.js:260-265`
  (`/api/plugins/fandom/probe-mediawiki`), `public/scripts/extensions/tts/edge.js:258-267` (`/api/plugins/edge-tts/probe`):
  ```js
  const result = await fetch('/api/plugins/office/probe', {
      method: 'POST', headers: getRequestHeaders({ omitContentType: true }) });
  return result.ok;   // wrapped in try/catch → false
  ```
  404 covers both "plugins disabled" and "plugin not installed/failed to load"; distinguish versions by returning
  `{ version }` from the probe. Remember to `await` it — core bug at `edge.js:251` (`!this.isPluginAvailable()` on a
  Promise is always false).
- Manifest has no field to declare a plugin dependency (`manifest.requires` = Extras modules, `manifest.dependencies`
  = other extensions, `public/scripts/extensions.js:578-580`).

## 10. UI-extension management endpoints — `src/endpoints/extensions.js` (mounted `/api/extensions`, `src/server-startup.js:157`)

All behind `extensionsEnabledFeatureGuard` → 404 when `extensions.enabled: false` (`:72-81`, `default/config.yaml:297-300`).
Locations: user = `req.user.directories.extensions` (`data/<handle>/extensions`); global =
`public/scripts/extensions/third-party` (`src/constants.js:6`). Names sanitized with `sanitize-filename`.

| endpoint | body | admin? | notes |
|---|---|---|---|
| `POST /install` (`:92-156`) | `{url, global?, branch?}` | only if `global` (`:96`) | http/https only (`:106`); `git clone --depth 1` via `createGitClient({backend: git.backend})` (`:110,134-138`); 409 if exists; requires valid `manifest.json` object else folder deleted (`:141-151`); returns `{version, author, display_name, extensionPath, folderName}` |
| `POST /update` (`:169-215`) | `{extensionName, global?}` | if global (`:181`) | fetch + pull current branch; returns `{shortCommitHash, extensionPath, isUpToDate, remoteUrl}` |
| `POST /branches` (`:217-264`) | `{extensionName, global?}` | if global | unshallows repo, lists local+remote branches |
| `POST /switch` (`:266-327`) | `{extensionName, branch, global?}` | if global | checkout / create from `origin/x` |
| `POST /move` (`:329-375`) | `{extensionName, source, destination}` (`'global'` or other) | ALWAYS admin (`:341`) | copy+delete between user/global |
| `POST /version` (`:387-432`) | `{extensionName, global?}` | no check | `{currentBranchName, currentCommitHash, isUpToDate, remoteUrl}`; non-git → empty strings + `isUpToDate:true` |
| `POST /delete` (`:442-474`) | `{extensionName, global?}` | if global (`:454`) | `rm -r` folder |
| `GET /discover` (`:480-534`) | — | — | `[{type:'system'|'local'|'global', name}]`; folders without `manifest.json` skipped with warning (`:497-503`); user copy shadows global of same name (`:527`) |

- Non-accounts mode: default user is admin → global ops allowed. Client checks `isAdmin()` (`public/scripts/user.js:38-41`,
  true when accounts disabled).
- Extension files served with user-first, global-fallback and path-traversal checks (`src/users.js:1094-1121`).
- These endpoints never touch `plugins/`: a UI extension cannot install its companion plugin.

## 11. Security checklist for plugin authors

- Not sandboxed: full fs/network/process access (SP.md:13-15; loader warning `plugin-loader.js:81`). Plugin code runs
  for every user of a multi-user server — enforce `req.user` scoping and `profile.admin` where needed.
- Path traversal: never `path.join(base, req.body.x)` raw. Use `sanitize(name)` (as `extensions.js:122,176`), reject
  `/ \ NUL` (`validateFileName.js:3`), and check `isPathUnderParent(base, path.resolve(full))` (`util.js:1407`;
  pattern `users.js:1069-1072`).
- Validate types of every body field (`typeof x !== 'string'` → 400, as `extensions.js:171-179`); body up to 500 MB.
- Don't leak internals: core returns generic `'Internal Server Error. Check the server logs...'` (`extensions.js:154`);
  log details server-side.
- Secrets: keep them server-side (WE.md:1329-1340 recommends plugins for secrets). Core masks keys unless
  `allowKeysExposure` (`default/config.yaml:275`, `secrets.js:108,183,568`); a plugin returning `readSecret(...)`
  to the client bypasses that policy — don't.
- Outbound HTTP to user-supplied URLs: SSRF risk. Private request filter is off by default
  (`privateAddressWhitelist.enabled: false`, `default/config.yaml:157-159`) and is applied by swapping
  `http(s).globalAgent` (`private-request-filter.js:254-255`) — this happens AFTER plugin init (`server-main.js:313` vs `:348`),
  and Node's global `fetch` (undici) does not use `globalAgent` (UNVERIFIED for ST's patched fetch, which only adds
  `file:` handling, `src/fetch-patch.js:15-18`). Use `getUntrustedRequestAgent()` with `node-fetch`/http.
- CSRF: keep state-changing routes non-GET so csrf-sync protects them; never rely on `disableCsrfProtection`.
- Auth: plugin routes are already behind whitelist/basicAuth/login (§6); don't add unauthenticated side doors
  (plugins only get a router under `/api/plugins/<id>`, which is after `requireLoginMiddleware`).
- Spawning processes: use `child_process.spawn/execFile` with an args array, never a shell string built from input;
  kill children in `exit()` (UNVERIFIED best practice; ST's exit hook runs on SIGINT/SIGTERM only, not on crash-kill).
- Async errors can crash the server (§6) — try/catch everything.

## 12. Plugin vs. pure client — decision guide

Use a server plugin only when the browser cannot do it:
- Filesystem access beyond what core endpoints expose (core already offers e.g. `/api/files/upload` → `user/files`).
- HTTP to services without CORS (alternatives: core CORS proxy `/proxy/<url>` but `enableCorsProxy: false` by default,
  `default/config.yaml:76`, `server-main.js:257-265`; or core endpoints that already proxy specific APIs).
- Secrets that must never reach the browser.
- Native Node packages / long-running jobs / child processes / background timers.
Costs: user must edit config.yaml (`enableServerPlugins: true`), install via git/CLI, restart; not accepted in the
official content repo if required (WE.md:32); single shared instance across users; ST internals unstable.
Pattern: ship UI extension + optional companion plugin; probe on load, hide/disable plugin-only features if probe fails.
