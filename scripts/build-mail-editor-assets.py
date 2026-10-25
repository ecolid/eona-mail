#!/usr/bin/env python3
"""Generate the fixed editor assets from the locked npm package (no CDN)."""
import argparse,hashlib,json,pathlib
p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');args=p.parse_args()
r=pathlib.Path(__file__).resolve().parents[1];package=json.loads((r/'node_modules/quill/package.json').read_text());assert package['version']=='2.0.3'
js=(r/'node_modules/quill/dist/quill.js').read_text().replace('//# sourceMappingURL=quill.js.map','');css=(r/'node_modules/quill/dist/quill.core.css').read_text()
module='// Generated from quill@2.0.3; BSD-3-Clause, see vendor/quill/LICENSE.\nexport const MAIL_EDITOR_JS='+json.dumps(js).replace('<','\\u003c')+';\nexport const MAIL_EDITOR_CSS='+json.dumps(css)+';\n'
source=json.dumps({'package':'quill','version':'2.0.3','registry':'https://registry.npmjs.org/quill','js_sha256':hashlib.sha256(js.encode()).hexdigest()},indent=2)+'\n'
expected={r/'src/mail-editor-assets.js':module,r/'vendor/quill/source.json':source,r/'vendor/quill/LICENSE':(r/'node_modules/quill/LICENSE').read_text()}
for path,value in expected.items():
 if args.check:
  if path.read_text()!=value:raise SystemExit('editor asset drift: '+str(path))
 else:path.parent.mkdir(parents=True,exist_ok=True);path.write_text(value)
print('mail editor assets verified' if args.check else 'mail editor assets generated')
