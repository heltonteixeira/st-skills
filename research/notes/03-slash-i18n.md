# 03 — Slash commands (STscript) and i18n for UI extensions

Source: `dev-st` = SillyTavern 1.19.0 @ 06bde93. All paths relative to `dev-st/`. `SC/` = `public/scripts/slash-commands/`.
Docs: `research/st-docs/For_Contributors/` (Writing-Extensions.md "WE", i18n.md, st-script.md).
Source wins over docs; mismatches are listed in section 9.

---------------------------------------------------------------------------------------------------
## 1. Where to get the API (third-party extension)

`SillyTavern.getContext()` exposes (public/scripts/st-context.js:165-175, 214-217, 258-277):
- `SlashCommandParser`, `SlashCommand`, `SlashCommandArgument`, `SlashCommandNamedArgument`,
  `SlashCommandEnumValue`, `ARGUMENT_TYPE`, `executeSlashCommandsWithOptions`
- deprecated: `registerSlashCommand` (st-context.js:172-173), `executeSlashCommands` (st-context.js:174-175)
- i18n: `t`, `translate`, `getCurrentLocale`, `addLocaleData` (st-context.js:214-217)
- chat/global variables: `variables.local.{get,set,del,add,inc,dec,has}`, `variables.global.{...}` (st-context.js:258-277)

NOT in getContext (need a direct ES import, less stable — WE:273 says imports "can break at any time"):
- `commonEnumProviders`, `enumIcons`, `commonEnumMatchProviders` (SC/SlashCommandCommonEnumsProvider.js:17,128,361)
- `enumTypes` (SC/SlashCommandEnumValue.js:10), `SlashCommandClosure`, `SlashCommandScope`, `SlashCommandAbortController`
- `isTrueBoolean` / `isFalseBoolean` (public/scripts/utils.js:1010,1019), `slashCommandReturnHelper` (SC/SlashCommandReturnHelper.js)
- `applyLocale` (public/scripts/i18n.js:246)
Third-party extensions live at `public/scripts/extensions/third-party/<ext>/`, so direct imports are
`'../../../utils.js'`, `'../../../slash-commands/SlashCommandCommonEnumsProvider.js'`, `'../../../i18n.js'`.
Built-ins (one level up) use `'../../…'` (e.g. extensions/caption/index.js:1,9-12).

---------------------------------------------------------------------------------------------------
## 2. Registration

### 2.1 Canonical: `SlashCommandParser.addCommandObject(SlashCommand.fromProps({...}))`
- `SlashCommand.fromProps(props)` = `Object.assign(new this(), props)` (SC/SlashCommand.js:44-47). No validation:
  typos create junk fields silently; an explicit `undefined` overwrites the class default.
- `addCommandObject(command)` (SC/SlashCommandParser.js:65-73): throws `Illegal Name` if name or any alias
  (lower-cased) starts with `/`, `#`, `:`, `parser-flag`, `breakpoint`. Then calls `addCommandObjectUnsafe`.
- `addCommandObjectUnsafe` (SC/SlashCommandParser.js:78-101):
  - duplicate name/alias -> only `console.trace('WARN: Duplicate slash command registered!')`, then
    **overwrites** (last registration wins; can clobber core commands) (:79-81, :95-100).
  - auto-detects origin from the JS stack: `isExtension` / `isThirdParty` / `source` = folder name after
    `/scripts/extensions/third-party/` (:83-93). Shown in help as "Extension / Third Party / <folder>"
    (SC/SlashCommand.js:241-257). Nothing to set manually.
  - stores in static `SlashCommandParser.commands[name]` and once per alias (:95-100).
- Lookup at parse time is exact-match, **case-sensitive**: `this.commands[cmd.name]` (SC/SlashCommandParser.js:1007-1008);
  unknown name -> `SlashCommandParserError "Unknown command"`.
- Registration takes effect immediately for any later parse (commands map is static). No unregister API in SC/SlashCommandParser.js (no delete/remove method; `delete SlashCommandParser.commands[name]` would work but is undocumented — UNVERIFIED side effects).

