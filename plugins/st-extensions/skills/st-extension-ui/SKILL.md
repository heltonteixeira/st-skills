---
name: st-extension-ui
description: Build the user interface of a SillyTavern (ST) extension so it looks and behaves like part of ST - the settings drawer in the Extensions panel, wand-menu items, per-message buttons, send-form buttons, popups and confirm dialogs, toasts, loaders, floating panels, forms, sliders and icons - using ST's own markup, CSS classes and theme variables so it follows every user theme, works on phones and is keyboard accessible. Use this whenever you write or change HTML, CSS or DOM code for a SillyTavern extension, even for "just a settings panel" or "a button", and whenever an ST extension's UI looks off, ignores the theme, breaks on mobile or its buttons stop working. Pair with st-extension-dev for the JavaScript APIs (settings persistence, events, slash commands).
---

# SillyTavern extension UI

Checked against SillyTavern 1.19.0 (`release`). File references are relative to the ST root, so you
can confirm anything in the user's install or a clone of `SillyTavern/SillyTavern`.

ST ships ~15 built-in extensions and users run dozens of third-party ones in the **same document**,
under **user themes** (any colours, light or dark, font scale 0.5-1.5x, blur on or off, reduced
motion) and on **phones**. A native-looking extension is one that reuses ST's markup and classes
instead of inventing its own, so all of that keeps working for free. The rules below follow from that.

## Core rules

1. **Reuse ST markup and classes** (`inline-drawer`, `menu_button`, `text_pole`, `checkbox_label`,
   `flex-container`, ...). ST wires behaviour (drawer toggling, keyboard focus, ARIA roles) to these
   classes, so copying the markup gets you the behaviour too. Class names are case-sensitive.
2. **Never hard-code colours, font sizes or durations.** Use `var(--SmartTheme*)` colours,
   `calc(var(--mainFontSize) * k)` or `em` sizes, and `var(--animation-duration)` transitions.
   There is no light/dark switch in ST: "light mode" is just a theme with light colours, so any
   `#fff` / `#000` / `rgba(...)` you write will be wrong for somebody.
3. **Prefix every id, class, `name=` group and CSS selector** with your extension's id
   (`myext_...`). Your manifest CSS is loaded after core CSS, unscoped, into a shared document.
4. **Bind events in JS, delegated for anything re-rendered.** Templates are sanitized with
   DOMPurify, which strips `<script>` and inline `on*=` handlers.
5. **Use ST's dialogs and feedback**: `Popup` / `callGenericPopup`, `toastr`, `loader` - never
   `alert`/`confirm`/`prompt` or a home-made modal.
6. **No essential action behind `:hover`.** Touch devices have no hover.

## Where UI goes

| Place | Mount point | Notes |
|---|---|---|
| Settings | append to `#extensions_settings` (left) or `#extensions_settings2` (right) | ST does not choose; the docs' example uses `#extensions_settings2`. Both become full width under 1000px. |
| Wand menu (the magic-wand button left of the chat input) | append a `.list-group-item` to `#extensionsMenu` | The wand button appears automatically once the menu has a visible item. |
| Per-message buttons | add to `#message_template .mes_buttons .extraMesButtons` once | Newly rendered messages clone the template; see below for messages already on screen. |
| Send-form buttons | direct `div` child of `#leftSendForm` / `#rightSendForm` | Auto-sized to `--bottomFormBlockSize`; use `fa-solid` + `interactable`. |
| Character list toolbar | `#rm_buttons_container` | "Container for additional buttons added by extensions" (`public/index.html`). |
| Character "More..." dropdown | `<option id="myext_action">` in `#char-management-dropdown` | ST emits `CHARACTER_MANAGEMENT_DROPDOWN` with the option id. |
| Floating panel | `#movingDivs` | See `references/mount-points.md`. |
| Top bar | avoid | No built-in extension adds a top-bar drawer, and `.drawer-toggle` handlers are bound directly, so a drawer added later does not toggle. |
| Quick Reply bar, welcome screen | avoid | Both are rebuilt by ST and have no extension hook. |

Details, verbatim markup for each and the floating-panel recipe: `references/mount-points.md`.

