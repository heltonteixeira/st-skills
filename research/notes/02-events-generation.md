# 02 — Events, generation, prompts, chat data, macros, tools, LLM calls

Source: `dev-st` = SillyTavern 1.19.0 (`package.json:118`), commit 06bde93. All paths relative to `dev-st/`.
`S` = `public/script.js`. Docs = `research/st-docs/For_Contributors/Writing-Extensions.md` (WE) and `Function-Calling.md` (FC).
Everything below is read from the source. Items not confirmed in source are marked UNVERIFIED.

---------------------------------------------------------------------------------------------------
## 0. Access: always go through `SillyTavern.getContext()`

`getContext()` (`public/scripts/st-context.js:115-308`) returns a **new object on every call**. Many fields are
**snapshot values**, copied when you call it:
- `characterId: this_chid` (:124). Holds a **string** index such as `"3"` (`S:7122-7133` setCharacterId calls String()), or `undefined`.
- `groupId`, `chatId` (:125-128), `name1`, `name2`, `onlineStatus`, `maxContext`, `mainApi`, `menuType`.
- `chatMetadata: chat_metadata` (:136). The global is **reassigned** on chat load (`S:7657`, `S:7748`, `S:8979` updateChatMetadata), so a stored reference goes stale. WE:343 warns about this too.
- `extensionPrompts: extension_prompts` (:156). Also **reassigned** (`clearChat` `S:1590` sets `extension_prompts = {}`).
- `chat` (:117). The array keeps the same identity, because ST mutates it with `chat.splice(0, chat.length, ...data)` (`S:7658`, `group-chats.js:306`). A stored reference still points at the *current* chat after a switch, so a saved index may now point at a message in a different chat (see Pitfalls).
- Use `eventTypes`. `event_types` is still there but marked deprecated as "Legacy snake-case naming" (:226-227). WE examples still use `event_types` (docs mismatch, harmless).

Rule: call `SillyTavern.getContext()` again inside every handler or async continuation. Do not cache it at module load.

---------------------------------------------------------------------------------------------------
## 1. eventSource API (`public/lib/eventemitter.js`)

`eventSource = new EventEmitter([APP_READY, APP_INITIALIZED])` (`public/scripts/events.js:113`).

| Method | Line | Behaviour |
|---|---|---|
| `on(event, fn)` | :43 | Pushes `fn` to the end of the list. If `event` is `undefined`, it logs a trace and returns (useful for spotting typos in event names). |
| `once(event, fn)` | :190 | Wraps `fn` in `g`, which removes itself after the first call. **`removeListener(event, fn)` cannot remove it**, because the stored function is the wrapper. |
| `makeFirst(event, fn)` | :90 | Moves or inserts `fn` at index 0. |
| `makeLast(event, fn)` | :66 | Moves or inserts `fn` at the end. |
| `removeListener(event, fn)` | :114 | Removes by identity. There is **no `off` alias**. |
| `emit(event, ...args)` | :130 | `async`. Awaits **each listener in turn** (`await listeners[i].apply`, :146). A listener that throws is caught and logged, and the rest still run. Returns a Promise. |
| `emitAndWait(event, ...args)` | :160 | **Despite the name, it is synchronous and does not await listeners** (:176 calls without await). It returns `undefined`. Core uses it only for `ONLINE_STATUS_CHANGED` (`S:7156`). |

- **Auto-fire** (:56, :80, :104, :155): for `APP_READY` and `APP_INITIALIZED`, a listener added after the event already fired runs at once with the last arguments. This applies to `on`, `makeFirst` and `makeLast`. So `eventSource.on(eventTypes.APP_READY, init)` is always safe.
- Listeners run in the emitter's context (`this` = emitter). The listener list is copied before the loop (`slice()`), so a listener that removes itself mid-emit is safe.
- A slow `async` listener **blocks core flow**. Example: `saveReply` awaits `MESSAGE_RECEIVED` before it renders (`S:6691`). For heavy work, debounce or don't await it. Vectors does this: `const onChatEvent = debounce(async () => await moduleWorker.update(), debounce_timeout.relaxed);` (`extensions/vectors/index.js:893`).
- Tracing: run `localStorage.setItem('eventTracing','true')` to log every emit with its args (:132).
- Custom events: any string works (WE:610). Core itself emits non-enum strings: `'groupSelected'` (`group-chats.js:1884`) and `'resizeUI'` (`RossAscends-mods.js:500`).

**Cleanup.** Keep a named handler reference and call `removeListener` with it. Canonical pattern (`extensions/tts/azure.js:41-52`):
```js
this.handler = async function (key) { ... }.bind(this);
dispose() { [event_types.SECRET_WRITTEN, event_types.SECRET_DELETED, event_types.SECRET_ROTATED]
    .forEach(event => eventSource.removeListener(event, this.handler)); }
```
Built-ins mostly register once at init and never remove. Removal matters for listeners you add temporarily (per popup or per job). Core's own temporary pattern is in `S:4018` / `S:4108` (generateRawData adds and then removes a `GENERATION_STOPPED` hook in `finally`).

Choosing order: core extensions use `makeFirst` when they must change text before others see it (translate: `extensions/translate/index.js:768-769`; quick-reply: `quick-reply/index.js:282,292`), and `makeLast` when they need the final state (memory `memory/index.js:1080`; tts `tts/index.js:1580-1581`).

---------------------------------------------------------------------------------------------------
## 2. Every `event_types` entry (`public/scripts/events.js:3-111`)

Legend: **A** = awaited `await eventSource.emit` · **N** = emitted without await (fire-and-forget; listeners still run, but core does not wait) · **W** = `emitAndWait` (sync). Payload = the listener's arguments.
All 108 keys are emitted somewhere, except the deprecated alias `SMOOTH_STREAM_TOKEN_RECEIVED`, which shares the string `'stream_token_received'` with `STREAM_TOKEN_RECEIVED` (events.js:72-74).

