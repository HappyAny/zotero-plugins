#!/usr/bin/env python3
"""Build each plugin and run offline checks. Store detailed output under build/."""
import argparse
import glob
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--full', action='store_true', help='Also run platform-dependent Style Custom tests')
    args = parser.parse_args()
    out = ROOT / 'build/verification'
    out.mkdir(parents=True, exist_ok=True)
    jobs = [
        ('build-zotpop', [sys.executable, '-X', 'utf8', 'scripts/build.py']),
        ('build-style', [sys.executable, '-X', 'utf8', 'zotero-style-custom/scripts/build.py']),
        ('build-doi', [sys.executable, '-X', 'utf8', 'doi-fix-custom/scripts/build.py']),
        ('features', ['node', 'zotero-style-custom/scripts/verify-features.mjs']),
        ('improvements', ['node', 'zotero-style-custom/scripts/verify-improvements.mjs']),
        ('cleanup-safety', [sys.executable, '-X', 'utf8', 'scripts/test_clean_generated.py']),
    ]
    package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    # The offline command contains no shell operators or quoted paths.
    jobs.append(('zotpop-offline', package['scripts']['test:offline'].split()))
    style_files = ['native-list-scroll', 'system-default', 'collection-counts',
                   'reader-tools', 'reader-assist', 'runtime', 'settings', 'workbench']
    jobs.append(('style-regression', ['node', '--test', '--test-concurrency=1',
        *[f'zotero-style-custom/test/{name}.test.mjs' for name in style_files]]))
    jobs.append(('doi-offline', ['node', '--test', *sorted(glob.glob('doi-fix-custom/source/tests/*.test.js', root_dir=ROOT))]))
    if args.full:
        jobs.append(('style-full', ['node', '--test', '--test-concurrency=1',
            *sorted(glob.glob('zotero-style-custom/test/*.test.mjs', root_dir=ROOT))]))
    results = []
    for name, command in jobs:
        if command[0] == 'node' and '--test' in command:
            command.insert(1, '--test-reporter=tap')
        print('Running ' + name, flush=True)
        run = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
        log = run.stdout + '\n' + run.stderr
        (out / (name + '.log')).write_text(log, encoding='utf-8')
        result = {'name': name, 'exitCode': run.returncode}
        for key in ['tests', 'pass', 'fail', 'cancelled', 'skipped']:
            values = re.findall(r'^(?:# |ℹ )' + key + r' (\d+)\s*$', log, re.M)
            if values:
                result[key] = int(values[-1])
        results.append(result)
        print(json.dumps(result), flush=True)
        (out / 'results.json').write_text(json.dumps(results, indent=2) + '\n', encoding='utf-8')
    return int(any(result['exitCode'] for result in results))

if __name__ == '__main__':
    sys.exit(main())
