# ST CSS classes, theme variables, layers

Checked against SillyTavern 1.19.0. Only classes that are actually defined are listed. Most utilities
live in `public/css/st-tailwind.css` (loaded after `public/style.css`). `!` = declared `!important`.
Class names are **case-sensitive**: `justifySpaceBetween` exists, `justifyspacebetween` does not
(even a built-in gets this wrong). When unsure whether a class exists, grep `public/style.css` and
`public/css/` in the user's ST install instead of guessing.

## Contents
1. Component classes
2. Layout utilities
3. Spacing, sizing, text, visibility
4. Theme variables
5. Body classes (user settings)
6. z-index layers
7. Icons

## 1. Component classes

| Class | What it is |
|---|---|
| `inline-drawer`, `inline-drawer-toggle`, `inline-drawer-header`, `inline-drawer-icon`, `inline-drawer-content` | collapsible section (ST wires the toggle) |
| `text_pole` | themed input/select/textarea: `--black30a` bg, border, radius 5, `width:100%`, `margin:5px 0` |
| `textarea_compact` | 0.95x font, line-height 1.2 |
| `autoSetHeight` (textarea) | grows with content (`field-sizing: content`) |
| `menu_button` | themed button (BlurTint bg, border, flex-centred, `width:min-content`); hover/`.active` lighter |
| `menu_button_icon` | icon + label button (flex, gap 5, `width:fit-content`, span 0.9x) |
| `menu_button.disabled` | greyed, `pointer-events:none` |
| `menu_button toggleable` + `toggled` | toggle button with tick/cross |
| `red_button` / `redWarningBG` | destructive (crimson bg !) |
| `right_menu_button` | bare icon button, brightness up on hover |
| `checkbox_label` | flex row, gap 5, baseline - wraps checkbox + span |
| `neo-range-slider` + `neo-range-input[data-for]` | slider + synced number box (number -> slider handled by ST) |
| `range-block`, `range-block-title`, `range-block-counter` | legacy slider layout (core panels) |
| `list-group-item` | menu row (wand menu), opacity .5 -> 1 |
| `extensionsMenuExtensionButton` | 20x20 icon inside a wand-menu row |
| `mes_button` | per-message action icon |
| `interactable` | keyboard focusable + focus ring (`:focus-visible`) |
| `standoutHeader` | gradient header like the extension drawers |
| `info-block` (+ `hint` / `info` / `warning`) | callout box with coloured left border |
| `text_muted` | smaller, opacity .7 |
| `warning` | `--warning` colour, bolder |
| `toggleEnabled` | `color: var(--active)` ! |
| `has_hover_label` (+ `label`, `label_icon`) | icon that reveals a label on hover (desktop only - keep a `title`) |
| `scrollableInner`, `scrollableInnerFull` | scroll containers |
| `menu_button_default` | marks the default button in a popup |

## 2. Layout utilities

| Class | Effect |
|---|---|
| `flex-container` | `display:flex; gap:5px; flex-wrap:wrap` |
| `flexFlowColumn` / `flexFlowRow` | direction |
| `flexNoGap`! , `flexGap2` / `flexGap5` / `flexGap10`, `gap0`! `gap3px`! `gap5px`! `gap10px`! `gap10h5v`! `gap10h20v`! | gaps |
| `flex0`, `flex1`...`flex4` (`flex2`!), `flexAuto`, `flexGrow`, `flexShrink`, `expander` | grow/shrink |
| `flexWrap`, `flexnowrap` / `flexNoWrap` | wrapping |
| `flexBasis100p` `flexBasis50p` `flexBasis48p` `flexBasis30p` `flexBasis25p` `flexBasis200px`, `flexWide50p` | basis |
| `alignItemsCenter` / `alignitemscenter`, `alignItemsStart` / `alignitemsstart`, `alignitemsflexstart`!, `alignItemsFlexEnd`!, `alignItemsBaseline`! | align-items |
| `alignContentCenter`, `alignContentFlexStart`, `alignSelfStart` | align-content/self |
| `justifySpaceBetween`, `justifySpaceEvenly`, `justifySpaceAround`, `spaceBetween`, `spaceEvenly`, `justifyContentSpaceAround`, `justifyContentFlexStart`, `justifyContentFlexEnd` | justify-content |
| `justifyCenter` | centre + `margin: 0 auto` |
| `justifyLeft` | start |

## 3. Spacing, sizing, text, visibility

| Class | Effect |
|---|---|
| `wide100p` / `width100p`, `wide50p`, `wide25p`, `wide30p`!, `wide50px`, `width100px`, `wideMax100px`, `maxWidth200px`, `wide10pMinFit`, `wide100pLess70px`, `wideMinContent`, `widthFitContent`, `widthNatural`!, `widthUnset`, `widthFreeExpand` | widths |
| `height100p`, `heightFitContent`, `heightMinContent`, `height32px` | heights |
| `margin0`, `margin0auto`, `margin5`, `marginLeft5`, `margin-r2`, `margin-r5`, `margin-right-10px`, `indent20p` | margins |
| `marginTop5`!, `marginTop10`!, `marginBot5`!, `marginBot10` / `margin-bot-10px`!, `marginTopBot5`! | vertical margins |
| `m-t-0`...`m-t-5`, `m-b-1`...`m-b-5` | margin in em |
| `padding0`, `padding5`, `padding10`, `paddingTopBot5`, `paddingLeftRight5`, `paddingBottom5px` | padding |
| `overflowHidden`, `overflowYAuto`, `overflowYScroll`, `overflow-hidden` (ellipsis + nowrap) | overflow |
| `textAlignCenter`, `TxtLrgBoldCenter`, `monospace`, `wordBreakAll` | text |
| `fontsize60p` / `80p` / `90p` / `120p` ! | `calc(var(--mainFontSize) * x)` |
| `opacity50p`, `opacity1`!, `grayscale`, `hoverglow` | visual |
| `inline-flex`, `inline-block`, `flex` | display |
| `displayNone` ! | `display:none` - toggle with `.toggleClass('displayNone', ...)` |
| `displayBlock` ! | `display:block` |
| `hidden` ! | `visibility:hidden` - **keeps its space** |
| `template_element` ! | `display:none` |
| `tooltip` | `cursor:help` |
| `no-border`!, `no-shadow`! | - |

