#!/usr/bin/env python3
"""Extract browser-test inputs from a local Zotero app/omni.ja archive."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('archive', type=Path, help='Zotero app/omni.ja')
args = parser.parse_args()
out = ROOT / 'build/native-zotero'
out.mkdir(parents=True, exist_ok=True)
records = []
with zipfile.ZipFile(args.archive) as archive:
    for name in ['itemTree.js', 'virtualized-table.js', 'zotero.css']:
        matches = [p for p in archive.namelist() if p.endswith('/' + name)]
        if name == 'zotero.css':
            matches = [p for p in matches if p.startswith('chrome/skin/default/')] or matches
        if len(matches) != 1:
            raise RuntimeError(f'Expected one {name}, found {matches}')
        blob = archive.read(matches[0])
        (out / name).write_bytes(blob)
        records.append({'source': matches[0], 'file': name,
                        'sha256': hashlib.sha256(blob).hexdigest()})
(out / 'sources.json').write_text(json.dumps(records, indent=2) + '\n', encoding='utf-8')
print(json.dumps(records, indent=2))
