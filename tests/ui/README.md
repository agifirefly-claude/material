# UI regression suite

Drives the editor in headless Chromium the way a person does — clicks, drags, keys — and checks the result on
`window.mmEditor` (the editor state) and in the page. It covers the parts of the UI that the engine tests cannot see.

```bash
npm run test:ui                      # every test
npm run test:ui -- links paint       # tests whose name or spec file contains "links" or "paint"
```

It starts its own Vite dev server on port 5380 (`UI_PORT` changes it) and its own browser, and needs WebGL2
(SwiftShader is fine). A run takes about 3–6 minutes depending on the machine.

| variable      | effect                                                                              |
| ------------- | ----------------------------------------------------------------------------------- |
| `UI_PORT`     | dev server port (5380)                                                              |
| `UI_WORKERS`  | tests run at the same time, each in its own browser context (2)                     |
| `UI_STOP=1`   | stop at the first failure                                                           |
| `UI_VERBOSE=1`| more output (the export test lists each download)                                    |
| `UI_CHROMIUM` | browser binary used when Playwright has none of its own (`/opt/pw-browsers/chromium`) |

A failing test prints the failed step and saves a screenshot to `tests/ui/output/<test name>.png`.

## What is covered

| spec               | covers                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `01-projects`      | Examples dialog (toolbar and File menu), project tabs (switch, close), library search / click / drag / folders, the add-node popup (right click, double click, a link dropped on empty space connects the pick), Chinese menus |
| `02-graph`         | connecting by dragging handles, an incompatible link refused, deleting a link (Delete key and its menu), deleting / copying / pasting / duplicating nodes, grouping into a subgraph, entering it (double click, hierarchy), leaving it (breadcrumb, Esc); undo and redo of each |
| `03-params`        | float drag and typed number / expression, enum, boolean, size, colour popover, gradient stops (add, drag), curve points; the node preview changes; inspector tabs (an upstream link navigates, code analysis shows GLSL), in English and Chinese |
| `04-previews`      | 2D preview gizmo drag changes the parameter, Export ▾ Image downloads a PNG; 3D preview object and environment, a material change shows in 3D |
| `05-editors`       | node editor (Ctrl+E, rename, apply, undo), Easy SDF items, paint mode (new project, a stroke, a layer, back to the material tab) |
| `06-export`        | every button of the export dialog downloads a file; zip contents are checked (Cocos `.mtl` and `.meta`, PNG maps) |
| `07-prefs`         | language switch in Preferences, docking a panel by dragging its tab (kept after a reload), autosave restored after a reload |

## Writing tests

A spec in `specs/` exports `tests`: `{ name, run({ page, context, base }), timeout? }`. Each test gets a fresh browser
context with empty storage, 1600×950. `helpers.mjs` has the shared steps: `open(page, base, { example, lang })`
(`example: "blank"` is a project with only the material node, from `fixtures/blank.json`), `addFromLibrary`, `select`,
`connect`, `drag`, `idle` (waits until the renderer has been quiet), `until` (polls a condition), `stablePixels`,
`download`, `zipNames`, and `ed(page, fn, arg)`, which runs `fn(window.mmEditor, arg)` in the page.

Wait on state, not on time: poll with `until` or `idle`. The one deliberate pause is between two edits that should be
two undo steps: the editor merges changes closer than 350 ms into one step, and a person's next action comes later.

Tests find things by what a person sees (text, roles, the panel and tab names) and by the editor's state, not by the
UI's source files, so they survive refactoring. Tests that reload set `sessionStorage["ui-test-keep"]` so the reload
keeps local storage; every other page load starts empty. Each context sets the FPS limit preference to 15 so the 3D
preview leaves CPU time to the rest under software WebGL.
