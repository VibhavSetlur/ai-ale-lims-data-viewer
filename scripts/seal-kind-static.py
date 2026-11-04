#!/usr/bin/env python3
"""Seal a local export without bundling data in the Python distribution."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ai_ale_kind_static.bundle import BundleError, SEAL_NAME, SCHEMA, digest_stream, normalize_prefix, validate_bundle


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--root-path', required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--viewer-version', required=True)
    parser.add_argument('--label', default='static-dev-local-export')
    parser.add_argument('--allow-local-lims', action='store_true', help='explicitly seal real data for local verification, not redistribution')
    args = parser.parse_args()
    root = args.bundle.resolve()
    seal_path = root / SEAL_NAME
    try:
        prefix = normalize_prefix(args.root_path)
        if seal_path.exists():
            raise BundleError('seal already exists; preserve it or explicitly remove it before resealing')
        manifest = json.loads((root / 'data/manifest.json').read_text())
        snapshot_hash = manifest.get('snapshot', {}).get('sha256')
        if not args.allow_local_lims:
            raise BundleError('real viewer exports require --allow-local-lims; this does not authorize redistribution')
        files = {}
        for path in sorted(root.rglob('*')):
            if path.is_symlink():
                raise BundleError(f'export contains a symlink: {path.relative_to(root)}')
            if path.is_file():
                with path.open('rb') as stream:
                    files[path.relative_to(root).as_posix()] = {'size': path.stat().st_size, 'sha256': digest_stream(stream)}
        seal = {'schema': SCHEMA, 'viewer_version': args.viewer_version, 'source': {'commit': args.commit, 'label': args.label}, 'compiled_prefix': prefix, 'mode': 'static', 'channel': 'kind-local', 'data': {'id': f'lims-{snapshot_hash}', 'manifest': 'data/manifest.json', 'manifest_sha256': files['data/manifest.json']['sha256']}, 'files': files}
        seal_path.write_text(json.dumps(seal, indent=2) + '\n')
        try:
            validated = validate_bundle(root, prefix)
        except BaseException:
            seal_path.unlink()
            raise
        print(json.dumps({'status': 'sealed-local-only', 'files': len(validated.files), 'identity': validated.identity}, indent=2))
    except (BundleError, OSError, ValueError, KeyError) as exc:
        print(f'error: {exc}', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