### App / settings
| Event (value) | Emit site(s) | Payload | Mode |
|---|---|---|---|
| APP_INITIALIZED `app_initialized` | S:787 | – | A, auto-fire |
| APP_READY `app_ready` | S:790 | – | A, auto-fire |
| EXTRAS_CONNECTED | extensions.js:754 | `modules` (string[]) | A |
| EXTENSIONS_FIRST_LOAD | extensions.js:1794 | – | A |
| EXTENSION_SETTINGS_LOADED | S:8025 (–); extensions.js:1767 (install response manifest) | none or `response` | A |
| SETTINGS_LOADED_BEFORE / _AFTER | S:7940 / S:7982 | `settings` | A |
| SETTINGS_LOADED | S:8047 | – | A |
| SETTINGS_UPDATED | S:8110 (after a settings save) | – | A |
| MOVABLE_PANELS_RESET | power-user.js:2711 | – | A |
| ONLINE_STATUS_CHANGED | S:7156 | `online_status` string | **W** |
| MAIN_API_CHANGED | S:11750 | `{ apiId }` | A |
| CHATCOMPLETION_SOURCE_CHANGED | openai.js:6976 | source string | N |
| CHATCOMPLETION_MODEL_CHANGED | openai.js:6017 | model string | N |
| OAI_PRESET_CHANGED_BEFORE | openai.js:5034 | `{preset, presetName, settingsToUpdate, settings, savePreset, presetNameBefore}` (mutable preset) | promise stored, not awaited inline |
| OAI_PRESET_CHANGED_AFTER | openai.js:5078 | – | A |
| OAI_PRESET_EXPORT_READY | openai.js:4887 | `preset` (mutable) | A |
| OAI_PRESET_IMPORT_READY | openai.js:4813 | `{ data, presetName }` | A |
| PRESET_CHANGED | openai.js:5079, kai-settings.js:533, nai-settings.js:894, textgen-settings.js:957 | `{ apiId, name }` | A |
| PRESET_DELETED | openai.js:4975, preset-manager.js:1153 | `{ apiId, name }` | A |
| PRESET_RENAMED_BEFORE / PRESET_RENAMED | preset-manager.js:1069 / :1073 | `{ apiId, oldName, newName }` | A |
| CONNECTION_PROFILE_LOADED | connection-manager/index.js:727,740,752,765,781,797,806 | profile name, or `NONE` | A |
| CONNECTION_PROFILE_CREATED | connection-manager/index.js:780,996 | `profile` | A |
| CONNECTION_PROFILE_UPDATED | connection-manager/index.js:796,879,1015 | `(oldProfile, profile)` | A |
| CONNECTION_PROFILE_DELETED | connection-manager/index.js:347 | `profile` | A |
| SECRET_WRITTEN / DELETED / ROTATED / EDITED | secrets.js:375 / 400 / 471 / 494 | secret `key` | A |
| FORCE_SET_BACKGROUND | stable-diffusion/index.js:3020 | `{ url, path }` | A |

### Chat lifecycle
| Event | Emit site(s) | Payload | Mode |
|---|---|---|---|
| CHAT_CHANGED `chat_id_changed` | S:1723, S:7700 (getChatResult), S:10760 (closeCurrentChat), S:10913, group-chats.js:318 | `getCurrentChatId()` → string, or `undefined` when no chat | A |
| CHAT_LOADED `chatLoaded` | S:7669 (**solo character chats only**, after CHAT_CHANGED) | `{ detail: { id: this_chid, character } }` | N |
| CHAT_CREATED | S:7701 | – | A |
| GROUP_CHAT_CREATED | group-chats.js:319 | – | A |
| CHAT_DELETED | S:1354, S:1401, S:10884 | chat file name | A |
| GROUP_CHAT_DELETED | group-chats.js:1334, 2269, 2308 | chat id/name | A |
| CHAT_RENAMED | S:10717 | `{ avatarId, groupId, oldFileName, newFileName }` | A |
| MORE_MESSAGES_LOADED | S:1474 | – | A |
| ITEMIZED_PROMPTS_LOADED / SAVED | itemized-prompts.js:35 / 53 | `{ chatId }` | A |
| ITEMIZED_PROMPTS_DELETED | itemized-prompts.js:90 / 103 | `{ chatId, all:false }` / `{ all:true }` | A |

Notes:
- `reloadCurrentChat()` also goes through getChat → getChatResult, so **CHAT_CHANGED fires again with the same id**.
- When a loaded chat has exactly one message, getChatResult emits `MESSAGE_RECEIVED(0,'first_message')` and `CHARACTER_MESSAGE_RENDERED` **every time the chat is opened**, not only when it is created (`S:7703-7707`; groups: `group-chats.js:300-302`).

### Messages
| Event | Emit site(s) | Payload | Mode |
|---|---|---|---|
| MESSAGE_SENT | S:5910/5917 (sendMessageAsUser), slash-commands.js:6058-6149, caption/index.js:219 | message index | A (the message is in `chat` and already saved, not yet rendered) |
| USER_MESSAGE_RENDERED | S:5912/5919, same as above | message index | A |
| MESSAGE_RECEIVED | S:6691,6716,6738,6781 (saveReply, skipped when `fromStreaming`); S:3799 (end of a stream); S:3828 (stream error, **N**); S:7705, S:9916, group-chats.js:300 (`'first_message'`); slash-commands.js:6006/6011 (`'command'`); stable-diffusion/index.js:4997 (`'extension'`) | `(messageId, type)` | A (N on stream error) |
| CHARACTER_MESSAGE_RENDERED | paired with every MESSAGE_RECEIVED above (S:3800, 3829, 6693…) | `(messageId, type)` | A |
| IMPERSONATE_READY | S:3802 (stream), S:5525 | text | A |
| MESSAGE_EDITED | S:8405 (messageEditDone, before re-render), slash-commands.js:5850/5916 | messageId | A |
| MESSAGE_UPDATED | S:8337, S:8431 (after re-render), slash-commands.js:5857/5923 | messageId | A |
| MESSAGE_DELETED | S:1611 (deleteLastMessage), S:1699 (deleteMessage), S:4411 (regenerate drops the last msg), S:11734 | **new `chat.length`**, not the deleted id | A |
| MESSAGE_SWIPED | S:10315 | messageId | A. Fires **before** `Generate('swipe')` starts for a new swipe (S:10317-10319), so the message text may still be the placeholder. |
| MESSAGE_SWIPE_DELETED | S:9388 | `{ messageId, swipeId, newSwipeId }` | A |
| MESSAGE_FILE_EMBEDDED | chats.js:496 | messageId | A |
| MESSAGE_REASONING_EDITED / DELETED | reasoning.js:1325 / 1393 | messageId | A |
| STREAM_TOKEN_RECEIVED | S:3895 | **the whole text received so far** (not a delta) | A, awaited **once per chunk**, so keep it cheap |
| STREAM_REASONING_DONE | reasoning.js:549 | `(reasoning, durationMs, messageId, state)` | A |
| IMAGE_SWIPED | chats.js:2086 | `{ message, element, direction }` | A |
| MEDIA_ATTACHMENT_DELETED / FILE_ATTACHMENT_DELETED | chats.js:1113 / 1144 | url | A |

The `type` argument of MESSAGE_RECEIVED is one of: `'normal'`, `'swipe'`, `'regenerate'`, `'continue'`, `'append'`, `'appendFinal'`, `'first_message'`, `'command'`, `'extension'` (seen at the sites above). Quiet generations never create a message.

