# English UI and interaction fixes

This fork provides ZotPoP 0.58.2 and Style Custom 0.59.54.
The base revision is `946f598324c6e7a0cec0a6d2c8c81706dbbe3317`.

## Install

1. Download [Style Custom 0.59.54](https://github.com/HappyAny/zotero-plugins/releases/download/english-ui-v2/style-custom-0.59.54.xpi).
2. Open Zotero's Tools menu.
3. Select Plugins, then Install Plugin From File.
4. Install `style-custom-0.59.54.xpi` over the installed Style Custom version.
5. Select English in each plugin's language setting.
6. Restart Zotero once to refresh the main menu and column labels.

Both packages keep their existing plugin IDs. They replace the installed versions.
Their update feeds point to this fork.
The upstream MIT license remains unchanged.
ZotPoP 0.58.2 remains available from the [first English UI release](https://github.com/HappyAny/zotero-plugins/releases/tag/english-ui-v1).

## Changes

- Interface and translation-language names follow the selected interface language.
- English locale variants, such as `en-US` and `en_GB`, select the English dictionary.
- Settings buttons and accessible labels translate each field name before they form a sentence.
- Attachment page counts and correction or retraction status labels use the English dictionary.
- The Paper assistant's root element honors `hidden`. Its flex layout previously kept it visible after Close.
- Main-list Thesis and Patent badges and patent-office tooltips follow the selected interface language.
- Dragging a main-list divider resizes the column on its left independently. A narrow neighbour does not limit the drag.
- Header and body cells keep the requested widths. The list scrolls horizontally when the columns exceed the viewport.
- Double-clicking a divider fits the column to its visible content. Escape or a window blur cancels an active drag.
- Zotero 10 saves the full widths through its column manager. Rebuilding the list does not subtract another 16 pixels.
- The layout and scroll listener follow table replacements. Other tables retain their native controls.
- A Python build command produces a validated ZotPoP package on Windows, macOS, and Linux.

Paper titles, author names, notes, annotations, and tags keep their original text.
The language setting does not translate library content.

## Verification

The tests cover search handlers, English settings, workbench tabs, reader controls, and main-list rendering.
The workbench audit rejects Korean interface text without a native-language exception.
Separate tests preserve user content that contains Korean text.

A browser check reproduces the Close defect with the original stylesheet.
It then checks the corrected stylesheet in headless Chrome.
The closed panel has `display: none` and a measured width of zero.
A browser check also renders all 144 settings rows and finds zero Korean interface strings.

The Windows-compatible suites passed 863 ZotPoP tests and 2,033 Style Custom tests.
Style Custom reported 30 existing skips. No test in these suites failed.
These counts describe the first English UI release.
The 0.59.54 Windows regression run passed 2,034 Style Custom tests, with 30 existing skips and no failures.

For version 0.59.54, a browser check extracts the installed Zotero 10.0.8 drag handlers, Draggable, column manager, and Windows CSS.
It executes those inputs in a headless Chrome fixture. Native source hashes appear in the result file.
The baseline reproduces both reported defects: Korean badges and a Date column that stays at 120 pixels after a 140-pixel drag.
The corrected runtime changes that column from 120 to 260 pixels. All other widths remain constant.
The check also covers five list rebuilds, spare viewport space, minimum widths, horizontal scrolling, table replacement, cancellation, and right-to-left dragging.
It measures header and body alignment and checks that a real double-click still fits the column.
The main-list renderer test covers patent offices and thesis badges while preserving item titles in their original language.

To reproduce the browser check, install Playwright and supply the local Zotero archive and browser executable:

```sh
node zotero-style-custom/scripts/check-main-list-browser.cjs --omni PATH_TO_OMNI_JA --browser PATH_TO_CHROME
```

The command writes screenshots and a JSON receipt to `build/main-list-proof`.
It requires Python to read the application archive. It does not start or control Zotero.

The release includes `validation.json`, `main-list-browser.json`, and `SHA256SUMS.txt`.
These files record test counts, exclusions, package hashes, and the browser result.
Unix executable fixtures for Publish or Perish and audio baking cannot run directly on this Windows host.
Their failures and exclusion boundaries are recorded separately.

The user's running Zotero session was not changed.
The packages were built and checked. Installation in the live profile requires the steps above.

## Build

```sh
npm ci --ignore-scripts
npm run build
cd zotero-style-custom
python -X utf8 scripts/build.py
```

The build checks ZIP integrity and compares packaged runtime files with their sources.
It includes only the openly licensed journal tables.
Licensed journal exports stay outside the packages.