### Settings drawer (the one almost every extension needs)

```html
<!-- settings.html, rendered with renderExtensionTemplateAsync('third-party/<folder>', 'settings') -->
<div class="myext_settings">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b data-i18n="My Extension">My Extension</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <label class="checkbox_label" for="myext_enabled">
                <input id="myext_enabled" type="checkbox" />
                <span data-i18n="Enabled">Enabled</span>
            </label>
            <label for="myext_mode" data-i18n="Mode">Mode</label>
            <select id="myext_mode" class="text_pole">
                <option value="a" data-i18n="Option A">Option A</option>
            </select>
            <label for="myext_template" data-i18n="Prompt template">Prompt template</label>
            <textarea id="myext_template" class="text_pole textarea_compact" rows="4"></textarea>
            <div class="flex-container">
                <div id="myext_run" class="menu_button menu_button_icon" title="Run now" data-i18n="[title]Run now">
                    <i class="fa-solid fa-play"></i>
                    <span data-i18n="Run">Run</span>
                </div>
            </div>
        </div>
    </div>
</div>
```

Why it is exactly this shape (`public/scripts/extensions/caption/settings.html`, wiring in `public/script.js`):
- ST's own delegated handler toggles any `.inline-drawer-toggle` - do **not** add your own click
  handler. The header needs both `inline-drawer-toggle` and `inline-drawer-header` (the header gets
  the Extensions-panel gradient), and the icon must be a direct child of the header.
- `.inline-drawer-content` starts collapsed (`display:none`). That is the convention; leave it.
- React to open/close with `$(drawer).on('inline-drawer-toggle', ...)` if you need to lazy-load.

```js
const html = await renderExtensionTemplateAsync(`third-party/${folder}`, 'settings');
$('#extensions_settings2').append(html);
$('#myext_enabled').prop('checked', settings.enabled).on('input', function () {
    settings.enabled = $(this).prop('checked');
    saveSettingsDebounced();
});
```
(Where `folder`, `settings` and `saveSettingsDebounced` come from is covered by st-extension-dev.)

## Controls

- **Buttons are `<div class="menu_button">`**, not `<button>`: ST's a11y/keyboard observers give
  them `role=button`, `tabindex=0` and Enter activation. Icon + text: add `menu_button_icon` with an
  `<i class="fa-solid fa-...">` and a `<span>`. Disable with the `disabled` class. Destructive:
  add `red_button`. Toggle-looking button: `menu_button toggleable` + `toggled`.
- **Text inputs, selects, textareas**: class `text_pole` (themed, full width). `textarea_compact`
  for denser text; `autoSetHeight` makes a textarea grow with content.
- **Checkbox**: `<label class="checkbox_label"><input type="checkbox"><span>...</span></label>`.
  ST restyles all checkboxes; there is no switch widget, so do not build one.
- **Slider with number box** (ST syncs number -> slider for you; you sync slider -> number):
  ```html
  <div class="flex-container flexFlowColumn alignitemscenter flexGrow flexShrink gap0 flexBasis48p">
      <small data-i18n="Max items">Max items</small>
      <input class="neo-range-slider" type="range" id="myext_max_items" min="1" max="50" step="1" value="20">
      <input class="neo-range-input" type="number" id="myext_max_items_value" data-for="myext_max_items" min="1" max="50" step="1" value="20">
  </div>
  ```
  ```js
  $('#myext_max_items').on('input', function () {
      settings.maxItems = Number(this.value);
      $('#myext_max_items_value').val(this.value);
      saveSettingsDebounced();
  });
  ```
  ST's handler on `.neo-range-input` validates min/max and triggers `input` on the `data-for` slider.
- **Info tooltip**: `<div class="fa-solid fa-circle-info opacity50p" title="..." data-i18n="[title]..."></div>`.
- **Layout**: `flex-container` (flex, wrap, 5px gap), `flexFlowColumn`, `flex1`, `alignItemsCenter`,
  `justifySpaceBetween`, `wide100p`, `marginTop10`... The full cheat-sheet of classes that really
  exist (and the lookalikes that do not) is in `references/classes-and-theme.md` - check there
  rather than guessing a Tailwind-like name.