Avoid for theming: `text_warning`, `text_danger`, `success`, `failure`, `redOverlayGlow` use
hard-coded colours. `highlighted` is cleared document-wide by setting search.

## 4. Theme variables (`public/style.css` `:root`; set from the user's theme in `public/scripts/power-user.js`)

| Variable | Default | Use |
|---|---|---|
| `--SmartThemeBodyColor` | rgb(220,220,210) | main text, icons |
| `--SmartThemeEmColor` | rgb(145,145,145) | italic / secondary text, placeholders |
| `--SmartThemeUnderlineColor` | - | underlines |
| `--SmartThemeQuoteColor` | rgb(225,138,36) | accent / highlight |
| `--SmartThemeBlurTintColor` | rgba(23,23,23,1) | panel, popup, menu background ("UI Background") |
| `--SmartThemeChatTintColor` | - | chat area background |
| `--SmartThemeUserMesBlurTintColor`, `--SmartThemeBotMesBlurTintColor` | - | message bubbles |
| `--SmartThemeShadowColor` | rgba(0,0,0,.5) | shadows |
| `--SmartThemeBorderColor` | rgba(0,0,0,.5) | every border |
| `--SmartThemeBlurStrength` | `calc(var(--blurStrength)*1px)` | `backdrop-filter: blur(...)` |
| `--SmartThemeCheckboxTickColor` | derived from body colour | checkbox tick |
| `--mainFontSize` | `calc(var(--fontScale)*15px)` | all font sizes: `calc(var(--mainFontSize) * k)` |
| `--mainFontFamily`, `--monoFontFamily` | Noto Sans / Noto Sans Mono | fonts |
| `--shadowWidth` | 2 | text-shadow width |
| `--sheldWidth` | 50vw | chat column width |
| `--bottomFormBlockSize`, `--topBarBlockSize` | derived | icon sizes in send form / top bar |
| `--animation-duration`, `-2x`, `-3x`, `-slow` | 125ms (0 with reduced motion) | transitions |
| `--black30a/50a/70a...`, `--white20a/30a...`, `--grey*`, `--crimson70a`, `--okGreen70a` | static | overlays, hover states |
| `--active`, `--warning`, `--golden` | static | state colours |
| `--interactable-outline-color`, `--interactable-outline-color-faint` | static | focus rings |

- ST has no light/dark mode switch (`body { color-scheme: only light }`); themes are just colour
  sets, and users make light ones. Hard-coded colours break somewhere.
- The user's Custom CSS lives in `<style id="custom-style">`; your manifest CSS is appended later in
  `<head>`, so equal-specificity rules of yours win over core *and* may win over the user's tweaks.
  Keep selectors scoped and specificity low so users can still override you.
- JS animations: jQuery `fx.off` is set under reduced motion; `animation_duration` / `animation_easing`
  are exported from `public/script.js` (not in `getContext`). Prefer CSS transitions on the variable.

## 5. Body classes (reflect user settings)

`no-blur` (Fast UI: all `backdrop-filter` removed), `reduced-motion`, `noShadows`, `movingUI`,
`expandMessageActions`, `waifuMode` (visual novel mode), `documentstyle` (document chat style).
Respect them in CSS (`body.no-blur #myext_panel { ... }`) instead of reading settings in JS.
Core also has `@media (prefers-contrast: more)` rules.

## 6. z-index layers (`public/style.css`)

| Layer | z-index |
|---|---|
| `.draggable` | 29 |
| `#sheld`, `#form_sheld` | 30 |
| `.drag-grabber`, `.panelControlBar`, `.list-group` | 2000 |
| `#left-nav-panel` | 3000 |
| `#top-bar`, `#top-settings-holder` | 3005 |
| `#movingDivs > div`, `#floatingPrompt` | 4000 |
| `#shadow_popup`, `#dialogue_popup`, swipe arrows | 9999 |
| autocomplete, jQuery UI | 10000 |
| `#options`, `#extensionsMenu`, `.popup .popper-modal` | 29999 |
| `<dialog>` popups | browser top layer (above all) |

Pick from this table. Anything that must sit above a popup belongs inside the popup
(`Popup.util.getTopmostModalLayer()`), not at a giant z-index.

## 7. Icons

Font Awesome Free 6.5.2. Only `solid` and `brands` stylesheets and webfonts ship
(`public/css/fontawesome.min.css`, `solid.min.css`, `brands.min.css`, `public/webfonts/`).
Use `fa-solid fa-<name>` or `fa-brands fa-<name>`; `fa-regular` / `fa-light` have no font.
`fa-fw` for fixed width; `fa-spin` for a spinner (`fa-solid fa-spinner fa-spin`).
Icon-only controls need `title` + `data-i18n="[title]..."`.
