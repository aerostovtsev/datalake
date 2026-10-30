# Browser regression checks

`browser-regression.js` is an async function accepting a Playwright `page`.
It checks the origin currently open in that page, using separate browser contexts.
Run it with Playwright MCP's `browser_run_code_unsafe` and its `filename` argument
after navigating the browser to the local preview or deployed site.

For a local preview, serve the repository root with:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/`, then run `tests/browser-regression.js`.
The checks need a modern Chromium browser. They verify responsive layout,
instructions before scrolling, mobile menu, keyboard tabs, clipboard success
and denial, accessible tables and decoration, contrast, print, documentation,
animation suspension, console/network errors, and JavaScript-disabled rendering.

Clipboard writes are simulated; the system clipboard is not changed. Screenshots
are saved under `output/playwright/`. No OAuth login or data queries are executed.
