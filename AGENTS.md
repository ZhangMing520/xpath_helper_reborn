# AGENTS.md

Guidance for AI agents (and humans) working on **XPath Helper Reborn**, a
Manifest V3 Chrome extension.

## What this project is

A fork of the classic Chrome extension *XPath Helper*, used to write, edit, and
evaluate XPath queries against the live page. Press **Ctrl+Shift+X** (or click
the toolbar button) to toggle the bar; hold **Shift** while hovering an element
to inspect it.

- License: Apache 2.0 (see `LICENSE`).
- Original code: https://code.google.com/p/xpaf/

## Tech stack & conventions

- Plain JavaScript (no build step, no transpiler, no bundler, no npm deps).
- Manifest V3: `manifest_version: 3`, background runs as a **service worker**.
- All files are loaded directly by Chrome — no compilation or packaging step is
  required to test locally.

## File layout

| File | Responsibility |
|------|----------------|
| `manifest.json` | Extension config. `name`/`description`/`action.default_title`/`commands` use `__MSG_*` placeholders; resolved at load time from `_locales`. |
| `content.js` | Runs in the host page. Owns `xh` namespace, XPath evaluation (`xh.evaluateQuery`), hover inspection, and the bar iframe. |
| `bar.html` / `bar.js` / `bar.css` | The floating bar UI, loaded in an extension iframe. |
| `content.css` | Injected styles for the host page (hover highlight, iframe container). |
| `background.js` | Service worker. Relays messages between `content.js` and `bar.js` (they cannot talk directly across the iframe boundary), and handles the toolbar click + `toggle-bar` command. |
| `static/icon*.png` | Extension icons (16/19/32/38/48/128). |
| `_locales/{en,zh}/messages.json` | Internationalized strings. |

## Internationalization (IMPORTANT)

The extension ships **English (`en`)** and **Simplified Chinese (`zh`)**.

- Use `chrome.i18n.getMessage('key')` in JS and `__MSG_key__` placeholders in
  manifest/HTML — never hardcode user-facing text.
- **Every** new user-facing string must be added to **both**
  `_locales/en/messages.json` and `_locales/zh/messages.json`, or the missing
  key resolves to an empty string.
- **`_locale` sentinel key** (value `"en"` in en pack, `"zh"` in zh pack) is the
  source of truth for language-dependent logic (e.g. pluralization). Read it via
  `chrome.i18n.getMessage('_locale')`. Do **not** key off `chrome.i18n.getMessage('@@ui_locale')`
  — that reflects the browser UI language, which can differ from the locale pack
  Chrome actually loads.
- **Placeholders:** Chrome rejects inline `$1$` at load unless declared. Use a
  named placeholder `$count$` plus a `placeholders` block (see `moreNotShown` /
  `showingFirst` in the locale files).
- Store limits: `name` ≤ 75 chars, `description` ≤ 132 chars.
- Default locale is `en` (`"default_locale": "en"` in manifest.json). Chrome
  matches the browser language first and only falls back to `default_locale`
  when no matching `_locales` folder exists.

## Messaging model

`content.js` ↔ `bar.js` communicate only through `background.js` (which forwards
to every listening frame of the tab). Messages use `{type: '...'}`. Toggle the
bar with `{type: 'toggleBar'}`. Ignore "receiving end does not exist" errors
during navigation — the relay handler swallows them with `.catch(() => {})`.

## Local testing

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this repo directory.
3. To verify Chinese: set the browser UI language to Chinese (or, for an
   isolated check, temporarily remove `_locales/en` and set `default_locale` to
   `zh`), then reload the extension. Remember to restore both afterward.
4. Reload the extension **and** refresh the target tab after code changes — a
   stale tab will keep running old content-script JS.

## Packaging for the Chrome Web Store

```bash
git archive --format=zip HEAD > xpath-helper-reborn.zip
```

Notes for submission:
- `content_scripts.matches` is `<all_urls>`, which triggers a permission
  justification and a **privacy policy URL** requirement in the store listing.
- The Developer Dashboard fee is a one-time $5 (separate from the Google Play
  $25 fee; the two stores do **not** share a developer account).
