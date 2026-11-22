from pathlib import Path
import argparse
import hashlib
import json
import zipfile

SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parents[1]
OUT = ROOT / 'build/native-system-default'
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
(profile / 'prefs.js').write_text('\n'.join('user_pref(' + json.dumps(k) + ', ' + json.dumps(v) + ');' for k, v in prefs.items()) + '\n', encoding='utf-8')
manifest = {'manifest_version': 2, 'name': 'Disposable system-default API test', 'version': '1.0',
    'applications': {'zotero': {'id': 'system-default-native-check@local.invalid',
    'update_url': 'https://example.invalid/system-default-check.json', 'strict_min_version': '10.0', 'strict_max_version': '10.*'}}}
runtime = (ROOT / 'src/runtime.js').read_bytes()
bootstrap = (SCRIPTS / 'native-check.js').read_text(encoding='utf-8').replace(
    '__REPORT_PATH__', json.dumps(str(OUT / ('native-result' + suffix + '.json')))).replace(
    '__DATA_PATH__', json.dumps(str(data))).replace('__RUNTIME_SHA__', json.dumps(hashlib.sha256(runtime).hexdigest()))
with zipfile.ZipFile(profile / 'extensions/system-default-native-check@local.invalid.xpi', 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('manifest.json', json.dumps(manifest))
    archive.writestr('bootstrap.js', bootstrap)
    archive.writestr('runtime.js', runtime)
print(json.dumps({'profile': str(profile), 'data': str(data)}))