### Generation
| Event | Emit site | Payload | Mode |
|---|---|---|---|
| GENERATION_STARTED | S:4299 (first thing in `Generate`) | `(type, {automatic_trigger, force_name2, quiet_prompt, quietToLoud, skipWIAN, force_chid, signal, quietImage}, dryRun)` | A. **Also fires on dry runs** (prompt-manager token counting: openai.js:709), and fires even when a slash command ends the generation. |
| GENERATION_AFTER_COMMANDS | S:4321 | same args as above | A. Only fires if slash-command processing did not stop the generation. |
| GENERATE_BEFORE_COMBINE_PROMPTS | S:5234 | `data` = `{api, combinedPrompt, description, personality, persona, scenario, char, user, worldInfoBefore, worldInfoAfter, beforeScenarioAnchor, afterScenarioAnchor, storyString, mesExmString, mesSendString, finalMesSend, generatedPromptCache, main, jailbreak, naiPreamble}` (S:5210-5231). Set `data.combinedPrompt` to replace the flattened text prompt (S:5237). | A. Runs for every API, but only text-completion uses the result. |
| GENERATE_AFTER_COMBINE_PROMPTS | S:5243; also generateRawData S:4031 | `{ prompt: string, dryRun }`. Reassigning `.prompt` is honoured. | A |
| CHAT_COMPLETION_PROMPT_READY | openai.js:1619 (prepareOpenAIMessages); generateRawData S:4037 | `{ chat: [{role,content,...}], dryRun }` | A. **In openai.js:1616-1623 only in-place mutation of `eventData.chat` takes effect; reassigning it is ignored.** In generateRaw, reassignment does work (S:4038). Always mutate in place. |
| GENERATE_AFTER_DATA | S:5318 | `(generate_data, dryRun)`. For CC: `{prompt: messages[]}`; otherwise the backend payload. | A, fires on dry runs too |
| TEXT_COMPLETION_SETTINGS_READY | textgen-settings.js:1847 (inside getTextGenGenerationData) | final textgen request `params` (mutable) | A. Also fires during dry runs and generateRaw, **with no dryRun flag**. |
| CHAT_COMPLETION_SETTINGS_READY | openai.js:3146 (sendOpenAIRequest) | `generate_data` request body (mutable) | A. Real sends only (main, quiet, generateRaw). |
| GENERATION_STOPPED | S:5618 (stopGeneration) | – | N |
| GENERATION_ENDED | S:3536 (hideStopButton, only when the stop button was visible) | `chat.length` | N. Fires on completion, error and stop, for quiet generations too. |
| IMPERSONATE_READY | see Messages | | |
| GROUP_WRAPPER_STARTED / FINISHED | group-chats.js:1049 / 1088 | `{ selected_group, type }` | A |
| GROUP_MEMBER_DRAFTED | group-chats.js:1059 | `chId` (character index) | A |
| SD_PROMPT_PROCESSING | stable-diffusion/index.js:3056 | `{ prompt, generationType, message, trigger }`. Set `.prompt` to change it. | A |
| TOOL_CALLS_PERFORMED / TOOL_CALLS_RENDERED | tool-calling.js:917 / 919 | `invocations[]` | A |
| TTS_JOB_STARTED | tts/index.js:509 | `{ messageId, characterName, text, voiceId }` | A |
| TTS_AUDIO_READY | tts/index.js:518 | `{ messageId, characterName, text, audio: Blob, mimeType }` | A |
| TTS_JOB_COMPLETE | tts/index.js:533 | `{ messageId, characterName }` | A |

### Characters / groups / personas
| Event | Emit site | Payload | Mode |
|---|---|---|---|
| CHARACTER_EDITOR_OPENED | S:8839 | chid | N |
| CHARACTER_EDITED | S:9902, slash-commands.js:5437 | `{ detail: { id, character } }` | A |
| CHARACTER_PAGE_LOADED | S:1067 | – | N |
| CHARACTER_DELETED `characterDeleted` | S:10888 | `{ id, character }` | A |
| CHARACTER_DUPLICATED | S:6077, BulkEditOverlay.js:59 | `{ oldAvatar, newAvatar }` | A |
| CHARACTER_RENAMED | S:7246 | `(oldAvatar, newAvatar)` | A |
| CHARACTER_RENAMED_IN_PAST_CHAT | S:7335, group-chats.js:731 | `(chatMessages, oldAvatar, newAvatar)` | A |
| CHARACTER_FIRST_MESSAGE_SELECTED | group-chats.js:589 **only** (group greetings) | `{ input, output, character }`. Set `output` to override. | A |
| CHARACTER_GROUP_OVERLAY_STATE_CHANGE_BEFORE / _AFTER | BulkEditOverlay.js:434 / 437 | state | N |
| CHARACTER_MANAGEMENT_DROPDOWN `charManagementDropdown` | S:12458 | selected option value | A |
| OPEN_CHARACTER_LIBRARY | S:12587 | – | A |
| GROUP_UPDATED | group-chats.js:1777, 2003 | – | A |
| PERSONA_CHANGED | personas.js:166 | `user_avatar` | A |
| PERSONA_CREATED | personas.js:535,599,1078,1934 | `{ avatarId, name, description, title }` | A |
| PERSONA_UPDATED | personas.js:839… | avatarId | A |
| PERSONA_RENAMED | personas.js:884, 2176 | `{ avatarId, oldName, newName }` | A |
| PERSONA_DELETED | personas.js:1195 | `{ avatarId, name }` | A |

### World info
| Event | Emit site | Payload | Mode |
|---|---|---|---|
| WORLDINFO_SETTINGS_UPDATED | world-info.js:5842, 6228 | – | N |
| WORLDINFO_UPDATED | world-info.js:4160 (`_save`) | `(name, data)` | A |
| WORLD_INFO_ACTIVATED | world-info.js:902 (only when not a dry run and something activated) | `activatedEntries[]` | A |
| WORLDINFO_ENTRIES_LOADED | world-info.js:4604 | `{ globalLore, characterLore, chatLore, personaLore }`. The arrays are mutable. | A |
| WORLDINFO_SCAN_DONE | world-info.js:5175 (after each scan loop) | `{state:{current,next,loopCount}, new:{all,successful}, activated:{entries,text}, sortedEntries, recursionDelay, budget, timedEffects}`. Listeners may change `state.next` and edit the arrays (world-info.js:5177-5180). | A |
| WORLDINFO_FORCE_ACTIVATE | emitted by vectors/index.js:1725; **consumed** by world-info.js:1020-1029 | entries[], each with `world` and `uid` | A. Emit this yourself to force-activate entries on the next scan. |

---------------------------------------------------------------------------------------------------
## 3. Generation pipeline (`Generate`, S:4293) and its hooks, in order

