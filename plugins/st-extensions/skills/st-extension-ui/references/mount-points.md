# Where extension UI goes - markup and wiring

Checked against SillyTavern 1.19.0. Paths relative to the ST root.

## Contents
1. Extensions panel (settings)
2. Wand menu
3. Per-message buttons
4. Send form
5. Character panel
6. Floating panels (`#movingDivs`)
7. Places to avoid

---

## 1. Extensions panel (settings)

`public/index.html` (the `#rm_extensions_block` drawer):
```html
<div class="extensions_block flex-container">
  <div id="extensions_settings" class="flex1 wide50p"> <!-- built-in slots: #assets_container, ... --> </div>
  <div id="extensions_settings2" class="flex1 wide50p"> <!-- built-in slots: #websearch_container, ... --> </div>
</div>
```
- Built-ins have reserved slots (`#sd_container`, `#summarize_container`, ...). A third-party
  extension appends its own block to `#extensions_settings` or `#extensions_settings2`; ST does
  not balance the columns. Blocks appear roughly in extension load order (`loading_order`, then name).
- Under 1000px both columns are full width (`public/css/mobile-styles.css`).
- Inherited styling: checkboxes in `.extensions_block` get side margins; the header gradient applies
  to `.inline-drawer-toggle.inline-drawer-header` inside either column. Outside the panel, add
  `standoutHeader` to get the same header look.
- Drawer markup and wiring: see SKILL.md. Open/close from code without animation:
  `toggleDrawer(el, expand)` lives in `public/scripts/utils.js` (not in `getContext`); triggering a
  click on the `.inline-drawer-toggle` works too.
- The drawer that holds the whole panel closes on a mousedown outside `.openDrawer` (unless the target
  is inside `.popup`, `.text_pole`, the toast container, select2 results...). Floating elements you
  attach to `body` from inside the panel will close the panel when clicked: keep them inside your
  block or inside a popup.

## 2. Wand menu (`#extensionsMenu`)

- Created at startup from `public/scripts/templates/wandMenu.html`; the wand button
  (`#extensionsMenuButton`, in `#leftSendForm`) starts hidden and an interval shows it once the menu
  has a visible child.
- Canonical item (`public/scripts/extensions/attachments/manage-button.html`):
  ```html
  <div id="manageAttachments" class="list-group-item flex-container flexGap5" title="View global, character, or data files." data-i18n="[title]View global, character, or data files.">
      <div class="fa-fw fa-solid fa-book-open-reader extensionsMenuExtensionButton"></div>
      <span data-i18n="Open Data Bank">Open Data Bank</span>
  </div>
  ```
- `.extensionsMenuExtensionButton` = 20x20 centred icon with `pointer-events:none`, so the click lands
  on the row: bind the handler on the row. Rows are dimmed (opacity .5) until hover.
- Rows containing `.extensionsMenuExtensionButton` become keyboard-interactable automatically, and
  `.list-group-item` gets `role=listitem`.
- The menu closes on any outside click. If your item opens a popup, just open it; no cleanup needed.

## 3. Per-message buttons

Message template in `public/index.html` (`#message_template`):
```html
<div class="mes_buttons">
    <div title="Message Actions" class="mes_button extraMesButtonsHint fa-solid fa-ellipsis" data-i18n="[title]Message Actions"></div>
    <div class="extraMesButtons">
        <div title="Translate message" class="mes_button mes_translate fa-solid fa-language" data-i18n="[title]Translate message"></div>
        <div title="Generate Image" class="mes_button sd_message_gen fa-solid fa-paintbrush" data-i18n="[title]Generate Image"></div>
        ...
    </div>
    <div title="Edit" class="mes_button mes_edit fa-solid fa-pencil" data-i18n="[title]Edit"></div>
</div>
```
- Built-ins are hard-coded into this template and bound with delegated handlers:
  `$(document).on('click', '.mes_translate', onMessageTranslateClick)` (translate), resolving the
  message with `$(this).closest('.mes').attr('mesid')` -> `getContext().chat[id]`.
- `$('#message_template .mes')` is cloned for every message rendered afterwards, so a third-party
  extension adds its button to the template once:
  ```js
  const BUTTON = '<div title="My action" class="mes_button myext_msg_btn fa-solid fa-star" data-i18n="[title]My action"></div>';
  $('#message_template .mes_buttons .extraMesButtons').prepend(BUTTON);
  // messages rendered before init (pragmatic, not an ST convention):
  function addToRendered() {
      $('#chat .mes .extraMesButtons').each(function () {
          if (!$(this).find('.myext_msg_btn').length) $(this).prepend(BUTTON);
      });
  }
  addToRendered();
  eventSource.on(eventTypes.CHAT_CHANGED, addToRendered);
  $(document).on('click', '.myext_msg_btn', onClick);
  ```
