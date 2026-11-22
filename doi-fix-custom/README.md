# DOI Fix custom 1.2.1

This directory contains a local fork of [pandaAIGC/zotero-doi-fix](https://github.com/pandaAIGC/zotero-doi-fix).
The upstream MIT license remains in [source/LICENSE](source/LICENSE).
[UPSTREAM.json](UPSTREAM.json) records the original commit and source hashes.
The enclosing repository tracks local changes. No nested Git repository is required.

Retrieve DOI and Update DOI also check the published metadata of a preprint.
A matching Crossref record converts the existing item to Journal Article, Conference Paper, or Book Section.
The conversion preserves item identity, attachments, annotations, notes, tags, collections, ratings, and reading data.
Extra retains the arXiv identifier and a backup of the old publication fields.
The command handles an existing published DOI. It does not add a periodic library scan.

Run these commands from the repository root with Python 3.10 and Node.js 22 or later:

```sh
python -X utf8 doi-fix-custom/scripts/build.py
node --test doi-fix-custom/source/tests/*.test.js
```

The build writes the XPI and compatibility metadata to `doi-fix-custom/build/`.
The build does not install the plugin or publish an update feed.
The plugin retains its upstream update URL. This repository does not publish a custom DOI Fix release feed.

[Publication validation](docs/publication-validation.json) records the previous 23 Node tests and 44 native API checks.
[Native results](docs/native-publication.json) include annotation preservation and transaction rollback checks.
Those checks used an isolated Zotero 10.0.8 library, recorded Crossref responses, and suppressed progress windows.
They do not establish conversion in a personal library or full GUI acceptance.

Source review added protection for edits during DOI lookup, distinct title-token scoring, and case-insensitive DOI comparison.
The updated Node suite passes 30 entries, including 26 publication tests and a core runner with 13 cases.
See the [source validation record](../docs/source-validation-2026-11-23.json) for the current build hashes and review followup.
The earlier native receipt predates these guards. The native API check was not repeated for this source revision.

Prepare a new isolated native check with:

```sh
python -X utf8 doi-fix-custom/scripts/native-publication/prepare-native.py
```

The command creates a new profile and data directory under `doi-fix-custom/build/native-publication/`.
It refuses to reuse existing test directories. `--attempt 2` creates another directory.
See [the reproduction guide](../docs/reproducing.md) before starting native Zotero tests.
