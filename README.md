# st-skills

[Claude Code](https://claude.com/claude-code) skills for building [SillyTavern](https://github.com/SillyTavern/SillyTavern)
extensions, packaged as the `st-extensions` plugin.

| Skill | Use it for |
|---|---|
| `st-extension-dev` | Extension structure, `manifest.json`, the `init` entry point, `getContext()` APIs, settings and chat data, events, prompt injection, generate interceptors, background LLM calls, function-calling tools, slash commands, macros, i18n, and companion server plugins. |
| `st-extension-ui` | Native-looking UI: the settings drawer, wand-menu items, per-message buttons, popups, toasts, loaders, forms, theme variables, mobile and accessibility. |

The skills are written from the SillyTavern source code (checked against **1.19.0**), with the
official docs used as a guide and verified against the source. Each skill notes where the docs and
the source disagree, and names the source file behind each rule so you can re-check it on your
own install.

## Install

The skills are meant to be enabled per project, so they load only where you build ST extensions.
From your extension project's folder:

```
claude plugin marketplace add heltonteixeira/st-skills --scope project
claude plugin install st-extensions@st-skills --scope project
```

This records the marketplace and plugin in the project's `.claude/settings.json`. To get updates:
`claude plugin marketplace update st-skills`.

## License

AGPL-3.0, the same as SillyTavern, whose source the skills quote and describe.
