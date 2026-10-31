# Generation: prompts, LLM calls, tools, macros, variables, world info, tokens

Checked against SillyTavern 1.19.0. Main files: `public/script.js` (Generate, setExtensionPrompt,
generateQuietPrompt, generateRaw), `public/scripts/extensions/shared.js` (Connection Manager
service), `public/scripts/tool-calling.js`, `public/scripts/macros/`, `public/scripts/variables.js`.

## Contents
1. Pipeline order
2. setExtensionPrompt
3. Generate interceptor (summary)
4. Calling the LLM from an extension
5. Tool calling
6. Macros
7. Variables
8. World info
9. Tokens

## 1. Pipeline order (`Generate(type, options, dryRun)`)

1. `GENERATION_STARTED` -> slash commands typed in the input -> `GENERATION_AFTER_COMMANDS`.
2. Group chat: one `Generate` per member (all later steps repeat, `characterId` = that member).
3. Chat copied (shallow), hidden/system messages removed.
4. **Generate interceptors** (skipped on dry runs).
5. World info scan (extension prompts with `scan: true` are scanned too).
6. Extension prompts and depth injections placed.
7. `GENERATE_BEFORE/AFTER_COMBINE_PROMPTS` (text completion) or `CHAT_COMPLETION_PROMPT_READY` (chat completion).
8. `GENERATE_AFTER_DATA` (dry runs stop here).
9. Request (`CHAT_COMPLETION_SETTINGS_READY` / `TEXT_COMPLETION_SETTINGS_READY`), streaming unless quiet.
10. Message saved -> `MESSAGE_RECEIVED` -> render -> `CHARACTER_MESSAGE_RENDERED`; tool calls; save.

## 2. setExtensionPrompt

```js
// Values mirror extension_prompt_types / extension_prompt_roles (public/script.js); not on getContext().
const PROMPT_POSITION = Object.freeze({ NONE: -1, IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2 });
const PROMPT_ROLE = Object.freeze({ SYSTEM: 0, USER: 1, ASSISTANT: 2 });

SillyTavern.getContext().setExtensionPrompt(key, value, position, depth, scan = false, role = PROMPT_ROLE.SYSTEM, filter = null);
```
- **Order: `scan` before `role`** (the JSDoc above the function lists them the other way).
- Positions: `IN_PROMPT` after the story string / system prompt; `IN_CHAT` at `depth` messages
  from the end (0 = after the last message); `BEFORE_PROMPT` before the story string; `NONE` stored
  but not placed (useful with macros/WI only).
- `scan: true` lets world info keywords match your text. `filter`: `() => boolean | Promise<boolean>`
  checked at assembly time - a clean way to make the injection conditional.
- The value goes through macro substitution (`{{char}}`, `{{user}}`...).
- Same position/depth/role prompts are sorted **by key** and joined with newlines; built-ins use key
  prefixes (`1_memory`, `2_floating_prompt`, `3_vectors`) to order themselves. Avoid core keys
  (`__STORY_STRING__`, `QUIET_PROMPT`, `DEPTH_PROMPT*`, `customDepthWI_*`, `customWIOutlet_*`).
- Chat completion: non-built-in keys at `BEFORE_PROMPT`/`IN_PROMPT` become prompt-manager system
  prompts; `IN_CHAT` ones are injected by depth and role.
- Remove: set the value to `''`.
- **Lifetime: `clearChat()` empties all extension prompts on every chat load or reload.** Re-apply
  on `CHAT_CHANGED` (memory does), or compute right before generation (`filter`, interceptor,
  `GENERATION_AFTER_COMMANDS`).
- `MAX_INJECTION_DEPTH` is 10000.

## 3. Generate interceptor

See `manifest-and-lifecycle.md` section 5. Key facts: receives **shallow copies**; only nested
`extra` mutations leak into the real chat; skip `type === 'quiet'` unless you mean it.

## 4. Calling the LLM

| API | Context used | Side effects | Stop | Stream | Returns |
|---|---|---|---|---|---|
| `generateQuietPrompt({ quietPrompt, quietToLoud, skipWIAN, quietImage, quietName, responseLength, forceChId, jsonSchema, removeReasoning = true, trimToSentence = false })` | **full chat**: card, WI, author's note, history, + your instruction | all Generate events and interceptors with type `quiet` | global stop button / `stopGeneration()` | no | `Promise<string>` |
| `generateRaw({ prompt, api, instructOverride, quietToLoud, systemPrompt, responseLength, trimNames = true, prefill, jsonSchema })` | **only what you pass**: `prompt` string or `[{ role, content }]` | prompt-ready/settings-ready events only; no interceptors | `stopGeneration()` | no | `Promise<string>`; throws `No message generated` on empty output |
| `generateRawData(sameParams)` | same | same | same | no | raw API JSON (e.g. reasoning); `extractMessageFromData(data, api)` |
| `ConnectionManagerRequestService.sendRequest(profileId, prompt, maxTokens, { stream, signal, extractData = true, includePreset = true, includeInstruct = true }, overridePayload)` | only what you pass, on **any connection profile** | none - does not touch global settings or UI | your `AbortSignal` | yes | `{ content, reasoning }`, or with `stream: true` a function returning an async generator of `{ text (cumulative), state: { reasoning } }` |

Choose:
- "In the context of this chat" (summaries, next-scene ideas): `generateQuietPrompt`.
- Self-contained task (classify, extract, rewrite, JSON) on the user's current API: `generateRaw`.
- A different model/profile than the chat, streaming, parallel jobs or zero side effects:
  `ConnectionManagerRequestService`. Requires the built-in Connection Manager extension enabled and
  supports chat-completion and text-completion profiles; let the user choose with
  `ConnectionManagerRequestService.handleDropdown(selector, initialId, onChange)`; check
  `getSupportedProfiles()` / `isProfileSupported()`. Errors are `Error('API request failed', { cause })`.

