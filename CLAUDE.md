# CLAUDE.md — st-skills

Claude Code skills for building SillyTavern (ST) extensions, shipped as the `st-extensions` plugin
in a local marketplace (`st-skills`). Personal use; enabled per project, never user-wide.

## Layout
- `.claude-plugin/marketplace.json`: the marketplace (one plugin).
- `plugins/st-extensions/skills/st-extension-dev/`: extension structure, manifest, APIs, events,
  settings, slash commands, i18n, LLM calls, tool calling; `references/server-plugins.md` for the Node side.
- `plugins/st-extensions/skills/st-extension-ui/`: native-looking UI (panel drawer, menus, popups,
  theme variables, mobile, accessibility).
- `research/notes/`: source research the skills were written from, with file:line citations.
- `evals/`: test prompts per skill. `workspace/` (ignored) holds eval runs.
- `dev-st/` (ignored): shallow clone of ST `release`, used as the reference source and as a
  throwaway test server on port 8300. `research/st-docs/` (ignored): clone of SillyTavern-Docs.

## Rules
- Knowledge comes only from the ST source (and the official docs, checked against the source; the
  source wins). Never from the user's own extensions in this workspace.
- Every API claim in a skill must be traceable to the source; keep the "checked against" version
  line in each SKILL.md current.
- Refresh after an ST release: re-clone `dev-st` (release) and `research/st-docs`, diff the APIs the
  skills mention, update skills and notes, bump `plugin.json` version.

## Enabling in a project
From the project folder:
```
claude plugin marketplace add E:/Development/SillyTavern/st-skills --scope project
claude plugin install st-extensions@st-skills --scope project
```
This writes the project's `.claude/settings.json`; projects outside ST never see the skills.
