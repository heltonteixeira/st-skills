# Slash commands (STscript)

Checked against SillyTavern 1.19.0. Source: `public/scripts/slash-commands/` (`SlashCommand.js`,
`SlashCommandParser.js`, `SlashCommandArgument.js`, `SlashCommandClosure.js`, `SlashCommandEnumValue.js`).

## Contents
1. Register
2. Command props
3. Argument props (what is enforced and what is not)
4. What the callback receives and must return
5. Closures, scope, abort
6. Calling STscript from JS
7. Help text
8. Pitfalls

## 1. Register

```js
const { SlashCommandParser, SlashCommand, SlashCommandArgument, SlashCommandNamedArgument,
        SlashCommandEnumValue, ARGUMENT_TYPE, t } = SillyTavern.getContext();

SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'myext-find',
    callback: async (args, value) => { /* ... */ return JSON.stringify(ids); },
    returns: t`ids of matching messages, as a JSON array`,
    namedArgumentList: [
        SlashCommandNamedArgument.fromProps({
            name: 'limit', description: t`maximum number of results`,
            typeList: [ARGUMENT_TYPE.NUMBER], defaultValue: '5',
        }),
    ],
    unnamedArgumentList: [
        SlashCommandArgument.fromProps({ description: t`text to search for`, typeList: [ARGUMENT_TYPE.STRING], isRequired: true }),
    ],
    helpString: `<div>${t`Finds messages containing the text.`}</div>
        <div><strong>${t`Example:`}</strong><ul><li>
        <pre><code class="language-stscript">/myext-find limit=3 dragon | /echo</code></pre></li></ul></div>`,
}));
```
- Register once, in `init`. Takes effect immediately; there is no unregister API.
- ST detects that the command comes from a third-party extension (shown in help) by itself.
- `registerSlashCommand(...)` / `SlashCommandParser.addCommand` are deprecated.

## 2. Command props (`SlashCommand.fromProps`)

| Prop | Meaning |
|---|---|
| `name` | without `/`; case-sensitive; must not start with `/ # : parser-flag breakpoint`; no spaces or `|` |
| `callback(namedArgs, unnamed)` | returns `string` (or a closure), may be async |
| `helpString` | HTML (section 7) |
| `aliases` | `string[]` extra names (always pass an array) |
| `returns` | text for help only |
| `namedArgumentList`, `unnamedArgumentList` | argument metadata |
| `splitUnnamedArgument` | split the unnamed text on whitespace into an array (quotes / lists / closures kept whole) - needs `unnamedArgumentList` non-empty |
| `splitUnnamedArgumentCount` | after N parts, the rest is one value |
| `rawQuotes` | keep surrounding quotes on the unnamed arg |

`fromProps` does no validation: a typo'd prop is silently ignored.

## 3. Argument props (`SlashCommandArgument.fromProps` / `SlashCommandNamedArgument.fromProps`)

| Prop | Enforced at runtime? |
|---|---|
| `name` (named only) | key in `namedArgs` |
| `description` | help / autocomplete |
| `typeList` (`ARGUMENT_TYPE.STRING/NUMBER/RANGE/BOOLEAN/VARIABLE_NAME/CLOSURE/SUBCOMMAND/LIST/DICTIONARY`) | **no** - label only, values stay strings |
| `isRequired` | **no** - autocomplete only; check yourself |
| `defaultValue` | **no** - shown in help, never put into `args`; default in the callback |
| `enumList` (strings or `SlashCommandEnumValue`) | **no** - autocomplete |
| `enumProvider: (executor, scope) => SlashCommandEnumValue[]` | autocomplete, called each time (dynamic lists) |
| `forceEnum` | **no** - autocomplete shows "no match" |
| `acceptsMultiple` | **yes** - repeated named arg arrives as an array |
| `aliasList` (named) | stored but **inert** - named-arg aliases do not work |