```js
const { generateRaw } = SillyTavern.getContext();
let location = '';
try {
    location = (await generateRaw({
        systemPrompt: 'You extract where a roleplay scene takes place.',
        prompt: `Message:\n${text}\n\nAnswer with the location only, or "unknown".`,
        responseLength: 20,
    })).trim();
} catch (e) { console.warn('[My Extension] location extraction failed', e); return; }
```
- Quiet/raw generations do not stream, and running one while the user generates competes for the
  same backend; skip while a generation is in progress if that matters.
- `responseLength` works by temporarily changing global max-token settings and restoring them.
- `jsonSchema: { name, value, description?, strict? }` asks for structured output (chat completion
  backends that support it); the result is a JSON **string** - parse in try/catch.
- `stopGeneration()` aborts the current generation and emits `GENERATION_STOPPED`.
- Starting a quiet `Generate` replaces the global abort controller; the Stop button then stops yours.

## 5. Tool calling

```js
const { registerFunctionTool, unregisterFunctionTool, isToolCallingSupported } = SillyTavern.getContext();
registerFunctionTool({
    name: 'LookupGlossary',                 // unique; re-registering overwrites with a warning
    displayName: 'Glossary Lookup',
    description: 'Look up a term in the user\'s world glossary. Use when a proper noun from the setting appears and you need its definition.',
    parameters: Object.freeze({
        $schema: 'http://json-schema.org/draft-04/schema#',
        type: 'object',
        properties: { term: { type: 'string', description: 'The term to look up' } },
        required: ['term'],
    }),
    action: async ({ term }) => {            // parsed args; throw on bad input - the model sees the error
        const entry = findGlossaryEntry(term);
        return entry ? JSON.stringify(entry) : `No entry for "${term}"`;   // strings pass as-is, other values are JSON-stringified
    },
    formatMessage: ({ term }) => `Looking up ${term}...`,        // toast text; return '' for no toast
    shouldRegister: () => getSettings().enabled,                 // checked per request
    stealth: false,                          // true: result not saved and no follow-up generation
});
```
- Only works with chat completion, "function calling" enabled in the preset, and a model/source that
  supports tools. `isToolCallingSupported()` reports this; tell the user when it is off instead of
  failing silently. Tools are never called for `quiet`, `impersonate`, `continue`.
- The model may call several times; ST re-generates after each round up to the user's recursion limit.
- Results are saved as hidden system messages with `extra.tool_invocations` and shown as tool cards.
- `unregisterFunctionTool(name)` when the user disables the feature (stable-diffusion pattern:
  register/unregister on setting change).

## 6. Macros

Two engines: the new one (default on) and the legacy one; users can switch the new engine off
(`powerUserSettings.experimental_macro_engine`). Built-ins register with both:
```js
const ctx = SillyTavern.getContext();
if (ctx.powerUserSettings?.experimental_macro_engine && ctx.macros?.register) {
    ctx.macros.register('myScene', {
        category: ctx.macros.category.CHAT,
        description: 'Current scene location (My Extension)',
        handler: () => getSceneLocation() ?? '',          // synchronous; return a string
    });
} else {
    ctx.registerMacro('myScene', () => getSceneLocation() ?? '', 'Current scene location');   // deprecated but bridges
}
```
- New-engine options: `handler` (required, sync, gets `{ args, unnamedArgs, namedArgs, env, resolve, warn, ... }`),
  `description`, `category`, `unnamedArgs` (count or `[{ name, optional, defaultValue, type, description }]`),
  `list`, `strictArgs = true`, `returns`, `returnType`, `exampleUsage`, `delayArgResolution`, `aliases`.
  `register` returns the definition or `null` (logs instead of throwing).
- Unregister: `macros.registry.unregisterMacro(name)` / legacy `unregisterMacro(name)`.
- Handlers run on every substitution: keep them cheap and synchronous (cache async results).
- Expand macros in your own text: `substituteParams(text)` (options: `name1Override`,
  `name2Override`, `dynamicMacros: { key: value }`...).

## 7. Variables

`getContext().variables.local` (chat, in `chatMetadata.variables`) and `.global` (in settings):
`get(name, { key?, index? })` (numbers come back as Number), `set(name, value, { index?, as? })`,
`add`, `inc`, `dec`, `del`, `has`. Same store as STscript `/setvar`, `{{getvar::name}}`; saves are
debounced automatically. Local variables bind to the chat active at call time.

## 8. World info

`loadWorldInfo(name)` -> `{ entries: { [uid]: entry } }` (a copy) or null;
`saveWorldInfo(name, data, immediately = false)`; `getWorldInfoNames()`; `updateWorldInfoList()`;
`reloadWorldInfoEditor(name)`; the chat lorebook name is `chatMetadata.world_info`.
Hooks: `WORLDINFO_ENTRIES_LOADED`, `WORLDINFO_SCAN_DONE` (mutable), `WORLD_INFO_ACTIVATED`; emit
`WORLDINFO_FORCE_ACTIVATE` with `[{ world, uid }]` to force entries. `createWorldInfoEntry` is not
on the context: build the entry object yourself (copy the shape from an existing entry).

## 9. Tokens

`await getTokenCountAsync(text)` with the current API's tokenizer (`getTokenCount` is deprecated).
`getTextTokens(tokenizerType, text)`, `getTokenizerModel()`, `tokenizers`. Messages also carry
`extra.token_count` when the user has token counting on - recount if you need it for sure.
