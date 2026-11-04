import hashlib
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest


class PrepareHttpvfsTests(unittest.TestCase):
    def test_repages_local_output_without_changing_source(self):
        script = Path('scripts/prepare-httpvfs-db.sh').resolve()
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'scripts').mkdir()
            (root / 'scripts/prepare-httpvfs-db.sh').write_bytes(script.read_bytes())
            workers = root / 'node_modules/sql.js-httpvfs/dist'
            workers.mkdir(parents=True)
            for name in ['sqlite.worker.js', 'sql-wasm.wasm']:
                (workers / name).write_bytes(b'synthetic')
            source = root / 'source.db'
            with sqlite3.connect(source) as db:
                db.execute('create table example (id integer)')
                db.execute('insert into example values (42)')
            before = (source.stat().st_mtime_ns, hashlib.sha256(source.read_bytes()).hexdigest())
            import os
            result = subprocess.run(['bash', str(root / 'scripts/prepare-httpvfs-db.sh')], env={**os.environ, 'SRC': str(source), 'PAGE_SIZE': '65536'}, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(before, (source.stat().st_mtime_ns, hashlib.sha256(source.read_bytes()).hexdigest()))
            with sqlite3.connect(root / 'public/db/lims.db') as db:
                self.assertEqual(db.execute('pragma page_size').fetchone()[0], 65536)
                self.assertEqual(db.execute('select id from example').fetchone()[0], 42)
