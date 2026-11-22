from pathlib import Path
import json
import argparse
import hashlib
import zipfile

SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parents[1] / 'source'
OUT = ROOT.parent / 'build/native-publication'
OUT.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument('--attempt', type=int, default=1)
attempt = parser.parse_args().attempt
assert 1 <= attempt <= 5
suffix = '' if attempt == 1 else '-' + str(attempt)
profile, data = OUT / ('native-profile' + suffix), OUT / ('native-data' + suffix)
assert not profile.exists() and not data.exists(), 'Disposable test already exists'
(profile / 'extensions').mkdir(parents=True)
data.mkdir()
prefs = {
    'extensions.zotero.useDataDir': True, 'extensions.zotero.dataDir': str(data),
    'extensions.zotero.sync.autoSync': False, 'extensions.zotero.automaticScraperUpdates': False,
    'extensions.zotero.streaming.enabled': False, 'extensions.zotero.httpServer.enabled': False,
    'extensions.zotero.firstRun': False, 'extensions.zotero.reportTranslationFailure': False,
    'extensions.zoteroWinWordIntegration.skipInstallation': True,
    'extensions.zoteroOpenOfficeIntegration.skipInstallation': True,
    'extensions.autoDisableScopes': 0, 'extensions.enabledScopes': 15,
    'extensions.startupScanScopes': 15, 'extensions.sideloadScopes': 15,
    'extensions.update.enabled': False, 'app.update.enabled': False, 'app.update.auto': False,
    'toolkit.telemetry.enabled': False, 'datareporting.healthreport.uploadEnabled': False,
}
(profile / 'prefs.js').write_text('\n'.join('user_pref(' + json.dumps(k) + ', '
    + json.dumps(v) + ');' for k, v in prefs.items()) + '\n', encoding='utf-8')
manifest = {'manifest_version': 2, 'name': 'Disposable DOI publication API test', 'version': '1.0',
    'applications': {'zotero': {'id': 'doi-published-native-check@local.invalid',
    'update_url': 'https://example.invalid/doi-native-check.json',
    'strict_min_version': '10.0', 'strict_max_version': '10.*'}}}
bootstrap = (SCRIPTS / 'native-check.js').read_text(encoding='utf-8').replace(
    '__REPORT_PATH__', json.dumps(str(OUT / ('native-result' + suffix + '.json')))).replace(
    '__DATA_PATH__', json.dumps(str(data))).replace('__MANAGER_SHA__', json.dumps(
        hashlib.sha256((ROOT / 'chrome/content/doiManager.js').read_bytes()).hexdigest()))
with zipfile.ZipFile(profile / 'extensions/doi-published-native-check@local.invalid.xpi', 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('manifest.json', json.dumps(manifest))
    z.writestr('bootstrap.js', bootstrap)
    z.writestr('doiManager.js', (ROOT / 'chrome/content/doiManager.js').read_bytes())
    z.writestr('record.json', (ROOT / 'tests/fixtures/crossref-jwmx-j2pg.json').read_bytes())
    z.writestr('chapter.json', (ROOT / 'tests/fixtures/crossref-book-chapter.json').read_bytes())
print(json.dumps({'profile': str(profile), 'data': str(data)}))