1. `GENERATION_STARTED` (S:4299) → slash commands from the input box (S:4310-4317) → `GENERATION_AFTER_COMMANDS` (S:4321).
2. Group chat and not a dry run: returns `generateGroupWrapper(...)` (S:4352-4353). That wrapper calls `Generate` **once per member**, so every per-generation event fires again for each member, with `characterId` set to that member (group-chats.js:1050-1063).
3. Built-in depth prompts are set through `setExtensionPrompt` (S:4472-4486).
4. `coreChat = chat.filter(x => !x.is_system || toolInvocations)` (S:4496), then mapped to **shallow copies** `{...chatItem, mes: regexedMessage, index}` (S:4501-4528).
5. **`runGenerationInterceptors(coreChat, this_max_context, type)`** (S:4564; skipped on dryRun, S:4572).
6. World-info scan: `getWorldInfoPrompt(...)` (S:4635). Extension prompts with `scan:true` are added to the scan buffer (world-info.js:4719-4726).
7. Quiet prompt injected as extension prompt `QUIET_PROMPT` (S:4623). IN_CHAT injections are spliced into the chat by `doChatInject` (S:4745, S:5628-5675).
8. `GENERATE_BEFORE_COMBINE_PROMPTS` → `GENERATE_AFTER_COMBINE_PROMPTS` (S:5234, 5243). For CC: `prepareOpenAIMessages` → `CHAT_COMPLETION_PROMPT_READY` (openai.js:1619).
9. `GENERATE_AFTER_DATA` (S:5318). On dry runs it returns here (S:5320).
10. Send: streaming if `isStreamingEnabled() && type !== 'quiet'` (S:5385). **Quiet generations never stream.** CC request → `CHAT_COMPLETION_SETTINGS_READY`.
11. Result: `saveReply` → MESSAGE_RECEIVED → render → CHARACTER_MESSAGE_RENDERED; or the stream's finalize step does the same. Then tool calls (§6), `saveChatConditional()` (S:5573), `unblockGeneration` (S:5693), which **flushes WI depth/outlet injections** (S:5678-5688).

### 3.1 generate_interceptor (manifest)
- Manifest: `"generate_interceptor": "myGlobalFnName"`. Runner: `extensions.js:2024-2048`. Order: by `loading_order`, then `display_name` (`sortManifestsByOrder` extensions.js:49). The interceptor is called only if `typeof globalThis[key] === 'function'`.
- Signature: `await globalThis[key](chat, contextSize, abort, type)` (extensions.js:2037). Here `abort(immediately: boolean)` marks the generation aborted. With `true`, it also skips the remaining interceptors. A thrown error is logged and the next interceptor still runs.
- When aborted: Generate calls `unblockGeneration` and returns quietly (S:4566-4569).
- Built-ins: `vectors_rearrangeChat` (vectors/manifest.json:8, defined in vectors/index.js:776, assigned :891) and `SD_ProcessTriggers` (stable-diffusion/manifest.json:8). Vectors returns early for `type === 'quiet'` (:778).
```js
// vectors/index.js:776,891
async function rearrangeChat(chat, _contextSize, _abort, type) { if (type === 'quiet') return; ... }
globalThis.vectors_rearrangeChat = rearrangeChat;
```
- **DOCS MISMATCH (WE:647):** the docs say messages are the real chat objects and changes "will be reflected in the actual chat history". In the source, the array and its elements are **shallow copies** (S:4524-4528, S:4539-4552). So:
  - Adding, removing or reordering array items, or replacing a field like `chat[i].mes = ...`, changes **only this prompt**.
  - Changing nested objects such as `chat[i].extra.foo = ...` **does** change the real message, because `extra` is shared.
  - `structuredClone` is only needed if you change nested fields.
- To drop a message from the prompt without changing the message count (which keeps WI timed effects working), set `extra[SillyTavern.getContext().symbols.ignore] = true`. It is honoured in text completion (S:5841) and CC (openai.js:584). It is a Symbol, so it is **not serialized** when the chat is saved (constants.js:19-25). Because `extra` is shared with the real message, set it on a cloned `extra` if you don't want it to stay in memory.

### 3.2 setExtensionPrompt (S:8926)
`setExtensionPrompt(key, value, position, depth, scan = false, role = extension_prompt_roles.SYSTEM, filter = null)`
stores `extension_prompts[key] = {value:String, position:Number, depth:Number, scan:!!scan, role:Number, filter}`.
- **Argument order:** `scan` comes *before* `role`. The JSDoc above it lists role before scan, which is misleading.
- `extension_prompt_types` (S:484): `NONE:-1`, `IN_PROMPT:0` (after the story string / CC "end" of system prompts), `IN_CHAT:1` (at `depth` messages from the end; 0 = after the last message), `BEFORE_PROMPT:2` (before the story string / CC "start"). Mapping for CC: openai.js:1140-1150.
- `extension_prompt_roles` (S:494): `SYSTEM:0, USER:1, ASSISTANT:2`. To convert a string role: `getExtensionPromptRoleByName('user')` (S:8942). Note that this helper is not exposed in getContext.
- `MAX_INJECTION_DEPTH = 10000` (S:499).
- `filter`: a function returning `boolean | Promise<boolean>`, checked at assembly time (S:3302-3308). Use it for conditional prompts.
- Values go through `substituteParams` (macros resolve) at assembly time (S:3325-3327).
- Prompts with the same position, depth and role are **sorted by key** and joined with `\n` (S:3309-3315). Built-ins use key prefixes to order themselves: `'1_memory'` (memory/index.js:36), `'2_floating_prompt'` (authors-note.js:26 "Deliberate, for sorting lower than memory"), `'3_vectors'`, `'4_vectors_data_bank'` (vectors/index.js:52-53).
- CC only: keys **not** in `knownExtensionPrompts` (openai.js:1437-1446), with position BEFORE_PROMPT or IN_PROMPT, become prompt-manager system prompts with identifier `key.replace(/\W/g,'_')` (openai.js:1449-1465). IN_CHAT prompts are injected per depth and role (openai.js:810-860).
- To remove one: set the value to `''`. Built-ins pass `''` (authors-note.js:352; vectors/index.js:784-785). There is no delete helper in the context, but `delete getContext().extensionPrompts[key]` also works on the current object.
- **Lifetime:** `clearChat()` empties *all* extension prompts (S:1590), and it runs on every chat load or reload. Re-apply your prompt on `CHAT_CHANGED`, as memory does (memory/index.js:409-413, registered :1079), or set it right before each generation (an interceptor, `GENERATION_AFTER_COMMANDS`, or a filter).

Canonical uses:
```js
// memory/index.js:965
setExtensionPrompt(MODULE_NAME, formatMemoryValue(value), extension_settings.memory.position, extension_settings.memory.depth, extension_settings.memory.scan, extension_settings.memory.role);
// authors-note.js:383-390
context.setExtensionPrompt(MODULE_NAME, String(prompt), chat_metadata[metadata_keys.position], chat_metadata[metadata_keys.depth], extension_settings.note.allowWIScan, chat_metadata[metadata_keys.role]);
```
Built-in injection ids: `inject_ids` (constants.js:48-56): `__STORY_STRING__`, `QUIET_PROMPT`, `DEPTH_PROMPT[_n]`, `customDepthWI_*`, `customWIOutlet_*`. Avoid these keys.

