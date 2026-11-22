#!/usr/bin/env python3
"""Build DOI Fix and validate its archive without a local Zotero profile."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'source'

def main():
    manifest = json.loads((SOURCE / 'manifest.json').read_text(encoding='utf-8'))
    files = [SOURCE / name for name in ['LICENSE', 'manifest.json', 'bootstrap.js']]
    for name in ['chrome', 'icons', 'locale']:
        files.extend(sorted(p for p in (SOURCE / name).rglob('*') if p.is_file()))
    output = ROOT / 'build/zotero-doi-fix.xpi'
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            entry = zipfile.ZipInfo(path.relative_to(SOURCE).as_posix(), (2026, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, path.read_bytes())
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        assert len(archive.namelist()) == len(files)
        for path in files:
            assert archive.read(path.relative_to(SOURCE).as_posix()) == path.read_bytes()
    record = {'artifact': output.name, 'version': manifest['version'],
              'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
              'applications': manifest['applications'], 'files': len(files)}
    (output.parent / 'compatibility.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(record))

if __name__ == '__main__':
    main()
