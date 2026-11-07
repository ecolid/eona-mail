"""Verify the fixed standalone dependency and generate the assets Mail consumes."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def build(root=ROOT, check=False):
    vendor = root/'vendor/eona-foundation'
    manifest = json.loads((vendor/'eona-foundation.release.json').read_text())
    if manifest.get('profile') != 'standalone-v1' or manifest.get('artifact') != 'eona-foundation/'+manifest['version']+'/standalone-v1':
        raise ValueError('standalone_foundation_profile_required')
    files = {name: (vendor/name).read_bytes() for name in ('eona-foundation.css','eona-foundation.js')}
    if manifest['files'] != {name: hashlib.sha256(data).hexdigest() for name,data in files.items()}:
        raise ValueError('foundation_dependency_changed')
    module = '// Generated from vendor/eona-foundation; '+manifest['artifact']+'.\n'
    for name, data in files.items():
        export = 'EONA_FOUNDATION_CSS' if name.endswith('.css') else 'EONA_FOUNDATION_JS'
        module += 'export const '+export+' = '+json.dumps(data.decode())+';\n'
    expected = {root/'src/eona-foundation-assets.js': module.encode(),
                root/'product/public/eona-foundation.css': files['eona-foundation.css']}
    changed = [str(path.relative_to(root)) for path,data in expected.items()
               if not path.is_file() or path.read_bytes() != data]
    if check and changed:
        raise ValueError('foundation_generated_assets_changed: '+', '.join(changed))
    if not check:
        for path,data in expected.items():
            path.parent.mkdir(parents=True,exist_ok=True)
            path.write_bytes(data)
    return {'artifact':manifest['artifact'],'checked':check,'changed':changed}


if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true')
    args=parser.parse_args();print(json.dumps(build(check=args.check)))
