# Editor core (`editor-src/`)

The CodeMirror 6 live-preview editor that Smudge loads inside a `WKWebView`.

## Vendored build artifact

The built bundle is **committed** to `Smudge/Resources/editor/`:

```
Smudge/Resources/editor/
  index.html    hand-written shell, not generated
  editor.js     generated — do not edit
  editor.css    generated — do not edit
```

This keeps the Xcode project buildable with no Node toolchain: clone, open
`Smudge.xcodeproj`, and press ⌘R.

## Working on the editor

```bash
cd editor-src
npm ci             # first time
npm run build      # writes into ../Smudge/Resources/editor/
npm run checksum   # records the source hash
npm run typecheck
```

`npm run watch` rebuilds on save; the app picks up changes on relaunch.

**After changing anything under `src/`, run `npm run build && npm run checksum`
and commit the regenerated bundle.** The Xcode staleness guard (Phase 8)
compares `.bundle-checksum` against the current sources and emits a build
warning when they diverge.

## Constraints worth knowing

- **Single-file IIFE, no code splitting.** The bundle loads from a `file://`
  URL under a strict CSP where module scripts and chunk fetching are
  unreliable.
- **No `@codemirror/language-data`.** It resolves languages through dynamic
  imports, which Rollup inlines when producing an IIFE — that alone added over
  a megabyte. `src/languages.ts` holds a curated list instead.
- **Everything must work offline.** `connect-src` is `'none'`; no fonts,
  scripts, or styles may be fetched at runtime.
