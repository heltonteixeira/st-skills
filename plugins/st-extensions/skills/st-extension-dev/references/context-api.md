# `SillyTavern.getContext()` inventory and `SillyTavern.libs`

Checked against SillyTavern 1.19.0 (`public/scripts/st-context.js`). `getContext()` builds a **new
object on every call**; scalar fields are snapshots. Call it again whenever you need current state.
If a member below is missing on an older ST, feature-check (`if (typeof ctx.x === 'function')`).

## State
| Member | Notes |
|---|---|
| `chat` | current messages array (same array object across chats - see data-and-persistence.md) |
| `characters`, `groups` | lists; characters may be shallow (lazy loading) - `await unshallowCharacter(id)` |
| `characterId` | index into `characters` **as a string** (`"3"`), `undefined` in groups / no chat; temporarily the drafting member during group generation |
| `groupId`, `chatId`, `getCurrentChatId()` | current group / chat file id |
| `name1`, `name2` | user / character display names |
| `chatMetadata` | current chat's metadata - **replaced on every chat load, re-read it** |
| `extensionSettings` | global extension settings object (stable reference) |
| `extensionPrompts` | current injected prompts (replaced by `clearChat`) |
| `mainApi`, `onlineStatus`, `maxContext`, `menuType` | connection / UI state |
| `chatCompletionSettings`, `textCompletionSettings`, `powerUserSettings` | live settings objects (read-only use) |
| `tags`, `tagMap`, `createCharacterData` | tags; create-character form state |
| `symbols.ignore` | Symbol: `extra[ignore] = true` hides a message from a prompt |
| `constants.unset` | pass to `writeExtensionField` to delete a field |
| `accountStorage` | per-account key/value (strings), saved in settings |

## Persistence
`saveSettingsDebounced`, `saveMetadataDebounced`, `saveMetadata`, `updateChatMetadata(newValues, reset)`,
`saveChat` (= `saveChatConditional`, safe in groups), `writeExtensionField`, `writeExtensionFieldBulk`,
`getPresetManager()` (`writePresetExtensionField({ path, value })` / `readPresetExtensionField`).
Not exposed: immediate `saveSettings`.

## Events
`eventSource`, `eventTypes` (`event_types` is a deprecated alias).

## Chat and messages
`getCurrentChatId`, `reloadCurrentChat`, `renameChat`, `openCharacterChat`, `openGroupChat`,
`addOneMessage` (render only), `updateMessageBlock` (re-render one), `deleteMessage`,
`deleteLastMessage`, `sendSystemMessage`, `saveReply`, `appendMediaToMessage`,
`ensureMessageMediaIsArray`, `getMediaDisplay`, `getMediaIndex`, `scrollChatToBottom`,
`scrollOnMediaLoad`, `printMessages`, `clearChat` (visual), `messageFormatting` (message -> safe HTML),
`messageFormatter` (formatting hooks), `activateSendButtons`, `deactivateSendButtons`,
`swipe.{left,right,to,show,hide,refresh,isAllowed,state}`.

## Generation
`generate`, `generateQuietPrompt`, `generateRaw`, `generateRawData`, `stopGeneration`,
`setExtensionPrompt`, `extractMessageFromData`, `ConnectionManagerRequestService`,
`ChatCompletionService`, `TextCompletionService`, `getChatCompletionModel`, `getTextGenServer`,
`sendStreamingRequest`, `sendGenerationRequest`, `streamingProcessor` (avoid the low-level ones),
`updateReasoningUI`, `parseReasoningFromString`, `getReasoningTemplateByName`.
Not exposed: `extension_prompt_types`, `extension_prompt_roles` (mirror the values, see generation.md).

## Tokens
`getTokenCountAsync(text)`, `getTextTokens(type, text)`, `getTokenizerModel()`, `tokenizers`.
Deprecated: `getTokenCount`.