- **Hiding**: `displayNone` (`display:none !important`). Toggle it with `.toggleClass('displayNone', !show)`;
  jQuery `.show()` cannot beat `!important`. `hidden` is `visibility:hidden` and keeps the space.
- **Icons**: Font Awesome Free 6.5.2, **solid and brands only** (`fa-solid`, `fa-brands`). `fa-regular`
  has no font loaded. Add `fa-fw` for fixed width.
- **select2** is available globally (`$.fn.select2`), but core only enables it on desktop
  (`if (!isMobile())`). Do the same, or just use a plain `select.text_pole`.

## Theming

Use these instead of colours (full table with defaults in `references/classes-and-theme.md`):

| Purpose | Variable |
|---|---|
| Text, icons | `--SmartThemeBodyColor` |
| Secondary / muted text | `--SmartThemeEmColor` |
| Accent, highlight | `--SmartThemeQuoteColor` |
| Panel / popup / menu background | `--SmartThemeBlurTintColor` |
| Borders | `--SmartThemeBorderColor` |
| Shadows | `--SmartThemeShadowColor` |
| Blur | `backdrop-filter: blur(var(--SmartThemeBlurStrength))` |
| Font size | `calc(var(--mainFontSize) * 0.9)` |
| Transitions | `var(--animation-duration)` (`-2x`, `-3x`) - 0ms under reduced motion |
| States | `--active`, `--warning`, `--golden`; overlays `--black30a`, `--white20a`... |

Standard panel look (what `.draggable` uses):
```css
#myext_panel {
    background-color: var(--SmartThemeBlurTintColor);
    color: var(--SmartThemeBodyColor);
    border: 1px solid var(--SmartThemeBorderColor);
    border-radius: 10px;
    backdrop-filter: blur(var(--SmartThemeBlurStrength));
}
```
Body classes you can respect instead of re-detecting settings: `body.no-blur`, `body.reduced-motion`,
`body.movingUI`, `body.expandMessageActions`, `body.noShadows`.

CSS hygiene: scope every rule under your own class/id; never style bare `select`, `input`,
`.menu_button`, `.mes` or `.drawer-content`; avoid `!important` (it stops users' Custom CSS from
overriding you); pick z-index values from the table in `references/classes-and-theme.md` instead of
`999999`.

## Popups, toasts, loaders

All from `SillyTavern.getContext()`: `Popup`, `POPUP_TYPE`, `POPUP_RESULT`, `callGenericPopup`, `loader`.
Quick forms (full option list in `references/popups-toasts-loaders.md`):

```js
const { Popup, POPUP_TYPE, POPUP_RESULT, callGenericPopup, t } = SillyTavern.getContext();

// Confirm before something destructive
const result = await callGenericPopup(t`Reset all settings to defaults?`, POPUP_TYPE.CONFIRM);
if (result !== POPUP_RESULT.AFFIRMATIVE) return;

// Ask for text (string on OK, null on cancel)
const name = await Popup.show.input(t`Rename`, t`New name:`, oldName);

// Show content; `wide` / `wider` / `large` for bigger dialogs
const $content = $(await renderExtensionTemplateAsync(`third-party/${folder}`, 'window'));
await callGenericPopup($content, POPUP_TYPE.TEXT, '', { wide: true, allowVerticalScrolling: true });

// Form-in-popup: keep a reference to the jQuery element and read it after the popup closes
```

- Popup content, `Popup.show.*` header/text and `toastr` with `escapeHtml:false` are inserted as
  **raw HTML**. Escape or `DOMPurify.sanitize` anything that came from the user, a character card
  or a model; or pass a jQuery element built with `.text()`.
- Toasts: `toastr.success|info|warning|error(message, title?)` with `t` strings. Sticky:
  `{ timeOut: 0, extendedTimeOut: 0 }` and keep the handle for `toastr.clear(handle)`.
  Repeated errors: `{ preventDuplicates: true }`.
- Long work: `const handle = loader.show({ message: t`Working...`, toastMode: 'static' }); try { ... } finally { await handle.hide(); }`.
  Without your own `onStop`, the loader's Stop button calls `stopGeneration()`; `loader.hide()` with no
  argument hides **every** loader, so always hide your own handle.
