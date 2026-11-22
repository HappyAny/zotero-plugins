#!/usr/bin/env python3
"""List generated files. Use --apply to remove only the listed workspace paths."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
GENERATED = [
    'build', 'zotero-style-custom/build', 'doi-fix-custom/build',
    'doi-fix-custom/evidence',
    'node_modules', 'zotero-style-custom/node_modules',
    'content/journal-registry.json',
    'zotero-style-custom/data/if-catalog.open.json',
    'doi-fix-custom/source/zotero-doi-fix.xpi',
]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    tracked = subprocess.run(['git', 'ls-files', '-z'], cwd=ROOT, check=True,
                             capture_output=True).stdout.decode('utf-8').split('\0')
    paths = [ROOT / name for name in GENERATED]
    paths.extend(p for p in ROOT.rglob('__pycache__') if '.git' not in p.parts)
    targets = []
    for path in paths:
        if not path.exists() and not path.is_symlink():
            continue
        relative = path.relative_to(ROOT).as_posix()
        if any(name == relative or name.startswith(relative + '/') for name in tracked):
            raise RuntimeError('Refusing to remove tracked content: ' + relative)
        link = path.is_symlink() or getattr(path, 'is_junction', lambda: False)()
        # Unlink junctions themselves. Never traverse their targets.
        if not link and (path.resolve() == ROOT or not path.resolve().is_relative_to(ROOT)):
            raise RuntimeError('Target leaves the workspace: ' + relative)
        if any(path == parent or path.is_relative_to(parent) for parent, _ in targets):
            continue
        targets.append((path, link))
    records = []
    for path, link in targets:
        files = [] if link else ([path] if path.is_file() else [p for p in path.rglob('*') if p.is_file() and not p.is_symlink()])
        records.append({'path': path.relative_to(ROOT).as_posix(), 'files': len(files),
                        'bytes': sum(p.stat().st_size for p in files), 'linkOnly': link})
    print(json.dumps({'apply': args.apply, 'targets': records}, indent=2))
    if args.apply:
        for path, link in targets:
            if path.is_symlink() or path.is_file():
                path.unlink()
            elif link:
                os.rmdir(path)
            else:
                shutil.rmtree(path)

if __name__ == '__main__':
    main()
