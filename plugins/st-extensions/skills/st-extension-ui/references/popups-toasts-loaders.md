# Popups, toasts and loaders

Checked against SillyTavern 1.19.0. Source: `public/scripts/popup.js`, `public/scripts/action-loader.js`,
toastr defaults in `public/script.js`. All are reachable from `SillyTavern.getContext()`:
`Popup`, `POPUP_TYPE`, `POPUP_RESULT`, `callGenericPopup`, `loader`. `toastr` is a global.

## Popup

### Types and results
| `POPUP_TYPE` | Buttons | `show()` resolves to |
|---|---|---|
| `TEXT` (1) | OK (Cancel only if `cancelButton` set) | `POPUP_RESULT` number |
| `CONFIRM` (2) | Yes / No | `AFFIRMATIVE` (1) / `NEGATIVE` (0) / `CANCELLED` (null) |
| `INPUT` (3) | Save / Cancel + textarea | the string on OK, `false` on No, `null` on cancel |
| `DISPLAY` (4) | none, corner close (X) | result number |
| `CROP` (5) | cropper | data URL |

`POPUP_RESULT`: `AFFIRMATIVE = 1`, `NEGATIVE = 0`, `CANCELLED = null`, `CUSTOM1..CUSTOM9 = 1001..1009`.
Compare with `===`; `NEGATIVE` is 0 and `CANCELLED` is null, both falsy.

### Constructor and helpers
```js
const popup = new Popup(content, POPUP_TYPE.TEXT, inputValue = '', options);
const result = await popup.show();

await callGenericPopup(content, type, inputValue, options);    // = new Popup(...).show()
await Popup.show.input(header, text, defaultValue, options);   // string | null
await Popup.show.confirm(header, text, options);               // POPUP_RESULT
await Popup.show.text(header, text, options);
```
- `content`: string (set as **innerHTML, not sanitized**), jQuery object or HTMLElement.
- `Popup.show.*` builds `<h3>${header}</h3>${text}` as raw HTML: escape user/model/card data.
- Close from code: `popup.completeAffirmative()`, `completeNegative()`, `completeCancelled()`.
- `Popup.util.isPopupOpen()`, `Popup.util.lastResult`, `Popup.util.getTopmostModalLayer()`
  (append floating dropdowns here, not to `body`).

### Options
| Option | Meaning |
|---|---|
| `okButton`, `cancelButton` | caption string, or `true`/`false` to force show/hide |
| `wide` | min-width = chat column width |
| `wider` | min-width 750px, max 90% |
| `large` | 90vh x 90vw |
| `transparent` | no background |
| `allowVerticalScrolling`, `allowHorizontalScrolling` | let long content scroll |
| `leftAlign` | left-align content |
| `rows`, `placeholder`, `tooltip` | INPUT textarea settings |
| `animation` | `'slow'`, `'fast'` (default), `'none'` |
| `defaultResult` | result triggered by Enter |
| `allowEscapeClose` | `false` = Escape needs double press + confirm |
| `customButtons` | `[{ text, result?, classes?, icon?: 'fa-...', tooltip?, action?, appendAtEnd? }]` - rendered as `menu_button` before OK; without `result` the button does not close the popup; plain strings get results 2, 3... |
| `customInputs` | `[{ id, label, type: 'checkbox' \| 'text' \| 'textarea' \| 'number', defaultState, tooltip, rows, min, max, step, disabled, autoFocus }]` - read after close from `popup.inputResults.get(id)` |
| `onOpen(popup)` | after open |
| `onClosing(popup)` | return falsy to cancel the close (validation) |
| `onClose(popup)` | after close, before DOM removal |
| `cropAspect`, `cropImage` | CROP type |

### Patterns
Confirm a destructive action:
```js
const confirmed = await callGenericPopup(t`Delete all entries?`, POPUP_TYPE.CONFIRM);
if (confirmed !== POPUP_RESULT.AFFIRMATIVE) return;
```
Form in a popup (built-in regex editor pattern): render a template into a jQuery element, prefill,
show, then read the still-referenced element:
```js
const $form = $(await renderExtensionTemplateAsync(`third-party/${folder}`, 'editor'));
$form.find('#myext_name').val(item.name);
const result = await callGenericPopup($form, POPUP_TYPE.CONFIRM, '', {
    okButton: t`Save`, cancelButton: t`Cancel`, allowVerticalScrolling: true,
});
if (result === POPUP_RESULT.AFFIRMATIVE) item.name = String($form.find('#myext_name').val());
```
Validation before closing:
```js
new Popup($form, POPUP_TYPE.CONFIRM, '', {
    onClosing: (p) => p.result !== POPUP_RESULT.AFFIRMATIVE || isValid($form),
}).show();
```
Inside popups, Enter on a focused button completes it, Escape cancels, focus returns to the popup
below, and toasts are moved into the top dialog so they stay visible.

Deprecated: `callPopup` (use `callGenericPopup`).

## Toasts (`toastr`)

- Defaults: top-centre (user-configurable), `timeOut: 4000`, `extendedTimeOut: 10000`, `escapeHtml: true`.
- `toastr.success|info|warning|error(message, title?, options?)` - use `t` strings.
- `{ escapeHtml: false }` only for HTML you built from trusted strings.
- Sticky: `const toast = toastr.info(msg, title, { timeOut: 0, extendedTimeOut: 0 }); ... toastr.clear(toast);`
- Repeated errors: `{ preventDuplicates: true }`.
- Toasts get `role=status` automatically.

## Loader (`getContext().loader`)

```js
const handle = loader.show({
    message: t`Indexing...`,
    title: t`My Extension`,
    toastMode: 'static',          // 'none' | 'static' | 'stoppable' (default)
    blocking: true,               // overlay blocks the UI (default)
    onStop: () => controller.abort(),
});
try { await work(); } finally { await handle.hide(); }
```
- Options: `blocking`, `toastMode`, `slug`, `message` (default "Generating..."), `title`, `stopTooltip`,
  `overlayContent`, `onStop`, `onHide`.
- **`onStop` defaults to `stopGeneration()`** - for non-generation work pass your own or use
  `toastMode: 'static'`.
- **`loader.hide()` without a handle hides every loader**, including other extensions'. Hide your handle.
- Also: `loader.active()`, `loader.get(id)`, `loader.isBlocking()`, `loader.ToastMode`.
- Deprecated: `showLoader()` / `hideLoader()`.
- For in-place progress (not blocking): add `disabled` to the trigger and swap its icon to
  `fa-solid fa-spinner fa-spin` while working.