- Floating dropdowns inside a popup go into `Popup.util.getTopmostModalLayer()`, not `body`.
- Deprecated, do not use: `callPopup`, `showLoader`/`hideLoader`, sync `renderExtensionTemplate`.

## Per-message buttons

```js
$('#message_template .mes_buttons .extraMesButtons').prepend(
    '<div title="Pin message" class="mes_button myext_msg_btn fa-solid fa-thumbtack" data-i18n="[title]Pin message"></div>');
$(document).on('click', '.myext_msg_btn', async function () {
    const messageId = Number($(this).closest('.mes').attr('mesid'));
    const message = SillyTavern.getContext().chat[messageId];
    // ...
});
```
- Add to the template **once** at init and bind **one** delegated handler; never bind per message.
- Messages already rendered before your init do not have the button: also append it to existing
  `#chat .mes .extraMesButtons` that lack it (on init and `CHAT_CHANGED`) - a pragmatic pattern, not
  an ST-documented one.
- `.extraMesButtons` is hidden behind the `...` button (click-to-reveal, works on touch) unless the
  user enabled "Expand Message Actions". That is the native place; do not force your button visible.

## Wand-menu item

```js
const item = $(`
<div id="myext_menu_item" class="list-group-item flex-container flexGap5 interactable" title="Open My Extension" data-i18n="[title]Open My Extension">
    <div class="fa-fw fa-solid fa-star extensionsMenuExtensionButton"></div>
    <span data-i18n="My Extension">My Extension</span>
</div>`);
$('#extensionsMenu').append(item);
item.on('click', openMyPanel);
```
The icon class `extensionsMenuExtensionButton` is required: it sizes the icon, passes clicks to the
row and makes the row keyboard-interactable. ST closes the menu on the next outside click.

## Mobile

- `getContext().isMobile()` is user-agent based (phones and tablets), not width based; CSS
  breakpoints in core are `max-width: 1000px` (main) and `450px`.
- On mobile ST hides drag grabbers, `dragElement` does nothing and `#movingDivs` panels become
  full-width sheets. Popups are the safest cross-device container.
- Tap targets at least `--bottomFormBlockSize`; prefer `dvh`/`dvw` with `vh` fallbacks.

## Accessibility

- `.menu_button`, `.right_menu_button`, `.mes_button`, `.list-group-item`, `.interactable` get roles,
  `tabindex` and Enter-to-click automatically. For any other clickable `div`, add `interactable`.
- Icon-only controls need `title` plus `data-i18n="[title]..."`.
- Keep `data-i18n` on a leaf `<span>`: a plain `data-i18n="Key"` replaces all children's content
  (it would delete an icon next to the text). `data-i18n="[attr]Key"` sets an attribute instead;
  several are separated by `;`.

## Before you finish - checklist

- [ ] Settings use the exact `inline-drawer` markup, appended to `#extensions_settings(2)`; no own toggle handler.
- [ ] No hard-coded colours, px font sizes or ms durations; every colour is a `--SmartTheme*` / ST variable.
- [ ] Every id/class/selector is prefixed; CSS rules are scoped; no `!important` unless overriding a core `!important`.
- [ ] Only classes that exist (check `references/classes-and-theme.md`); only `fa-solid` / `fa-brands` icons.
- [ ] Dialogs via `Popup`/`callGenericPopup`, feedback via `toastr`, long work via `loader` with your own handle.
- [ ] Untrusted text escaped or sanitized before it goes into popup HTML or `{{{ }}}`.
- [ ] Handlers bound in JS; delegated for per-message/re-rendered elements; nothing essential on hover.
- [ ] User-visible strings localizable: `data-i18n` in HTML, `t\`...\`` in JS.

## Reference files

- `references/mount-points.md` - verbatim markup and wiring for each place UI can go, floating panels (`#movingDivs`, `dragElement`), send form, character panel.
- `references/classes-and-theme.md` - every utility class that exists, theme variables with defaults, z-index layers, body classes.
- `references/popups-toasts-loaders.md` - complete `Popup` options, results, custom buttons/inputs, toastr and loader API.
