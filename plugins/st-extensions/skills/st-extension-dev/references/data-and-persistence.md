# Data and persistence

Checked against SillyTavern 1.19.0.

## Contents
1. Global settings (`extensionSettings`)
2. Per-chat metadata (`chatMetadata`)
3. Messages: object shape, `extra`, adding / editing / deleting, saving
4. Per-character data (card extensions)
5. Other stores (account storage, presets, localforage)
6. Secrets
7. Chat-switch safety

## 1. Global settings

- `extensionSettings` is one object saved inside the user's `settings.json`; the **whole** settings
  payload is posted on every save, so keep your part small (no big blobs, no caches).
- On load ST does a shallow `Object.assign`: your saved sub-object replaces the defaults wholesale,
  so merge defaults per key yourself (pattern in SKILL.md). Clone default arrays/objects with
  `structuredClone`; `lodash.merge` merges arrays index-by-index (`[a]` + `[x, y]` -> `[a, y]`).
- Save with `saveSettingsDebounced()` (1 s debounce). The immediate `saveSettings` is not on the
  context; you do not need it.
- `extensionSettings.disabledExtensions` is ST's own list - do not touch it.
- Shared per user: in multi-user setups every account has its own settings.

## 2. Per-chat metadata

```js
const ctx = SillyTavern.getContext();
ctx.chatMetadata[MODULE] ??= {};
ctx.chatMetadata[MODULE].entries = entries;
ctx.saveMetadataDebounced();      // skips the save if the character/group changed meanwhile
```
- Stored in the chat file header, travels with the chat.
- **Re-read `getContext().chatMetadata` every time**: the object is replaced on each chat load.
- Reserved core keys: `variables`, `world_info`, `tainted`, `integrity`, author's note keys.
- Reload your UI state on `CHAT_CHANGED`.
- `saveMetadata()` (immediate) saves the whole chat.

## 3. Messages

Shape (`public/global.d.ts` `ChatMessage`):
`{ name, mes, title, send_date, gen_started, gen_finished, is_user, is_system, force_avatar,
original_avatar, swipes: string[], swipe_id, swipe_info: [{ send_date, gen_started, gen_finished, extra }], extra }`

- `is_system: true` = hidden from the prompt (shown greyed). System messages with
  `extra.tool_invocations` are the exception.
- `extra` is free-form: put your data under `extra[MODULE]`. Core keys include `api`, `model`,
  `display_text`, `reasoning`, `tool_invocations`, `media`, `token_count`, `memory`...
- `extra.display_text` changes what is **shown** without changing `mes` (what the model sees);
  `translate` uses this.
- **`extra` is per swipe**: on swipe ST stores the current `extra` into `swipe_info[swipe_id].extra`
  and loads the target swipe's. Data in `extra` follows the active swipe. If it belongs to the
  message as a whole, accept that or keep it in `chatMetadata` keyed by message `send_date`.
- Group chats: `name` / `original_avatar` identify the speaker.

Add a message (built-in stable-diffusion pattern):
```js
const ctx = SillyTavern.getContext();
const message = { name: ctx.name2, is_user: false, is_system: false, send_date: ctx.humanizedDateTime(), mes: text, extra: {} };
ctx.chat.push(message);
const messageId = ctx.chat.length - 1;
await ctx.eventSource.emit(ctx.eventTypes.MESSAGE_RECEIVED, messageId, 'extension');
ctx.addOneMessage(message);
await ctx.eventSource.emit(ctx.eventTypes.CHARACTER_MESSAGE_RENDERED, messageId, 'extension');
await ctx.saveChat();
```
For a narrator/system-style note use `extra: { type: 'narrator' }` or `is_system: true` (hidden from
prompt). `sendSystemMessage(type, text, extra)` renders a built-in system message but neither saves
nor emits.

Edit a message:
```js
const message = ctx.chat[id];
message.mes = newText;                     // or message.extra.display_text for display only
ctx.updateMessageBlock(id, message);       // re-render
await ctx.eventSource.emit(ctx.eventTypes.MESSAGE_UPDATED, id);   // optional: let others react
await ctx.saveChat();
```
- `addOneMessage`, `updateMessageBlock`, `sendSystemMessage`, `deleteLastMessage` do **not** save.
- `deleteMessage(id)` returns silently when that message is not rendered (long chats render only
  the last N); it saves (debounced) and emits `MESSAGE_DELETED` (payload: new chat length).
- `saveChat` on the context is `saveChatConditional`: waits for in-flight saves, works for groups,
  logs (does not throw) on failure. It saves **whatever chat is current** - guard against switches.
- `reloadCurrentChat()` cancels pending debounced saves: save first.

## 4. Per-character data

```js
const ctx = SillyTavern.getContext();
if (ctx.characterId === undefined) return;          // group chat or no character
await ctx.writeExtensionField(ctx.characterId, MODULE, { style: 'noir' });
const value = ctx.characters[ctx.characterId].data?.extensions?.[MODULE];
```
- Written into the character card (`data.extensions[MODULE]`), so it travels with exported cards.
- `characterId` is the array index, not a stable id; pass `ctx.constants.unset` as value to delete.
- Logs on failure, does not throw.
- With lazy loading, characters other than the active one are shallow (`data.extensions` has only
  `fav` and `world`): `await ctx.unshallowCharacter(id)` before reading/writing them.
- Bulk: `writeExtensionFieldBulk(avatars | null, key, value, { filterPath })` -> `{ updated, skipped, failed }`.

## 5. Other stores

- `accountStorage.getItem/setItem/removeItem` - small strings per ST account, saved with settings.
  Use instead of `localStorage`, which is per browser and shared by every account on that browser.
- `SillyTavern.libs.localforage` (IndexedDB) - large client-side data; browser-local, not synced,
  shared by accounts on the same browser profile: prefix keys.
- Presets: `getPresetManager().writePresetExtensionField({ path, value })` for data that belongs to
  a generation preset.
- Files on the server: core `/api/files/upload` (base64 JSON) stores into the user's `user/files`.

## 6. Secrets

There is no secret store for UI extensions: custom keys can be written but the browser cannot read
them back, and `extensionSettings` is plain text visible to every extension. If an extension needs an
API key, the request must be made by a server plugin that keeps the key server-side.

## 7. Chat-switch safety

```js
function snapshot() {
    const c = SillyTavern.getContext();
    return { chatId: c.getCurrentChatId(), groupId: c.groupId, characterId: c.characterId };
}
function changed(s) {
    const c = SillyTavern.getContext();
    return c.getCurrentChatId() !== s.chatId || c.groupId !== s.groupId || (!c.groupId && c.characterId !== s.characterId);
}
```
Take a snapshot before any `await` that precedes a write, and bail out if `changed()`. ST refills the
same `chat` array on chat load, so indexes held across an await may point at another chat's messages.
