# Reproduce the builds and checks

Use a Git clone, Node.js 22 or later, and Python 3.10 or later.
The reader performance comparison uses a source commit from Git history.
The scripts do not require a personal Zotero profile, library database, API key, or licensed journal export.
`.gitattributes` uses LF to keep source text consistent across Windows and Unix checkouts.
See the [source validation record](source-validation-2026-11-23.json) for clean-checkout hashes and known test failures.

Run these commands from the repository root:

```sh
npm ci --ignore-scripts
python -X utf8 scripts/build.py
python -X utf8 zotero-style-custom/scripts/build.py
python -X utf8 doi-fix-custom/scripts/build.py
npm run test:offline
node --test zotero-style-custom/test/native-list-scroll.test.mjs zotero-style-custom/test/system-default.test.mjs zotero-style-custom/test/collection-counts.test.mjs zotero-style-custom/test/reader-tools.test.mjs zotero-style-custom/test/reader-assist.test.mjs
node --test doi-fix-custom/source/tests/*.test.js
node zotero-style-custom/scripts/verify-features.mjs
node zotero-style-custom/scripts/verify-improvements.mjs
```

`--ignore-scripts` prevents npm from executing the repository's installation hook.
The Python build scripts create archives under each plugin's `build/` directory.
The builds compare every packaged file with its source.
The DOI Fix build also writes the compatibility metadata required by its tests.
`python -X utf8 scripts/verify-repository.py` runs these builds and the main offline checks together.
It stores detailed logs under `build/verification/`. Add `--full` for the complete Style Custom suite.

For the complete Style Custom suite, run:

```sh
node --test zotero-style-custom/test/*.test.mjs
```

On Windows, nine existing Bash fake-encoder checks in `test/bake.test.mjs` fail to start `fake-afconvert`.
ZotPoP's offline suite also has 15 existing fake-executable failures in `test/pop-bridge.test.mjs` on Windows.
Both sets of failures were reproduced from commit `b2b7a43` before the current changes.
Some native or platform checks skip when their prerequisites are absent.
The historical settings verifier also has a fixed baseline switch count and an unused `annotationPreferComment` control.
These limitations are recorded in [the timer audit](../zotero-style-custom/docs/validation/timer-audit.json).
They must not be reported as passing checks.

## Browser checks

Install the optional browser once:

```sh
npx playwright install chromium
node scripts/validation/preview-fold/browser-proof.cjs
node scripts/validation/reader-listen-opt-in/browser-proof.cjs
node zotero-style-custom/scripts/benchmark-reader-refresh.cjs
```

Set `CHROME` to an existing Chromium executable to use that executable instead.
Browser checks use offline fixtures and block HTTP requests.
Their output goes to ignored build directories.
Other preserved checks are under `scripts/validation/`.
The citation-key layout and list-event checks also need local Zotero source inputs:

```sh
python -X utf8 scripts/validation/extract-zotero-tree.py "C:/Program Files/Zotero/app/omni.ja"
node scripts/validation/list-events/check-events.cjs
node scripts/validation/citation-key-layout/browser-proof.cjs
```

The extractor records source hashes under `build/native-zotero/`.
Native Zotero sources are extracted locally rather than copied into this repository.
Browser checks execute selected native methods with lightweight row models.
They do not measure native PDF rendering speed or replace full GUI checks.

## Isolated native API checks

The DOI Fix and system-default harnesses create fresh profiles and libraries under their own build directories.
Prepare them with:

```sh
python -X utf8 doi-fix-custom/scripts/native-publication/prepare-native.py
python -X utf8 zotero-style-custom/scripts/native-system-default/prepare-native.py
```

Close Zotero normally before a native run. Do not force termination or use a personal profile.
Use the profile path printed by the preparation script with Zotero's `-no-remote -profile` arguments.
On Windows, use `Start-Process -WindowStyle Hidden` and `MOZ_HEADLESS=1` for a headless `-headless` run.
Each harness writes `native-result.json`, requests normal exit, and has a 45-second failure deadline.
The publication harness uses recorded Crossref responses. The system-default harness intercepts external application launches.

## Cleanup

Preview the generated paths, then remove them:

```sh
python -X utf8 scripts/clean-generated.py
python -X utf8 scripts/clean-generated.py --apply
```

The cleaner refuses to remove tracked files or targets outside the repository.
It removes dependency directories, which `npm ci --ignore-scripts` can recreate.
It preserves source, fixtures, licenses, Git history, documentation, and validation summaries.
It does not access an installed Zotero profile or data directory.
