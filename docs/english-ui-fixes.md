# English UI and interaction fixes

This fork updates ZotPoP to 0.58.2 and Style Custom to 0.59.53.
The base revision is `946f598324c6e7a0cec0a6d2c8c81706dbbe3317`.

## Install

1. Download both XPI files from the [release](https://github.com/HappyAny/zotero-plugins/releases/tag/english-ui-v1).
2. Open Zotero's Tools menu.
3. Select Plugins, then Install Plugin From File.
4. Install `zotpop-0.58.2.xpi` and `style-custom-0.59.53.xpi`.
5. Select English in each plugin's language setting.
6. Restart Zotero once to refresh the main menu and column labels.

Both packages keep their existing plugin IDs. They replace the installed versions.
Their update feeds point to this fork.
The upstream MIT license remains unchanged.

## Changes

- Interface and translation-language names follow the selected interface language.
- English locale variants, such as `en-US` and `en_GB`, select the English dictionary.
- Settings buttons and accessible labels translate each field name before they form a sentence.
- Attachment page counts and correction or retraction status labels use the English dictionary.
- The Paper assistant's root element honors `hidden`. Its flex layout previously kept it visible after Close.
- Zotero handles column drags and saves column widths. The plugin no longer intercepts or overwrites these events.
- The plugin retains its column fit and horizontal scroll helpers.
- A Python build command produces a validated ZotPoP package on Windows, macOS, and Linux.

Paper titles, author names, notes, annotations, and tags keep their original text.
The language setting does not translate library content.

## Verification

The tests cover the actual search handlers, English settings, workbench tabs, reader controls, and column events.
The workbench audit rejects Korean interface text without a native-language exception.
Separate tests preserve user content that contains Korean text.

A browser check reproduces the Close defect with the original stylesheet.
It then checks the corrected stylesheet in headless Chrome.
The closed panel has `display: none` and a measured width of zero.
A browser check also renders all 144 settings rows and finds zero Korean interface strings.

The Windows-compatible suites passed 863 ZotPoP tests and 2,033 Style Custom tests.
Style Custom reported 30 existing skips. No test in these suites failed.

The release includes `validation.json` and `SHA256SUMS.txt`.
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
