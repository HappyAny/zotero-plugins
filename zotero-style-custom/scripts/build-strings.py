# -*- coding: utf-8 -*-
"""Generate src/strings.js from the translation table."""
import json
T=json.load(open('data/strings-en.json',encoding='utf-8'))
Z=json.load(open('data/strings-zh-CN.json',encoding='utf-8'))
assert set(T)==set(Z), 'English and Chinese catalog keys must match'
import re
for key in T:
    holes=lambda text:sorted(re.findall(r'\{\d+\}',text))
    assert holes(key)==holes(Z[key]), 'Chinese placeholders differ: '+key
body=json.dumps(T, ensure_ascii=False, indent=1, sort_keys=True)
chinese=json.dumps(Z, ensure_ascii=False, indent=1, sort_keys=True)
out = '''/* English for the Korean strings this plugin is written in.

   The Korean text is the key: see i18n.js for why. A string that is not here
   still reads correctly in Korean, so this table can be filled in over time
   without any moment where the panel is broken.

   Generated; edit the table rather than this file by hand. */
(function (root) {
  'use strict';
  const en = %s;
  const zh = %s;
  const api = {en, zh};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CustomStyleStrings = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
''' % (body,chinese)
open('src/strings.js','w',encoding='utf-8').write(out)
print('src/strings.js:', len(T), 'entries per locale')
