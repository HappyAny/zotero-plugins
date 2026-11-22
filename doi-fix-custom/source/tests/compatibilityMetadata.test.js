const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const build = path.join(root, "../build");
const artifact = JSON.parse(fs.readFileSync(path.join(build, "compatibility.json"), "utf8"));
const xpi = fs.readFileSync(path.join(build, "zotero-doi-fix.xpi"));

const addonID = "doi-fix@zotero.org";
const xpiHash = crypto.createHash("sha256").update(xpi).digest("hex");

assert.strictEqual(manifest.version, "1.2.1");
assert.strictEqual(manifest.applications.zotero.id, addonID);
assert.strictEqual(manifest.applications.zotero.strict_min_version, "7.0");
assert.strictEqual(manifest.applications.zotero.strict_max_version, "10.*");

assert.strictEqual(artifact.version, manifest.version);
assert.strictEqual(artifact.applications.zotero.strict_min_version, "7.0");
assert.strictEqual(artifact.applications.zotero.strict_max_version, "10.*");
assert.strictEqual(artifact.sha256, xpiHash);

console.log("PASS compatibilityMetadata");
