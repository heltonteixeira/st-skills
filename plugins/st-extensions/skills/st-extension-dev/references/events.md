# Events

Checked against SillyTavern 1.19.0. Emitter: `public/lib/eventemitter.js`; names:
`public/scripts/events.js`. Use `eventTypes.X` (not string literals, not deprecated `event_types`).

## Contents
1. eventSource API and emit semantics
2. Events by area (payload, when)
3. Pitfalls

## 1. API

| Method | Behaviour |
|---|---|
| `on(type, fn)` | append listener. `type === undefined` (a typo'd `eventTypes.X`) logs a trace and does nothing |
| `once(type, fn)` | one-shot; **cannot** be removed with `removeListener(type, fn)` (a wrapper is stored) |
| `makeFirst(type, fn)` / `makeLast(type, fn)` | insert or move to the front / back - for "see text before others" (translate) or "see the final state" (memory, tts) |
| `removeListener(type, fn)` | remove by identity (no `off` alias) |
| `emit(type, ...args)` | async; **awaits each listener in turn**; a throwing listener is logged and the rest still run |
| `emitAndWait(type, ...args)` | despite the name, synchronous and **does not await** listeners |

- A slow async listener delays ST: e.g. `MESSAGE_RECEIVED` is awaited before the message renders.
  Keep handlers quick; push heavy work to an un-awaited promise or a debounce.
- `APP_READY` and `APP_INITIALIZED` auto-fire for listeners added after they happened.
- Custom events: any string; emit your own (`eventSource.emit('myext_done', data)`) to let other
  extensions integrate.
- Debug: `localStorage.setItem('eventTracing', 'true')` logs every emit with args.
- Remove temporary listeners (per popup / per job) with a kept function reference.

## 2. Events

Mode: **A** = core awaits your listener, **N** = core does not wait.

### App and settings
| Event | Payload | Notes |
|---|---|---|
| `APP_INITIALIZED` | - | A; after all extensions loaded, loader overlay still up; sticky |
| `APP_READY` | - | A; UI ready; sticky - safe to subscribe late |
| `EXTENSION_SETTINGS_LOADED`, `SETTINGS_LOADED`, `SETTINGS_LOADED_BEFORE/_AFTER(settings)` | | A; during boot |
| `SETTINGS_UPDATED` | - | A; after any settings save |
| `MAIN_API_CHANGED` | `{ apiId }` | A |
| `CHATCOMPLETION_SOURCE_CHANGED` / `CHATCOMPLETION_MODEL_CHANGED` | source / model string | N |
| `PRESET_CHANGED`, `PRESET_DELETED` | `{ apiId, name }` | A |
| `OAI_PRESET_CHANGED_BEFORE` / `_AFTER`, `OAI_PRESET_EXPORT_READY(preset)`, `OAI_PRESET_IMPORT_READY({data, presetName})` | | presets are mutable in BEFORE/EXPORT/IMPORT |
| `CONNECTION_PROFILE_LOADED(name)`, `_CREATED(profile)`, `_UPDATED(old, new)`, `_DELETED(profile)` | | A |
| `ONLINE_STATUS_CHANGED` | status string | sync (emitAndWait) |
| `SECRET_WRITTEN/DELETED/ROTATED/EDITED` | secret key | A |

### Chat lifecycle
| Event | Payload | Notes |
|---|---|---|
| `CHAT_CHANGED` | chat id string, or `undefined` when the chat is closed | A; also fires on **reload with the same id**; make handlers idempotent |
| `CHAT_LOADED` | `{ detail: { id, character } }` | N; solo chats only |
| `CHAT_CREATED` / `GROUP_CHAT_CREATED` | - | A |
| `CHAT_DELETED` / `GROUP_CHAT_DELETED` | file name / id | A |
| `CHAT_RENAMED` | `{ avatarId, groupId, oldFileName, newFileName }` | A |
| `MORE_MESSAGES_LOADED` | - | A; older messages rendered on scroll-up |

### Messages
| Event | Payload | Notes |
|---|---|---|
| `MESSAGE_SENT` | message index | A; in `chat` and saved, not yet rendered |
| `USER_MESSAGE_RENDERED` | index | A |
| `MESSAGE_RECEIVED` | `(index, type)` | A; type: `normal`, `swipe`, `regenerate`, `continue`, `append`, `appendFinal`, `first_message`, `command`, `extension`. Streaming: fires once at the end. Quiet generations never create a message. |
| `CHARACTER_MESSAGE_RENDERED` | `(index, type)` | A; after each MESSAGE_RECEIVED |
| `MESSAGE_EDITED` / `MESSAGE_UPDATED` | index | A; before / after re-render |
| `MESSAGE_DELETED` | **new `chat.length`** (not the deleted index) | A |
| `MESSAGE_SWIPED` | index | A; fires **before** a new swipe is generated - text may still be a placeholder; the new text arrives with MESSAGE_RECEIVED type `swipe` |
| `MESSAGE_SWIPE_DELETED` | `{ messageId, swipeId, newSwipeId }` | A |
| `STREAM_TOKEN_RECEIVED` | the **whole text so far** | A, once per chunk - must be cheap |
| `MESSAGE_REASONING_EDITED/DELETED`, `STREAM_REASONING_DONE(reasoning, durationMs, messageId, state)` | | A |
| `IMPERSONATE_READY` | text | A |
| `MESSAGE_FILE_EMBEDDED`, `IMAGE_SWIPED`, `MEDIA_ATTACHMENT_DELETED`, `FILE_ATTACHMENT_DELETED` | | A |

### Generation
| Event | Payload | Notes |
|---|---|---|
| `GENERATION_STARTED` | `(type, options, dryRun)` | A; **also on dry runs** (token counting) and other extensions' quiet generations - check `dryRun` and `type` |
| `GENERATION_AFTER_COMMANDS` | same | A; only if slash commands did not end the generation |
| `GENERATE_BEFORE_COMBINE_PROMPTS` | `data` (all prompt parts) | A; text completion: set `data.combinedPrompt` to replace |
| `GENERATE_AFTER_COMBINE_PROMPTS` | `{ prompt, dryRun }` | A; text completion; reassigning `.prompt` works |
| `CHAT_COMPLETION_PROMPT_READY` | `{ chat: [{role, content}], dryRun }` | A; **mutate `chat` in place** - reassigning it is ignored in normal generations |
| `GENERATE_AFTER_DATA` | `(generate_data, dryRun)` | A; final payload; dry runs too |
| `CHAT_COMPLETION_SETTINGS_READY` | request body | A; real sends only, mutable |
| `TEXT_COMPLETION_SETTINGS_READY` | request params | A; mutable; fires on dry runs too, with **no dryRun flag** |
| `GENERATION_STOPPED` | - | N; user/`stopGeneration()` |
| `GENERATION_ENDED` | chat length | N; on completion, error and stop (also quiet) |
| `GROUP_WRAPPER_STARTED/FINISHED({ selected_group, type })`, `GROUP_MEMBER_DRAFTED(characterIndex)` | | A; groups run one Generate per member |
| `TOOL_CALLS_PERFORMED` / `TOOL_CALLS_RENDERED` | invocations[] | A |
| `SD_PROMPT_PROCESSING` | `{ prompt, generationType, message, trigger }` | A; set `.prompt` to modify image prompts |
| `TTS_JOB_STARTED`, `TTS_AUDIO_READY`, `TTS_JOB_COMPLETE` | job info | A |

### Characters, groups, personas
`CHARACTER_EDITED({ detail: { id, character } })`, `CHARACTER_DELETED({ id, character })`,
`CHARACTER_DUPLICATED({ oldAvatar, newAvatar })`, `CHARACTER_RENAMED(oldAvatar, newAvatar)`,
`CHARACTER_RENAMED_IN_PAST_CHAT(chatMessages, oldAvatar, newAvatar)`, `CHARACTER_EDITOR_OPENED(chid)` (N),
`CHARACTER_PAGE_LOADED` (N), `CHARACTER_FIRST_MESSAGE_SELECTED({ input, output, character })`
(groups only; set `output`), `CHARACTER_MANAGEMENT_DROPDOWN(optionId)`, `OPEN_CHARACTER_LIBRARY`,
`GROUP_UPDATED`, `PERSONA_CHANGED(avatar)`, `PERSONA_CREATED/UPDATED/RENAMED/DELETED`.

### World info
`WORLDINFO_UPDATED(name, data)`, `WORLDINFO_SETTINGS_UPDATED` (N),
`WORLD_INFO_ACTIVATED(entries[])` (not on dry runs),
`WORLDINFO_ENTRIES_LOADED({ globalLore, characterLore, chatLore, personaLore })` (mutable arrays),
`WORLDINFO_SCAN_DONE({ state, new, activated, sortedEntries, ... })` (mutable),
and **emit** `WORLDINFO_FORCE_ACTIVATE` with `[{ world, uid }]` to force entries on the next scan.

## 3. Pitfalls

1. `MESSAGE_RECEIVED` is not "the AI replied": filter `type` (skip `first_message`, `command`,
   `extension` unless wanted). `first_message` fires every time a one-message chat is opened.
2. Group chats emit generation and message events once per member.
3. Dry runs: `GENERATION_STARTED`, `GENERATE_AFTER_DATA`, `TEXT_COMPLETION_SETTINGS_READY` fire
   while the user only edits the prompt manager. Ignore `dryRun === true`.
4. Your own background generation (`generateQuietPrompt`) triggers `GENERATION_STARTED` etc. with
   type `quiet` - don't let it re-trigger your handler.
5. `CHAT_CHANGED` fires on reload (same id) and with `undefined`; re-read state, don't toggle.
6. Swipes: `MESSAGE_SWIPED` comes before the new text exists.
7. `emitAndWait` does not wait; `once` cannot be removed by the original function.