## Characters and groups
`getCharacters`, `getOneCharacter(avatar)`, `getCharacterCardFields`, `getCharacterSource`,
`selectCharacterById(index)`, `unshallowCharacter(id)`, `unshallowGroupMembers(groupId)`,
`getThumbnailUrl(type, file)`, `importTags`, `importFromExternalUrl`.

## Macros and substitution
`substituteParams(text, options)`, `substituteParamsExtended`, `macros` (new engine:
`macros.register`, `macros.registry`, `macros.category`). Deprecated: `registerMacro`, `unregisterMacro`.

## Variables
`variables.local.{get,set,del,add,inc,dec,has}`, `variables.global.{...}` - the same values as
STscript `/setvar` / `{{getvar}}`.

## World info
`loadWorldInfo(name)`, `saveWorldInfo(name, data, immediately)`, `reloadWorldInfoEditor`,
`updateWorldInfoList`, `convertCharacterBook`, `getWorldInfoPrompt`, `getWorldInfoNames()`.

## Slash commands
`SlashCommandParser`, `SlashCommand`, `SlashCommandArgument`, `SlashCommandNamedArgument`,
`SlashCommandEnumValue`, `ARGUMENT_TYPE`, `executeSlashCommandsWithOptions`.
Deprecated: `registerSlashCommand`, `executeSlashCommands`.

## Tools
`registerFunctionTool`, `unregisterFunctionTool`, `isToolCallingSupported`, `canPerformToolCalls`, `ToolManager`.

## UI
`Popup`, `POPUP_TYPE`, `POPUP_RESULT`, `callGenericPopup`, `loader`, `isMobile`, `shouldSendOnEnter`,
`renderExtensionTemplateAsync`, `openThirdPartyExtensionMenu`, `registerDebugFunction`,
`registerDataBankScraper`. Deprecated: `callPopup`, `showLoader`, `hideLoader`,
`renderExtensionTemplate` (sync), `registerHelper` (no-op).

## Misc
`getRequestHeaders({ omitContentType })`, `getExtensionManifest(name)`, `ModuleWorkerWrapper`
(run-unless-busy mutex), `t`, `translate`, `getCurrentLocale`, `addLocaleData`,
`timestampToMoment`, `uuidv4`, `humanizedDateTime`, `CONNECT_API_MAP`.

## Not in getContext (import only, unstable)
`saveSettings` (immediate), `isAdmin`, `secret_state`, `isTrueBoolean`/`isFalseBoolean`,
`commonEnumProviders`, `applyLocale`, `dragElement`, `extension_prompt_types/roles`,
`createWorldInfoEntry`, `debounce` (use lodash's).

## SillyTavern.libs
`lodash, Fuse, DOMPurify, hljs, localforage, Handlebars, css (@adobe/css-tools), Bowser,
DiffMatchPatch, Readability, isProbablyReaderable, SVGInject, showdown, moment, seedrandom, Popper,
droll, morphdom, slideToggle, chalk, yaml, chevrotain, gzipSync, gzip, sha256`.
Also global: `$`/`jQuery` 3.5.1 + jQuery UI, `toastr`, `select2`. Prefer `SillyTavern.libs.X` over
window globals (not all libs are on `window`; lodash is not).

## Calling ST's server
```js
const { getRequestHeaders } = SillyTavern.getContext();
const res = await fetch('/api/...', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify(payload) });
if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
```
- Every non-GET request needs the `X-CSRF-Token` header that `getRequestHeaders()` adds
  (`$.ajax` gets it automatically, `fetch` does not). `FormData`: `getRequestHeaders({ omitContentType: true })`.
- Prefer the JS helpers above over raw endpoints; endpoints are internal and change.
- ST sets no CSP, but cross-origin `fetch` still needs the remote server's CORS headers. ST's
  `/proxy/` CORS proxy is off by default (`enableCorsProxy`) - do not depend on it in a public extension.