---------------------------------------------------------------------------------------------------
## 4. Making LLM calls from an extension

| API | Def | Uses chat context? | Events/interceptors | Stop | Stream | Returns |
|---|---|---|---|---|---|---|
| `generateQuietPrompt({quietPrompt, quietToLoud, skipWIAN, quietImage, quietName, responseLength, forceChId, jsonSchema, removeReasoning=true, trimToSentence=false})` | S:3084 | Yes. Full `Generate('quiet')`: character card, WI, author's note, chat history, and your instruction injected as `QUIET_PROMPT` IN_PROMPT depth 0 (S:4623) | All Generate events and interceptors (with `type === 'quiet'`) | Global `abortController`. The UI stop button or `stopGeneration()` aborts it. It takes no signal parameter. | Never | `Promise<string>` (JSON string when `jsonSchema` is set) |
| `generateRaw({prompt, api, instructOverride, quietToLoud, systemPrompt, responseLength, trimNames=true, prefill, jsonSchema})` | S:4122 | No. Uses only what you pass. `prompt` is a string or `[{role,content}]`. Converted to the main API format, with instruct formatting and `substituteParams` (createRawPrompt S:3924) | GENERATE_AFTER_COMBINE_PROMPTS (string) / CHAT_COMPLETION_PROMPT_READY (array) (S:4029-4039); CHAT_COMPLETION_SETTINGS_READY / TEXT_COMPLETION_SETTINGS_READY. No interceptors and no GENERATION_STARTED. | Listens for `GENERATION_STOPPED` (S:4018), so `stopGeneration()` aborts it | No | `Promise<string>` cleaned with `cleanUpMessage`. Throws `'No message generated'` on empty output (S:4147). |
| `generateRawData(sameParams)` | S:4000 | as generateRaw | as generateRaw | as generateRaw | No | Raw API JSON (for example to read reasoning). Use `extractMessageFromData(data, api)` (S:6276, in context). |
| `ConnectionManagerRequestService.sendRequest(profileId, prompt, maxTokens, {stream, signal, extractData=true, includePreset=true, includeInstruct=true, instructSettings}, overridePayload)` | extensions/shared.js:423 | No | **None.** It does not touch global settings or the UI | Only your `signal` | Yes | With `extractData`: `{content, reasoning}` (custom-request.js:60-63). With `stream:true`: a **function** that returns an AsyncGenerator of `{text, swipes, state:{reasoning,image}}`, where `text` is cumulative (custom-request.js:66-71). |
| `ChatCompletionService.processRequest(payload, {presetName}, extractData, signal)` / `TextCompletionService.processRequest(payload, {presetName, instructName, instructSettings}, extractData, signal)` | custom-request.js:544 / :283 | No | None | signal | Yes | same as above |
| `generate` (= `Generate(type, opts, dryRun)`) | S:4293 | Yes; this is the full user-visible generation | all | global | per settings | message string or `undefined` |
| `sendGenerationRequest` / `sendStreamingRequest` | S:6116 / S:6147 | low-level; use the global `abortController` and `streamingProcessor` | – | – | – | Avoid. sendStreamingRequest requires the global `streamingProcessor` to exist (S:6154). |

- **Recommendation (from source behaviour):**
  - Summaries or prompts "in the context of the chat": `generateQuietPrompt`.
  - Self-contained tasks (classify, extract, JSON) on the user's current API: `generateRaw`.
  - A different model or connection than the chat uses, streaming, parallel requests, or no side effects: `ConnectionManagerRequestService`. It requires the Connection Manager extension to be enabled (shared.js:427-429). Let the user pick a profile with `ConnectionManagerRequestService.handleDropdown(selector, initialId, onChange, …)` (shared.js:634). Validate profiles with `getSupportedProfiles()` and `isProfileSupported()`. Only `openai` (CC) and `textgenerationwebui` (TC) profiles are supported (shared.js:402-407).
- Canonical streaming use (connection-manager/index.js:609-622):
```js
const streamResponse = await ConnectionManagerRequestService.sendRequest(profileId, messages, maxTokens,
    { extractData: true, includePreset: true, stream: true, signal: abortController?.signal ?? undefined });
if (typeof streamResponse === 'function') {
    for await (const chunk of streamResponse()) { finalText = chunk.text; finalReasoning = chunk.state?.reasoning || ''; }
} else { finalText = streamResponse?.content || ''; }
```
  Errors are wrapped as `new Error('API request failed', { cause })` (shared.js:490).
- `responseLength` on generateQuietPrompt and generateRaw works by **temporarily mutating global settings** (`oai_settings.openai_max_tokens` or `amount_gen`) through `TempResponseLength` (S:4153-4259) and restoring them afterwards. A concurrent generation might see the temporary value (UNVERIFIED in practice).
- Structured output: pass `jsonSchema: {name, value, description?, strict?, returnInvalid?}` (typedef S:4261-4268). generateRaw and generateQuietPrompt then return a JSON **string**. The docs (WE:810+) say it is CC-only, and the output is not validated. `extractJsonFromData(..., {returnInvalidJson})` is used at S:4103 and S:5482. Parse it inside try/catch.
- Stop everything: `getContext().stopGeneration()` (S:5607). It aborts streaming and the global controller, then emits `GENERATION_STOPPED` without awaiting. It returns a boolean.
- Starting `Generate` (including quiet) replaces the global `abortController` unless a `signal` is passed (S:4301-4303). A quiet generation started during another generation therefore takes over the stop button's controller (UNVERIFIED side effects).

---------------------------------------------------------------------------------------------------
## 5. Chat data

### 5.1 Message object (`public/global.d.ts:66-128`)
`ChatMessage { name, mes, title, gen_started, gen_finished, send_date, is_user, is_system, force_avatar, original_avatar, swipes: string[], swipe_info: SwipeInfo[], swipe_id, extra }`
`SwipeInfo { send_date, gen_started, gen_finished, extra }`.
`extra` (BaseMessageExtra) has these core keys: `api, model, type, gen_id, bias, uses_system_ui, memory, display_text, reasoning_display_text, tool_invocations, title, isSmallSys, token_count, swipeable, overswipe_behavior, files, inline_image, media_display, media_index, media[]`, reasoning fields, deprecated `file/image/video/image_swipes`, and `[IGNORE_SYMBOL]`. The type is `Record<string, any>`, so extensions may add their own keys.
- `is_system: true` means hidden from the prompt (filtered at S:4496). Exception: system messages carrying `extra.tool_invocations` are kept when tools are supported.
- `extra.display_text` overrides what is rendered without changing `mes`, which is what gets sent to the LLM (updateMessageBlock S:2036; translate uses it at translate/index.js:215).
- `extra.type === 'narrator'` (system_message_types.NARRATOR) sends the message as a system role.
- Group chats: `name` holds the speaker. Members are identified by `original_avatar` and `force_avatar` (set in saveReply).
- **`extra` is per-swipe.** Swiping calls `syncMesToSwipe` first, which saves `structuredClone(message.extra)` into `swipe_info[swipe_id].extra` (S:10339-10340, S:6939). It then loads the target swipe's `extra` (S:7015). Data you put in `extra` follows the active swipe. For data that belongs to the whole message, either accept that or store it in `chatMetadata` keyed by message index or `send_date`. (The second option is a design suggestion, not ST convention.)
- **Namespace your keys** (`extra.my_ext = {...}`). Built-ins use flat keys, e.g. memory uses `extra.memory` (memory/index.js:386).