- `.extraMesButtons` is `display:none` until the user clicks the `...` hint (or has "Expand Message
  Actions" on: `body.expandMessageActions`). `.mes_button` is dimmed (opacity .3) until hover; on
  mobile it is 1.2x larger. All `.mes_button`s are keyboard-interactable.
- Per-message render events, if you must decorate message content: `CHARACTER_MESSAGE_RENDERED`
  `(messageId, type)`, `USER_MESSAGE_RENDERED (messageId)`, `MORE_MESSAGES_LOADED`, `CHAT_CHANGED`.
  They fire for every message (and again on edits/swipes): keep handlers cheap. Never rewrite
  `.mes_text` innerHTML yourself; set `message.extra.display_text` and call `updateMessageBlock`
  (st-extension-dev covers it).

## 4. Send form

`#send_form > #nonQRFormItems > #leftSendForm | #send_textarea | #rightSendForm`.
- Direct `div` children of `#leftSendForm` / `#rightSendForm` are auto-styled as square icons of
  `--bottomFormBlockSize`, opacity .7 -> 1 on hover. Core example:
  ```html
  <div id="mes_continue" class="fa-fw fa-solid fa-arrow-right interactable displayNone" title="Continue the last message" data-i18n="[title]Continue the last message"></div>
  ```
- `#form_sheld` wraps the whole form (caption appends a hidden file input there).
- Do not inject into the Quick Reply bar (`#qr--bar`): it is destroyed and recreated on every refresh.

## 5. Character panel

- Character-list toolbar: `#rm_buttons_container`, explicitly "for additional buttons added by
  extensions". Siblings: `<div class="menu_button fa-solid fa-user-plus" title="..." data-i18n="[title]..."></div>`
  (square, `calc(var(--mainFontSize)*1.7)`).
- Character editor "More..." dropdown `#char-management-dropdown`: ST forwards any option id it does
  not handle as `eventSource.emit(eventTypes.CHARACTER_MANAGEMENT_DROPDOWN, optionId)`.
  ```js
  $('#char-management-dropdown').append('<option id="myext_export">My export</option>');
  eventSource.on(eventTypes.CHARACTER_MANAGEMENT_DROPDOWN, (id) => { if (id === 'myext_export') doExport(); });
  ```

## 6. Floating panels (`#movingDivs`)

Only for UI that must stay open beside the chat; a popup is simpler and works the same everywhere.
- Container `#movingDivs` (children `z-index: 4000`). Base class `.draggable`: themed bg/border/blur,
  `display:none`, absolute.
- Core template (`public/index.html`):
  ```html
  <template id="generic_draggable_template">
      <div class="draggable">
          <div class="dragTitle"></div>
          <div class="panelControlBar flex-container">
              <div class="fa-fw fa-solid fa-grip drag-grabber"></div>
              <div class="fa-fw fa-solid fa-circle-xmark dragClose"></div>
          </div>
      </div>
  </template>
  ```
  gallery clones it, sets a unique id, and closes with a delegated
  `$('#movingDivs').on('click', '.dragClose', ...)`.
- Dragging: `dragElement($panel)` (`public/scripts/RossAscends-mods.js`) looks for a handle with id
  `<panelId>header` and class `drag-grabber`, and persists position in `power_user.movingUIState[id]`.
  It needs `loadMovingUIState()` (`public/scripts/power-user.js`). **Neither is in `getContext()`**:
  importing them ties you to internal paths (st-extension-dev explains import depth and the risk).
  It does nothing on mobile or when the user's MovingUI is off; the grabber is only visible under `body.movingUI`.
- On mobile `#movingDivs > div` becomes a full-width sheet under the top bar.
- Animate open/close with `var(--animation-duration)` (CSS) so reduced motion is respected.

## 7. Places to avoid

- **Top bar** (`#top-settings-holder`): `.drawer-toggle` handlers are bound directly at startup, so a
  drawer you add later will not toggle; no built-in extension does this.
- **Welcome screen** (`.welcomePanel` in `#chat`): re-rendered on `CHAT_CHANGED`/`APP_READY`, no hook.
- **QR bar**: rebuilt on every refresh.
- **Setting search**: only indexes the User Settings drawer; extension settings are not searchable and
  there is no API. It also strips every `.highlighted` class in the document - do not use that class.