`new SlashCommandEnumValue(value, description, type, icon)`; a BOOLEAN-only arg without enums gets
`true/false` suggestions automatically. `commonEnumProviders` (characters, personas, messages,
variables, worlds, boolean...) is not on the context; import only if you accept the coupling
(`../../../slash-commands/SlashCommandCommonEnumsProvider.js`) - some entries are factories you must
call (`commonEnumProviders.boolean('trueFalse')()`), others are providers.

## 4. Callback contract

- `namedArgs`: only the args the user typed (unknown names pass through too), plus reserved
  `_scope`, `_parserFlags`, `_abortController`, `_debugController`, `_hasUnnamedArgument`.
  Values are **strings** after macro substitution, a closure if `{: ... :}` was passed, or arrays
  for `acceptsMultiple`.
- `unnamed`: `''` when absent - or **the previous command's pipe** when the command is not first in
  the chain (`/a | /b`); `_hasUnnamedArgument` says whether the user supplied one.
- Booleans: ST's convention is `on/true/1` vs `off/false/0`:
  ```js
  const isTrue = (v) => ['on', 'true', '1'].includes(String(v ?? '').trim().toLowerCase());
  const isFalse = (v) => ['off', 'false', '0'].includes(String(v ?? '').trim().toLowerCase());
  const quiet = isTrue(args.quiet);            // default off
  const includeSystem = !isFalse(args.system); // default on
  ```
- Numbers: `Number(args.n ?? 10)` then validate. Never `Array(args.n)` (a string makes a 1-element array).
- Lists `[a,b]` arrive as the raw string: `JSON.parse` in try/catch.
- Return a **string**: `''` for nothing, `String(n)` for numbers, `JSON.stringify(obj)` for objects
  (ST would convert anyway, with a console warning).
- Errors: `throw new Error(t`...`)` for usage errors (stops the script, shown as "Slash Command
  Execution Error" with position); `toastr.warning(...)` + `return ''` for soft failures; respect a
  `quiet` argument if you add one.

## 5. Closures, scope, abort

```js
if (args.each instanceof Object && typeof args.each.execute === 'function') {   // a SlashCommandClosure
    args.each.scope.setMacro('item', item);       // exposes {{item}} inside the closure
    const r = await args.each.execute();          // r.pipe, r.isAborted, r.isBreak
    if (r.isAborted || r.isBreak) break;
}
```
- Scope: `args._scope.getVariable(k)`, `setVariable(k, v)`, `letVariable(k, v)`, `setMacro(k, v)`.
  Persistent variables: `getContext().variables.local|global`.
- Abort is checked only between commands; long callbacks should poll
  `args._abortController?.signal?.aborted`.

## 6. Calling STscript from JS

```js
const { executeSlashCommandsWithOptions } = SillyTavern.getContext();
try {
    const result = await executeSlashCommandsWithOptions('/echo hi | /pass {{pipe}}', { handleParserErrors: false });
    if (!result?.isAborted) console.log(result?.pipe);
} catch (e) { toastr.error(e.message); }
```
Options: `handleParserErrors` (default true: toast and return an empty result whose `pipe` is
undefined), `handleExecutionErrors` (default false: throws), `scope`, `abortController`, `source`,
`onProgress`. Inside a command callback pass `scope: args._scope, abortController: args._abortController`.
`executeSlashCommands` is deprecated.

## 7. Help text

- `helpString` is HTML, rendered unsanitized in the help panel and flattened to text in autocomplete:
  first `<div>` = one-line summary, then examples in
  `<pre><code class="language-stscript">/cmd ...</code></pre>`, names in `<code>`. Never interpolate
  user data.
- Localize with `t` (core does this for nearly every command).

## 8. Pitfalls

- A second command with the same name **silently overwrites** the first (core ones too), with only
  a `console.trace`. Pick a distinctive name (prefixing with the extension id is the safe choice; check
  `SlashCommandParser.commands[name]` before registering a short one).
- Names are case-sensitive.
- `args.x.toString()` throws when `x` was omitted: use `String(args.x ?? '')`.
- Values are strings; defaults are yours to apply; return strings.
- Unnamed value may be an injected pipe.
- The docs' `/repeat` example is broken for these reasons - do not copy it.