### 5.2 Adding and changing messages
- Add (canonical, stable-diffusion/index.js:4982-5000):
```js
context.chat.push(message);
const messageId = context.chat.length - 1;
await eventSource.emit(event_types.MESSAGE_RECEIVED, messageId, 'extension');
context.addOneMessage(message);
await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, messageId, 'extension');
await context.saveChat();
```
  `addOneMessage(mes, {type, insertAfter, scroll=true, insertBefore, forceId, showSwipes=true})` (S:2551) only renders, and returns the jQuery element. The caller must push into `chat` first (S:2552). For user messages, mirror MESSAGE_SENT and USER_MESSAGE_RENDERED (S:5914-5919).
- `sendSystemMessage(type, text, extra)` (system-messages.js:158) pushes and renders, but **does not save or emit**.
- Edit: mutate `chat[id]`, then call `updateMessageBlock(id, chat[id], {rerenderMessage=true})` (S:2033), which re-renders `.mes_text` with `extra.display_text ?? mes` plus media and reasoning. Then call `await context.saveChat()`. Neither function emits events. If you want other extensions to react, emit `MESSAGE_EDITED` and `MESSAGE_UPDATED(id)` yourself, as `/message-edit` does (slash-commands.js:5850, 5857).
- Delete: `deleteMessage(id, swipeDeletionIndex?, askConfirmation=false, deleteToolCalls=true)` (S:1639). It **returns silently if the message's DOM element isn't rendered** (S:1654-1657; lazy-loaded chats only render the last N messages). It deletes preceding tool-call system messages too, debounce-saves, and emits MESSAGE_DELETED. `deleteLastMessage()` (S:1607) does not save.
- Save:
  - `context.saveChat` is **`saveChatConditional`** (st-context.js:159; S:9412). It waits for any in-flight save, cancels the debounced save, and saves the solo or group chat. Errors are logged, not thrown.
  - `saveMetadata()` (S:9408) is the same function.
  - `saveMetadataDebounced()` (extensions.js:89) skips the save if the character or group changed in the meantime.
  - Raw `saveChat()` (S:7395) **throws in group chats** (S:7396-7399). Don't use it.
- Re-render or reload: `printMessages()` (S:1477); `reloadCurrentChat()` (mutex wrapper S:1702-1703). Reloading calls `clearChat`, which **cancels pending debounced chat and metadata saves** (S:1586-1587), so save first.
- `swipe` helpers: `context.swipe.{left,right,to,show,hide,refresh,isAllowed,state}` (st-context.js:248-257).

### 5.3 chatMetadata, characters, groups
- `chatMetadata` is per chat and stored in the chat file header (S:7657). Write `getContext().chatMetadata.my_ext = …`, then call `saveMetadataDebounced()` or `await saveMetadata()`. Reserved keys used by core: `variables` (variables.js:23-27), `world_info` (chat lorebook, world-info.js:94), `tainted`, `integrity` (S:7665-7667), author's-note keys.
- `characters[characterId]`: `characterId` is the **array index as a string**, and is `undefined` in groups or when nothing is selected (S:7122-7133; WE:369-375). During group generation it is temporarily set to the drafting member (group-chats.js:1054, reset :1080). For the current solo chat file: `characters[id].chat`. Group: `groups.find(g => g.id === groupId)` (`Group` type global.d.ts:26-43: `members` are avatar file names, `disabled_members`, `chat_id`, `chats`).
- Characters can be **shallow** (lazy-loaded). Call `await getContext().unshallowCharacter(id)` (S:7607) before reading full card data of a non-active character, or `unshallowGroupMembers(groupId)`.
- Card extension data: `writeExtensionField(characterId, key, value)` (extensions.js:2070). It updates the in-memory `data.extensions[key]` and `json_data`, then POSTs `/api/characters/merge-attributes` (:2111). Pass `getContext().constants.unset` (`UNSET_VALUE`) to delete the field. It **logs and does not throw** on HTTP failure (:2117-2119). Bulk version: `writeExtensionFieldBulk(avatars|null, key, value, {filterPath})` (:2152) returns `{updated, skipped, failed}`. Read it back with `characters[id].data?.extensions?.[key]`.

---------------------------------------------------------------------------------------------------
## 6. Tool calling (`public/scripts/tool-calling.js`)

- `registerFunctionTool({ name, displayName, description, parameters, action, formatMessage, shouldRegister, stealth })` (:269). Registering the same name again overwrites it with a warning (:275-277). There is also a legacy positional form `(name, description, parameters, action)` (:271-273).
  - `parameters`: a JSON Schema object, sent as-is as `{type:'function', function:{name, description, parameters}}` (:188-200).
  - `action(args)`: receives parsed args (an empty string becomes `{}`, :311-317). It may be async. A non-string result is JSON-stringified (:333). If it throws, the error becomes an invocation with `error:true` whose result is the error text, so the LLM sees the failure (:816-834). Errors are also shown as a toast (`showToolCallError`).
  - `formatMessage(args)`: the toast text. The default is `"Invoking tool: <displayName|name>"` (:218-222). Returning `''` suppresses the toast (`message && toastr.info`, :812).
  - `shouldRegister()`: may be async and is evaluated **per request** (:404-410).
  - `stealth: true`: the result is not saved to chat and **no follow-up generation** happens (:836-840; S:5421-5430 and S:5546-5553).
