#!/usr/bin/env python3
"""Build and validate a ZotPoP XPI on Windows, macOS, or Linux."""
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SKIP = {".DS_Store", "jcr-2025-data.js", "jcr-categories.json", "if-jcr-2025.json"}


def main():
    manifest_bytes = (ROOT / "manifest.json").read_bytes()
    manifest_bytes.decode("ascii")
    manifest = json.loads(manifest_bytes)
    assert manifest["version"] == json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    assert manifest["applications"]["zotero"]["update_url"].startswith("https://")
    shared = ROOT / "zotero-style-custom"
    registry = ROOT / "content/journal-registry.json"
    registry.unlink(missing_ok=True)
    if (shared / "data/journal-registry.open.json").is_file():
        shutil.copyfile(shared / "data/journal-registry.open.json", registry)
    if (shared / "src/updater.js").is_file():
        shutil.copyfile(shared / "src/updater.js", ROOT / "content/updater.js")

    files = [ROOT / name for name in ["manifest.json", "bootstrap.js", "prefs.js", "LICENSE", "LICENSES.md"]]
    for directory in ["src", "content"]:
        files.extend(p for p in sorted((ROOT / directory).rglob("*")) if p.is_file() and p.name not in SKIP)
    output = ROOT / "build" / f"zotpop-{manifest['version']}.xpi"
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for file in files:
            entry = zipfile.ZipInfo(file.relative_to(ROOT).as_posix(), date_time=(2026, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, file.read_bytes())
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        assert len(archive.namelist()) == len(files)
        assert json.loads(archive.read("manifest.json")) == manifest
        for file in files:
            assert archive.read(file.relative_to(ROOT).as_posix()) == file.read_bytes()
    receipt = {"artifact": output.name, "version": manifest["version"], "files": len(files),
               "sha256": hashlib.sha256(output.read_bytes()).hexdigest(), "bytes": output.stat().st_size}
    output.with_suffix(".json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipt))


if __name__ == "__main__":
    main()