### 2.2 Legacy (deprecated)
- `SlashCommandParser.addCommand(command, callback, aliases, helpString='')` `@deprecated` (SC/SlashCommandParser.js:46-59).
- `registerSlashCommand` = `SlashCommandParser.addCommand.bind(...)`, `@deprecated` (public/scripts/slash-commands.js:108-111).
- Pitfall (source-reasoned, not run): calling it without `aliases` passes `aliases: undefined` through
  `fromProps` (Object.assign keeps undefined) -> `[command.name, ...command.aliases]` at SC/SlashCommandParser.js:79
  throws "not iterable". Always pass `[]` if using legacy API; better: don't use it.

### 2.3 `SlashCommand.fromProps` props (SC/SlashCommand.js:30-59)
| prop | type | default | meaning |
|---|---|---|---|
| `name` | string | — | command name without `/`. Case-sensitive. |
| `callback` | `(namedArgs, unnamed) => string\|SlashCommandClosure\|Promise<…>` | — | see §4 |
| `helpString` | string (HTML) | undefined -> 'NO DETAILS' | see §5 |
| `aliases` | string[] | `[]` | extra names, same reserved-prefix rules |
| `returns` | string | undefined -> shown as `void` | free text shown in help (e.g. `'the repeated text'` or `ARGUMENT_TYPE.STRING`); purely documentation (SC/SlashCommand.js:173-177, 399-403) |
| `namedArgumentList` | `SlashCommandNamedArgument[]` | `[]` | metadata for help/autocomplete |
| `unnamedArgumentList` | `SlashCommandArgument[]` | `[]` | metadata; also gates splitting (below) |
| `splitUnnamedArgument` | boolean | false | unnamed text split on whitespace into an **array** (quotes/`[lists]`/closures kept whole) |
| `splitUnnamedArgumentCount` | number | undefined | after N split parts, the remainder is one value (SC/SlashCommandParser.js:1108-1121) |
| `rawQuotes` | boolean | false | don't strip wrapping quotes from the unnamed arg; user can override with `raw=false` named arg (SC/SlashCommandParser.js:1021-1023) |
Internal (set by parser, don't pass): `isExtension`, `isThirdParty`, `source`, `helpCache`, `helpDetailsCache` (SC/SlashCommand.js:61-66).
- Splitting only happens if `unnamedArgumentList.length > 0` **and** `splitUnnamedArgument` (SC/SlashCommandParser.js:1023).
- No `isSecret` prop exists anywhere in public/scripts (grep: 0 hits).

### 2.4 `SlashCommandArgument.fromProps` / `SlashCommandNamedArgument.fromProps` (SC/SlashCommandArgument.js:22-132)
| prop | type | default | runtime effect |
|---|---|---|---|
| `name` (named only) | string | — | key in `namedArgs` |
| `description` | string | — | help/autocomplete text |
| `typeList` | `ARGUMENT_TYPE \| ARGUMENT_TYPE[]` | `[STRING]` | non-array is wrapped (:66). **Doc/autocomplete only — no coercion/validation** |
| `isRequired` | boolean | false | **autocomplete/help only** (SC/SlashCommandAutoCompleteNameResult.js:118,131,187); not enforced |
| `acceptsMultiple` | boolean | false | **enforced**: repeated named arg -> array (SC/SlashCommandClosure.js:509-522) |
| `defaultValue` | string\|closure | null | **display only** (SC/SlashCommand.js:321-325, 379-383); **NOT injected into args** — you must default in the callback |
| `enumList` | `(string\|SlashCommandEnumValue)[]` | `[]` | strings wrapped into `SlashCommandEnumValue` (:70-73); autocomplete/help |
| `enumProvider` | `(executor, scope) => SlashCommandEnumValue[]` | null | dynamic autocomplete, called each time; takes precedence over `enumList` (SC/SlashCommandAutoCompleteNameResult.js:107,157,176) |
| `forceEnum` | boolean | false | autocomplete shows "no match" instead of hiding (`forceMatch`, SC/SlashCommandAutoCompleteNameResult.js:119,188 -> public/scripts/autocomplete/AutoComplete.js:436). **Not enforced at runtime** |
| `aliasList` (named only) | string[] | `[]` | stored (:130) but **no consumer** found in public/scripts (grep) — named-arg aliases do not resolve |
- BOOLEAN-only `typeList` with no enums auto-gets `true/false` enum (SC/SlashCommandArgument.js:77-78).
- Positional constructors exist (used by older built-ins) — orders differ:
  `new SlashCommandArgument(description, types, isRequired, acceptsMultiple, defaultValue, enums, enumProvider, forceEnum)` (:64);
  `new SlashCommandNamedArgument(name, description, types, isRequired, acceptsMultiple, defaultValue, enums, aliases, enumProvider, forceEnum)` (:127).
  Prefer `fromProps` for readability.

### 2.5 `ARGUMENT_TYPE` (SC/SlashCommandArgument.js:10-20)
`STRING:'string'`, `NUMBER:'number'`, `RANGE:'range'`, `BOOLEAN:'bool'`, `VARIABLE_NAME:'varname'`,
`CLOSURE:'closure'`, `SUBCOMMAND:'subcommand'`, `LIST:'list'`, `DICTIONARY:'dictionary'`.
Labels only. Values still arrive as strings (or closures); `[a,b]` list syntax arrives as the raw string
`"[a,b]"` (SC/SlashCommandParser.js:1265-1274) -> `JSON.parse` yourself.

### 2.6 `SlashCommandEnumValue` (SC/SlashCommandEnumValue.js:42-75)
`new SlashCommandEnumValue(value, description=null, type='enum', typeIcon='◊', matchProvider=null, valueProvider=null, makeSelectable=false)`
- `type` (`enumTypes`, :10-40) only sets color: `enum, command, namedArgument, variable, qr, macro, number, name`; `enumTypes.getBasedOnIndex(i)`.
- `matchProvider(input)=>bool` custom match (for "any number" style entries); `valueProvider(input)=>string`
  replaces inserted value (then not selectable unless `makeSelectable`).
- `enumIcons` (SlashCommandCommonEnumsProvider.js:17-121): e.g. `default, variable, character, group, persona, qr,
  closure, macro, tag, world, preset, file, message, server, image, true, false, boolean, string, number…`,
  helpers `getStateIcon(bool)`, `getRoleIcon`, `getDataTypeIcon`, `getWiStatusIcon`.

### 2.7 `commonEnumProviders` (SC/SlashCommandCommonEnumsProvider.js:128-353)
Pitfall: some are **factories** (call them once to get the provider), some **are** providers.
- Factories `(opts) => provider`: `boolean(mode='trueFalse'|'onOff'|'onOffToggle')` (:136),
  `variables(...'global'|'local'|'scope'|'all')` (:153), `characters('all'|'character'|'group')` (:198),
  `groupMembers(groupId)` (:212), `personas({allowPersonaKey})` (:219), `tags('all'|'assigned')` (:231),
  `tagsForChar(mode)` (:243), `messages({allowIdAfter, allowVars})` (:263), `messageMedia()` (:276),
  `connectionProfiles({includeNone})` (:349).
- Direct providers: `numbersAndVariables` (:172), `messageNames` (:293), `worlds` (:307), `injects` (:314),
  `types` (:329), `messageRoles`, `backgrounds`.
- For `enumList` you need the array: `enumList: commonEnumProviders.boolean('trueFalse')()` (extensions/regex/index.js:297).
  For `enumProvider` pass the provider: `enumProvider: commonEnumProviders.messages()` (extensions/caption/index.js:792).

---------------------------------------------------------------------------------------------------
## 3. How arguments reach the callback (SC/SlashCommandClosure.js)

Call site: `this.scope.pipe = await executor.command.callback(args, value ?? '')` (SC/SlashCommandClosure.js:438).

`namedArgs` (built at :396-402, filled by `substituteNamedArguments` :481-547):
- only the named args the user actually typed + reserved keys `_scope` (SlashCommandScope), `_parserFlags`,
  `_abortController` (SlashCommandAbortController), `_debugController`, `_hasUnnamedArgument` (bool)
  (typedef SC/SlashCommand.js:9-17).
- unknown names are passed through too (no validation) (:494-498).
- values: string after macro substitution (`{{char}}`, `{{var::x}}`, `{{pipe}}`…), or a `SlashCommandClosure`
  if a `{: … :}` was passed (unless immediately-executed `{: … :}()`, then its pipe string) (:528-546).
- `acceptsMultiple` -> always an array; otherwise the last occurrence wins (:509-525).
- `\{` / `\}` unescaped (:500-505).

`unnamed` value (`substituteUnnamedArgument` :555-620):
- `''` when absent (never undefined). If the user gave no unnamed arg and the command isn't first in the
  chain, the **previous pipe** is injected (:558-562) unless the user separated with `||` (SC/SlashCommandParser.js:792-799).
- single string normally; array if `splitUnnamedArgument` (:614-617); mixed text+closure without split -> array (:586-592).
- quotes stripped unless `rawQuotes` (SC/SlashCommandParser.js:1093).

Coercion: everything is a string. Use `Number(x)`/`isNaN`, `isTrueBoolean(String(x))`. Typical guards:
`String(value ?? '').trim()` (extensions/regex/index.js:273), `isTrueBoolean(args?.quiet)` (extensions/caption/index.js:411).
`isTrueBoolean` = `['on','true','1']`, `isFalseBoolean` = `['off','false','0']`, trimmed+lower-cased (public/scripts/utils.js:1010-1021).
Neither true nor false (e.g. undefined) -> both return false: use `isFalseBoolean` when default should be ON
(e.g. `const isGuardOff = isFalseBoolean(args.guard?.toString())` public/scripts/variables.js:365).

---------------------------------------------------------------------------------------------------
## 4. Callback contract

Return: `string` (goes to the pipe) or `SlashCommandClosure`; async ok. `#lintPipe` (SC/SlashCommandClosure.js:625-633):
`undefined`/`null` -> `''` with console.warn; any other non-string -> `JSON.stringify(...)` with console.warn.
So return `''` for "void", `JSON.stringify(obj)` explicitly for objects, `String(n)` for numbers.

Errors: anything thrown is wrapped as `SlashCommandExecutionError` (with line/column) (:437-441) and stops the
whole script. From the chat input it shows a toast "Slash Command Execution Error" (public/scripts/slash-commands.js:6946-6970).
Conventions in built-ins:
- hard usage error -> `throw new Error(...)` (e.g. public/scripts/variables.js:351; slash-commands.js:4218 `throw new Error(t\`No name provided for /run command\`)`).
- soft failure -> `toastr.error/warning(...)` and `return ''` (extensions/caption/index.js:422-440; regex `!quiet && toastr.warning(...)` extensions/regex/index.js:285).

Closures received as args (canonical: `/times`, public/scripts/variables.js:350-381; `/run`, slash-commands.js:4216-4248):
```js
if (cmd instanceof SlashCommandClosure) {
    cmd.scope.setMacro('timesIndex', i);       // expose {{timesIndex}} inside closure
    const result = await cmd.execute();        // runs a copy (SC/SlashCommandClosure.js:241-254)
    if (result.isAborted || result.isBreak) break;
    return result.pipe;
}
```
`/run` additionally sets `closure.scope.parent = args._scope` and fills `closure.providedArgumentList` for named closure args (slash-commands.js:4233-4246).
`SlashCommandClosureResult` fields: `pipe, isBreak, isAborted, isQuietlyAborted, abortReason, isError, errorMessage, interrupt` (SC/SlashCommandClosureResult.js:1-10).

Scope / variables: `args._scope.getVariable(k, index?)`, `setVariable(k, v, index?, type?)` (throws if undeclared
anywhere up the chain), `letVariable(k, v)` (throws if exists in this scope), `existsVariable(k)`, `setMacro(k, v)`
(SC/SlashCommandScope.js:42-100). Persistent chat/global vars: `getContext().variables.local|global.get/set` (st-context.js:258-277).

Abort: `args._abortController.signal.{aborted,paused,reason,isQuiet}`; `abort(reason, isQuiet)`, `pause()`, `continue()`
(SC/SlashCommandAbortController.js:3-34). The executor checks abort only **between** commands (:420-423, :450-453);
long-running callbacks should poll `args._abortController?.signal?.aborted` themselves (UNVERIFIED that any built-in extension does; recommendation).

### Calling STscript from JS
`executeSlashCommandsWithOptions(text, options)` (public/scripts/slash-commands.js:6988-7077), options typedef :6871-6880:
`handleParserErrors` (default **true** -> toast, return empty result), `handleExecutionErrors` (default **false** -> throws),
`scope`, `parserFlags`, `abortController`, `debugController`, `onProgress(done,total)`, `source`.
Returns `Promise<SlashCommandClosureResult>`; read `.pipe`. Empty text -> `null` (:6989-6991).
Pitfall: on parser error with default options it returns a fresh result with `pipe === undefined` and `isError === false` (:7009-7030).
```js
const { executeSlashCommandsWithOptions } = SillyTavern.getContext();
try {
    const r = await executeSlashCommandsWithOptions('/echo hi | /pass {{pipe}}', { handleParserErrors: false });
    if (r?.isAborted) return;
    console.log(r?.pipe);
} catch (e) { toastr.error(e.message); }
```
Inside a command callback, pass `scope: args._scope, abortController: args._abortController` to share variables/abort
(pattern: `executeSubCommands`, public/scripts/variables.js:571-585). `executeSlashCommands(text, handleParserErrors, scope, …)` is
`@deprecated` (slash-commands.js:7067-7088). `executeSlashCommandsOnChatInput` (:6896) drives the chat-bar progress UI; not in getContext.

Return-type helper (built-ins with `return=` arg): `slashCommandReturnHelper.enumList({allowPipe, allowObject, allowChat, allowPopup, allowTextVersion})`
and `await slashCommandReturnHelper.doReturn(type, value, {objectToStringFunc})` — types `pipe|object|chat-html|chat-text|popup-html|popup-text|toast-html|toast-text|console|none`
(SC/SlashCommandReturnHelper.js:7-80). Direct import only.

---------------------------------------------------------------------------------------------------
## 5. helpString conventions

- In the autocomplete list the HTML is flattened to text (`innerHTML` then `textContent`) (SC/SlashCommand.js:187-196);
  the details panel/`/help` renders it as HTML and highlights every `pre > code` as `language-stscript` (SC/SlashCommand.js:409-415).
  Not sanitized — never interpolate user data.
- So: first `<div>` = one-line summary; then `<div><strong>Example:</strong><ul><li><pre><code class="language-stscript">/cmd …</code></pre> explanation</li></ul></div>`;
  inline names in `<code>`. Built-ins: public/scripts/variables.js:1511-1530, extensions/caption/index.js:806-819, WE:497-515.
- Localize with `t\`…\`` — 287 `helpString: t\`` / `description: t\`` uses in core (e.g. extensions/regex/index.js:267, extensions/connection-manager/index.js:1059).

### Canonical built-in examples
1. **translate** — extensions/translate/index.js:778-802: mixes positional `new SlashCommandNamedArgument(...)` with
   `fromProps`, `enumProvider` reading live `<option>`s into `SlashCommandEnumValue(value, text, enumTypes.name, enumIcons.server)`,
   async callback returning a string, `returns: ARGUMENT_TYPE.STRING`.
   ```js
   callback: async (args, value) => {
       const target = args?.target && Object.values(languageCodes).includes(String(args.target))
           ? String(args.target) : extension_settings.translate.target_language;
       const provider = args?.provider || extension_settings.translate.provider;
       return await translate(String(value), target, provider);
   },
   ```
2. **regex-preset** — extensions/regex/index.js:265-300: `t\`\`` helpString, `isTrueBoolean(args?.quiet?.toString())`,
   soft failure toast + `return ''`, BOOLEAN arg with `enumList: commonEnumProviders.boolean('trueFalse')()`.
Also: **caption** extensions/caption/index.js:780-821 (rich HTML helpString, `commonEnumProviders.messages()` enumProvider).

---------------------------------------------------------------------------------------------------
## 6. Recommended skeleton (third-party, getContext only)

```js
const { SlashCommandParser, SlashCommand, SlashCommandArgument, SlashCommandNamedArgument,
        SlashCommandEnumValue, ARGUMENT_TYPE, t } = SillyTavern.getContext();

const isTrue = (v) => ['on', 'true', '1'].includes(String(v ?? '').trim().toLowerCase()); // = utils.isTrueBoolean

SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'myext-repeat',                       // prefix with extension id to avoid collisions
    aliases: [],
    returns: t`the repeated text`,
    helpString: `<div>${t`Repeats the text.`}</div>
        <div><strong>${t`Example:`}</strong><ul><li>
        <pre><code class="language-stscript">/myext-repeat times=3 space=on bar</code></pre></li></ul></div>`,
    namedArgumentList: [
        SlashCommandNamedArgument.fromProps({ name: 'times', description: t`repetitions`,
            typeList: [ARGUMENT_TYPE.NUMBER], defaultValue: '5' }),
        SlashCommandNamedArgument.fromProps({ name: 'space', description: t`separate with spaces`,
            typeList: [ARGUMENT_TYPE.BOOLEAN], defaultValue: 'off',
            enumList: [new SlashCommandEnumValue('on'), new SlashCommandEnumValue('off')] }),
    ],
    unnamedArgumentList: [
        SlashCommandArgument.fromProps({ description: t`text`, typeList: [ARGUMENT_TYPE.STRING], isRequired: true }),
    ],
    callback: (args, value) => {
        const times = Number(args.times ?? 5);            // defaultValue is NOT applied by ST
        if (!Number.isInteger(times) || times < 0) throw new Error(t`times must be a non-negative integer`);
        return Array(times).fill(String(value)).join(isTrue(args.space) ? ' ' : '');
    },
}));
```

---------------------------------------------------------------------------------------------------
## 7. Slash-command pitfalls (checklist)
- Collisions overwrite silently (console.trace only) — prefix names (`myext-…`); check `SlashCommandParser.commands[name]` first if needed.
- Names: case-sensitive; can't start with `/ # : parser-flag breakpoint`; avoid whitespace and `|`.
- `isRequired`, `typeList`, `defaultValue`, `forceEnum`, `enumList` are not enforced; validate in the callback.
- Everything arrives as string/closure/array; never `Array(args.times)` with a string (creates 1-element array).
- `args.x.toString()` on an absent arg throws — use `args.x?.toString()` / `String(args.x ?? '')`.
- Return strings; don't return objects/undefined (auto-JSON / '' with a console warning).
- Throw to abort the script with a positioned error; toast + `return ''` for soft failures; respect a `quiet` arg.
- Unnamed arg may be the previous command's pipe; `_hasUnnamedArgument` tells you whether something was supplied.
- Register once at module load (inside `jQuery(async () => …)` or top level); re-registering on settings reload duplicates warnings.

---------------------------------------------------------------------------------------------------
## 8. i18n (public/scripts/i18n.js)

Locale selection: `localeFile = String(localStorage.language || navigator.language || 'en').toLowerCase()` (:4-6);
`getCurrentLocale()` returns it verbatim (:15) — e.g. `'de-de'`, but also possibly a bare `'de'` or an unsupported `'pt-br'`.
Core locales from `public/locales/lang.json` (lowercase `xx-yy`: ar-sa zh-cn zh-tw nl-nl de-de fr-fr is-is it-it ja-jp ko-kr pt-pt ru-ru es-es uk-ua vi-vn th-th).
No English file: English is the key/fallback. Unsupported locale -> `localeData = {}` (:118-122, :280).
Init order: `initLocales()` (public/script.js:738) runs before extensions activate, and an extension's locale file is
loaded **before** its script (`addExtensionLocale(...).finally(() => addExtensionScript…)` public/scripts/extensions.js:631-633),
so top-level `t\`\`` calls in index.js already see the extension's strings.

### 8.1 JS APIs
- `t\`Text ${a} and ${b}\`` (:81-87): key = literal with `${0}`, `${1}` placeholders; translated then placeholders refilled.
  JSON key must be exactly `"Text ${0} and ${1}"`. (undefined values are dropped from the key — :82.)
- `translate(text, key=null)` (:101-111): `localeData[key||text] || text` (empty-string translation falls back to text).
  Use for non-literal strings / explicit ids: `translate('Show Gallery')` (extensions/gallery/index.js:811).
- `addLocaleData(localeId, data)` (:22-39): ignored (console.debug) unless `localeId === getCurrentLocale()`; warns if
  core data not yet loaded; **never overrides existing keys** (core wins; first extension to define a key wins).
- `applyLocale(root=document)` (:246-261): input `Document` -> translates in place, returns undefined; input **HTML string**
  -> returns translated string. Not for `HTMLElement`/jQuery objects. No-op when `localeData` empty. Not in getContext.
- Automatic: a `MutationObserver` on `document` (childList+subtree, attribute `data-i18n`) translates any inserted
  element carrying/containing `data-i18n` (:45-61, :298-303). So HTML appended to the live DOM self-translates;
  `applyLocale` is only needed for strings you keep off-DOM.
- `renderExtensionTemplateAsync(name, templateId, data, sanitize=true, localize=true)` (public/scripts/extensions.js:137-139)
  -> `renderTemplateAsync` runs Handlebars, DOMPurify, then `applyLocale(string)` (public/scripts/templates.js:60-89).

### 8.2 `data-i18n` syntax (`translateElement`, i18n.js:153-169)
- `data-i18n="Key"` -> `element.textContent = translation` (replaces ALL children — put it on a leaf `<span>`, not on a
  button containing an `<i>` icon).
- `data-i18n="[attr]Key"` -> `setAttribute(attr, translation)`; regex `/\[(\S+)\](.+)/` so **any** attribute works
  (`[title]`, `[placeholder]`, `[aria-label]`, custom like `[no_items_text]`).
- Multiple: `;`-separated: `data-i18n="Authorize;[title]Get your token…"`.
- Keep English in the element/attribute as fallback (no translation -> untouched).
- Key gotchas: keys cannot contain `;`; a text key containing `[word]` is misparsed as an attribute key (regex is unanchored).
- Example: `<input data-i18n="[placeholder]Search" placeholder="Search">` (extensions/assets/window.html:36);
  id-style key `data-i18n="[placeholder]ext_sum_memory_placeholder"` (extensions/memory/settings.html:28).

### 8.3 Manifest `i18n` (extension-provided translations)
```json
{ "display_name": "Foo", "js": "index.js", "i18n": { "de-de": "i18n/de-de.json", "fr-fr": "i18n/fr-fr.json" } }
```
`addExtensionLocale` (public/scripts/extensions.js:848-876): only the entry whose key **exactly equals**
`getCurrentLocale()` is fetched from `/scripts/extensions/<name>/<path>` (path relative to extension dir), then
`addLocaleData(currentLocale, json)`. Fetch/parse errors are logged, never fatal. JSON = flat `{ "English key": "translation" }`.
No built-in extension uses manifest `i18n` (grep of extensions/*/manifest.json: 0) — they ship keys in core `public/locales/*.json`.
Third-party must ship their own files (or `addLocaleData` calls).

### 8.4 Recommendations for third-party extensions (WE:427-460 + source)
- Use `t` for JS strings (toasts, titles, helpStrings, arg descriptions), `data-i18n` in templates, English as keys.
- Provide translations via manifest `i18n` (preferred, loaded before your script) or `getContext().addLocaleData(locale, obj)`.
- Prefer namespaced/unique keys or full English sentences: you cannot override a key already defined by core
  (e.g. a key `"Save"` will always use core's translation) — fine if meanings match.
- Only map lowercase `xx-yy` codes from lang.json; users whose browser reports a bare `de` get no translation (core or yours) unless they pick a language in settings.
- Debug: User Settings > Debug Menu: "Get missing translations", "Track dynamic translation", "Apply locale" (i18n.js:309-331).

---------------------------------------------------------------------------------------------------
## 9. Docs vs source mismatches
1. WE:467-472 `/repeat` example is broken against source: `Array(namedArgs.times ?? 5)` with `times` a **string**
   (`'3'`) builds a 1-element array, and `namedArgs.space.toString()` throws when `space` is omitted because
   `defaultValue` is never applied (SC/SlashCommandClosure.js:481-547 never reads `defaultValue`).
2. WE implies `defaultValue`/`isRequired`/`typeList` describe behaviour; source uses them only for help/autocomplete.
3. WE example uses bare `SlashCommandParser`, `SlashCommand`, `isTrueBoolean` with no import; only the first set is
   in getContext — `isTrueBoolean` is not (st-context.js has no utils booleans).
4. i18n.md says attribute prefixes are "like `[title]` or `[placeholder]`"; source accepts any attribute name (i18n.js:156).
5. WE:439 addLocaleData "silently ignored" for other locales — source logs `console.debug` (i18n.js:29) (cosmetic).
6. Docs don't mention: duplicate-name overwrite, reserved prefixes, case sensitivity, pipe injection,
   `_scope/_abortController` reserved args, `#lintPipe` stringification, factory vs direct `commonEnumProviders`,
   named-arg `aliasList` being inert, the auto-translating MutationObserver, `textContent` clobbering children.
7. st-script.md is end-user STscript syntax; no extension-API content beyond semantics of pipes/closures/scopes (st-script.md:251-478).