- `unregisterFunctionTool(name)` (:297).
- `isToolCallingSupported()` (:614) requires all of: `main_api === 'openai'`, `oai_settings.function_calling` enabled, a supported source or model capability (:631-689), and prompt post-processing of NONE/MERGE_TOOLS/SEMI_TOOLS/STRICT_TOOLS.
- `canPerformToolCalls(type)` (:694) returns false for `impersonate`, `quiet` and `continue`.
- Recursion: `ToolManager.RECURSE_LIMIT` defaults to 5 (:255) and is overwritten from `oai_settings.tool_call_recurse_limit` (openai.js:4399, 7060; UI range 1-50). Each round re-runs `Generate('normal', {..., depth+1})` (S:5435, S:5558).
- Saved form: `saveFunctionToolInvocations` (:899) pushes an `is_system` message with `extra.tool_invocations` and `extra.isSmallSys`, emits TOOL_CALLS_PERFORMED, renders it, emits TOOL_CALLS_RENDERED, and saves. `ToolInvocation = {id, displayName, name, parameters:string, result:string, signature?, reasoning?, error?}` (:16-25).
- Canonical (stable-diffusion/index.js:5452-5484): it re-registers or unregisters based on a setting, uses `Object.freeze` on the schema, and throws `Error`s for bad state:
```js
if (!extension_settings.sd.function_tool) { return ToolManager.unregisterFunctionTool('GenerateImage'); }
ToolManager.registerFunctionTool({ name: 'GenerateImage', displayName: 'Generate Image', description: [...].join(' '),
  parameters: Object.freeze({ $schema: 'http://json-schema.org/draft-04/schema#', type: 'object',
    properties: { prompt: { type: 'string', description: ... } }, required: ['prompt'] }),
  action: async (args) => { if (!args?.prompt) throw new Error('Missing prompt'); ... return encodeURI(url); } });
```
- FC docs check: the fields table, defaults, stealth, empty-string toast, recursion limit and canPerformToolCalls types all **match the source**.

---------------------------------------------------------------------------------------------------
## 7. Macros

Two systems exist. The **new engine** is on by default: `power_user.experimental_macro_engine: true` (power-user.js:302). Users can turn it off (toggle at power-user.js:3874), in which case `substituteParams` uses the legacy path (S:2997-2999).
- New API: `getContext().macros` (st-context.js:245 → macros/macro-system.js:44-60) = `{engine, registry, envBuilder, lexer, parser, cstWalker, category, valueType, register, registerAlias}`.
  - `macros.register(name, options)` = `MacroRegistry.registerMacro` (MacroRegistry.js:198). It **returns the definition or `null`**, and logs instead of throwing on bad options. The source (extension or third-party) is detected from the call stack (:204).
  - Options (MacroRegistry.js:63-76): `handler` (required), `description`, `category` (`macros.category.*`: UTILITY, RANDOM, NAMES, CHARACTER, CHAT, TIME, VARIABLE, PROMPTS, STATE, MISC, UNCATEGORIZED; :19-42; a custom string is allowed), `unnamedArgs` (a number or `[{name, optional, defaultValue, type, sampleValue, description}]`, where optional args must come last), `list` (bool or `{min,max}`), `strictArgs=true`, `returns`, `returnType`, `displayOverride`, `exampleUsage`, `delayArgResolution`, `aliases:[{alias, visible}]`.
  - Handler context (:105-129): `{name, args, unnamedArgs, list, namedArgs:null, flags, isScoped, raw, rawOriginal, rawArgs, env, cstNode, range, globalOffset, normalize, trimContent, resolve(text), warn(msg)}`. Handlers are **synchronous** (`def.handler(executionContext)` is not awaited, :459). The result is normalized to a string.
  - Wrong argument counts throw when `strictArgs` is set, otherwise they warn (:403-424).
  - `macros.registry.unregisterMacro(name)` (:327) returns a boolean. It is case-insensitive and throws on an empty name. Other registry methods: `hasMacro`, `getMacro`, `getAllMacros`.
  - `macros.registerAlias(target, alias, {visible})` (:241).
- Legacy: `getContext().registerMacro(key, value|fn, description)` and `unregisterMacro`. They are deprecated (st-context.js:182-185), and every call logs a deprecation warning (macros.js:183-184). When the new engine is on, they are bridged into it as 0-argument macros in category `'legacy'` (macros.js:81-117). So legacy registration works under both engines, but only takes 0 arguments.
- **Recommended pattern (what built-ins actually do):** check the toggle and fall back. Memory (memory/index.js:1119-1130) and expressions (expressions/index.js:2653-2720) both do this:
```js
if (power_user.experimental_macro_engine) {
    macros.register('summary', { category: MacroCategory.CHAT, description: '...', handler: () => summaryMacroHandler() });
} else {
    MacrosParser.registerMacro('summary', () => summaryMacroHandler(), '...');
}
```
  From an extension, read the toggle with `getContext().powerUserSettings.experimental_macro_engine`. The docs (WE:877-955) recommend only `macros.register` and don't mention the toggle or the fallback (**docs gap**). A macro registered only through the new API will not resolve if the user turned the engine off (inferred from S:2997-2999; UNVERIFIED in a running app).
- Arguments example with deferred resolution (expressions/index.js:2662-2687): `handler: function ({ args: [name = '{{char}}'], resolve }) { ... resolve(name) ... }` with `delayArgResolution: true`.
- Expand macros in your own text: `substituteParams(content, {name1Override, name2Override, original, groupOverride, replaceCharacterCard, dynamicMacros, postProcessFn})` (S:2981). Use `dynamicMacros` for one-off values. The legacy positional form is still accepted. `substituteParamsExtended(content, additionalMacro)` (S:2815) is also available.

---------------------------------------------------------------------------------------------------
## 8. Variables (`public/scripts/variables.js`, exposed at st-context.js:258-277)

`getContext().variables.local|global .{get,set,del,add,inc,dec,has}`.
- Local variables live in `chat_metadata.variables` (variables.js:23-27). `set` calls `saveMetadataDebounced()` (:76).
- Global variables live in `extension_settings.variables.global`. `set` calls `saveSettingsDebounced()` (:126).
- `get(name, {key?, index?})` returns a **Number when the value looks numeric**, otherwise a string or `''` (:44, :101). With `index`, it JSON-parses the value and indexes into it.
- `set(name, value, {index?, as?})` returns the value. An `index` makes it write JSON.
- `add` (:136) does numeric add or concatenation, `inc`/`dec` add ±1, `del` returns `''` and warns if the variable is missing, `has` returns a boolean.
- These are the same values STscript `/setvar` and `{{getvar}}` use. Local variables are bound to the active chat at the moment of the call (the race note in §11 applies).

---------------------------------------------------------------------------------------------------
## 9. World info APIs (context: st-context.js:278-284)

- `loadWorldInfo(name)` (world-info.js:2036) returns `{entries:{uid:entry}}` or `null`. It is cached, and `worldInfoCache` uses `cloneOnGet: true` (:882), so you get a **copy**.
- `saveWorldInfo(name, data, immediately=false)` (:4177) updates the cache and either debounces the save or does it immediately. The immediate path POSTs `/api/worldinfo/edit` and emits WORLDINFO_UPDATED (:4152-4161). Don't mutate `data` after saving (comment :4169).
- `createWorldInfoEntry(_name, data)` (:4137) adds a new entry with a free uid. It is **not in getContext** (import it, or build the entry yourself).
- `getWorldInfoNames()` returns a copy of `world_names`. Also available: `updateWorldInfoList()`, `reloadWorldInfoEditor(file, loadIfNotSelected)` (:1040), `convertCharacterBook`, and `getWorldInfoPrompt(chat, maxContext, isDryRun, globalScanData)` (:892). That last one runs a full scan; `chat` is the messages in reverse order.
- Chat lorebook name is stored in `chatMetadata.world_info` (`METADATA_KEY`, :94).
- Hooks: WORLDINFO_ENTRIES_LOADED and WORLDINFO_SCAN_DONE (both mutable), WORLD_INFO_ACTIVATED, and **emitting WORLDINFO_FORCE_ACTIVATE** with `[{world, uid, ...}]` (:1020-1029).

---------------------------------------------------------------------------------------------------
## 10. Tokens and server endpoints

- `getTokenCountAsync(str, padding?)` (tokenizers.js:443) returns `Promise<number>` using the current API tokenizer. For CC it uses the OpenAI-style counter (:452-459). `getTokenCount` is deprecated (st-context.js:150-151). Others: `getTextTokens(tokenizerType, str)` (:1157), `getTokenizerModel()`, `tokenizers` enum.
- `getRequestHeaders({omitContentType=false})` (S:647) returns `{'Content-Type':'application/json','X-CSRF-Token': token}`. **Every** fetch to ST's `/api/*` needs these headers (CSRF). Use `omitContentType:true` for FormData uploads.
- Endpoints built-ins call (all POST with JSON, via getRequestHeaders):
  - `/api/characters/merge-attributes` (extensions.js:2111), `/api/characters/get` (S:1224), `/api/characters/all` (S:1295)
  - `/api/chats/get` and `/api/chats/save` (S:7311, S:7348), `/api/chats/search` (S:8583), `/api/chats/group/save`
  - `/api/worldinfo/get|edit|delete|import` (world-info.js)
  - `/api/files/upload` (chats.js:276), `/api/images/upload` (via `saveBase64AsFile`, utils.js:1651)
  - `/api/backends/chat-completions/generate` (openai.js:3148), `/api/backends/text-completions/generate`
  - `/api/plugins/<id>/...` for server plugins (scrapers.js:260)
  - Prefer the JS helpers over raw endpoints whenever a helper exists.

---------------------------------------------------------------------------------------------------
## 11. Pitfalls (source-backed)

1. **Chat switch during `await`.** `context.chat` is the same array object after a switch (§0), so `chat[i]` after an `await` may belong to another chat. Capture the ids and compare after each await, as memory does (memory/index.js:398-407):
   ```js
   function isContextChanged(context) { const n = getContext();
     return n.groupId !== context.groupId || n.chatId !== context.chatId || (!n.groupId && n.characterId !== context.characterId); }
   ```
   Vectors does the same: `if (chatId !== getCurrentChatId()) throw new Error('Chat changed');` (vectors/index.js:263). `saveChatConditional` saves *whatever chat is current*. Only `saveMetadataDebounced` checks for a switch.
2. **Do not hold** `chatMetadata`, `extensionPrompts`, `characterId` or `chatId` across awaits or events. Re-read them from `getContext()`.
3. **Extension prompts are wiped on every chat load or reload** (`clearChat` S:1590). Re-apply them on CHAT_CHANGED.
4. **CHAT_CHANGED fires on reloads** with the same id, and also with `undefined` when the chat is closed (S:10760). Make the handler idempotent.
5. **MESSAGE_RECEIVED fires for non-generations**: `'first_message'` on every load of a 1-message chat, plus `'command'` and `'extension'`. It also fires per member in groups, per tool-call round, and with `'swipe'`/`'continue'`/`'appendFinal'` for the *same* messageId. Filter on `type`. Translate skips swipes that are still generating (`isGeneratingSwipe`, translate/index.js:209).
6. **Streaming:** STREAM_TOKEN_RECEIVED carries cumulative text, is awaited per chunk (S:3895), and blocks the stream. MESSAGE_RECEIVED fires once at the end (S:3799), or un-awaited on error (S:3828). Quiet generations never stream (S:5385).
7. **GENERATION_STARTED, GENERATE_AFTER_DATA and TEXT_COMPLETION_SETTINGS_READY fire on dry runs** (prompt-manager token counting). Check the `dryRun` argument; TEXT_COMPLETION_SETTINGS_READY has none. GENERATION_STARTED also fires for other extensions' quiet generations (`type === 'quiet'`).
8. **Group chats:** Generate runs once per member, and `characterId` changes per member. The greeting event (CHARACTER_FIRST_MESSAGE_SELECTED) fires only in groups. CHAT_LOADED fires only for solo chats.
9. **Mutating chat without saving:** `addOneMessage`, `updateMessageBlock`, `sendSystemMessage` and `deleteLastMessage` don't save. `reloadCurrentChat` cancels pending debounced saves. Always end with `await getContext().saveChat()`.
10. **Swipes:** `extra` is per-swipe (§5.1). After editing `mes`, the swipe text is synced only when core calls `syncMesToSwipe` (not exposed in the context). Core calls it before a swipe (S:10340), so usually you don't need to.
11. **Performance:** `emit` awaits listeners in order, so heavy listeners delay rendering and saving. Debounce chat-wide work (vectors `debounce(..., debounce_timeout.relaxed)`). Keep STREAM_TOKEN_RECEIVED and macro handlers cheap. Macro handlers are synchronous and run on every substitution.
12. `once()` listeners can't be removed with the original function (eventemitter.js:190-195). `emitAndWait` does not wait (§1).
13. `deleteMessage` no-ops for messages that aren't rendered (S:1654-1657).
14. In `CHAT_COMPLETION_PROMPT_READY`, mutate `eventData.chat` in place (openai.js:1616-1623).

## 12. Docs ↔ source mismatches found
- WE:647 interceptor "messages are mutable / reflected in actual chat history": the source passes shallow copies (S:4524, 4539). Only nested `extra` is shared.
- WE:877-955 recommends `macros.register` alone. Built-ins check `experimental_macro_engine` and fall back to legacy (memory/index.js:1119; expressions/index.js:2653).
- WE:958 says message formatting hooks are "staging only". They ship in 1.19.0: `messageFormatter: MessageFormatter` (st-context.js:246; message-formatter.js:184 `addHook`).
- WE:520+ examples use `event_types`. The context marks it deprecated in favour of `eventTypes` (st-context.js:226-227).
- WE "Emitting events" implies `await emit` waits for handlers, which is true. The undocumented `emitAndWait` does **not** wait.
- `setExtensionPrompt` JSDoc lists `role` before `scan`, but the real parameter order is `(key, value, position, depth, scan, role, filter)` (S:8916-8926).
- FC.md: no mismatches found.
