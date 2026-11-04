import copy
import json
from pathlib import Path
import tempfile
import unittest

from ai_ale_kind_static.bundle import BundleError, SEAL_NAME, normalize_prefix, validate_bundle
from support import fixture, write_seal


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.seal = fixture(self.root)

    def test_real_data_identity_matches_manifest(self):
        import hashlib
        snapshot = 'a' * 64
        body = json.dumps({'snapshot': {'sha256': snapshot}}).encode()
        (self.root / 'data/manifest.json').write_bytes(body)
        digest = hashlib.sha256(body).hexdigest()
        self.seal['files']['data/manifest.json'] = {'size': len(body), 'sha256': digest}
        self.seal['data'].update(id='lims-' + snapshot, manifest_sha256=digest)
        write_seal(self.root, self.seal)
        self.assertEqual(validate_bundle(self.root).identity['data']['id'], 'lims-' + snapshot)
        self.seal['data']['id'] = 'lims-' + 'b' * 64
        write_seal(self.root, self.seal)
        with self.assertRaisesRegex(BundleError, 'manifest snapshot'):
            validate_bundle(self.root)

    def test_valid_identity_and_root_prefix(self):
        bundle = validate_bundle(self.root, self.seal["compiled_prefix"])
        self.assertEqual(len(bundle.files), 8)
        self.assertNotIn(str(self.root), json.dumps(bundle.identity))
        write_seal(self.root, {**self.seal, "compiled_prefix": ""})
        self.assertEqual(validate_bundle(self.root, "").prefix, "")

    def test_missing_malformed_and_duplicate_seal(self):
        for body in ("{", "[]", '{"schema":"x","schema":"y"}', '{"schema":"wrong"}'):
            with self.subTest(body=body):
                (self.root / SEAL_NAME).write_text(body)
                with self.assertRaises(BundleError):
                    validate_bundle(self.root)
        (self.root / SEAL_NAME).unlink()
        with self.assertRaises(BundleError):
            validate_bundle(self.root)

    def test_invalid_metadata(self):
        mutations = [
            ("viewer_version", "not-a-version"), ("mode", "server"), ("channel", "static"),
            ("source", {"commit": "HEAD", "label": "dev"}),
            ("source", {**self.seal["source"], "label": "/absolute"}),
            ("data", {**self.seal["data"], "id": "real-data"}),
            ("data", {**self.seal["data"], "manifest_sha256": "0" * 64}),
            ("files", {}), ("files", []),
        ]
        for field, value in mutations:
            with self.subTest(field=field, value=value):
                write_seal(self.root, {**self.seal, field: value})
                with self.assertRaises(BundleError):
                    validate_bundle(self.root)

    def test_missing_size_digest_and_unsealed_files(self):
        (self.root / "app.js").write_bytes(b"changed")
        with self.assertRaisesRegex(BundleError, "mismatch"):
            validate_bundle(self.root)
        fixture(self.root)
        (self.root / "app.js").unlink()
        with self.assertRaises(BundleError):
            validate_bundle(self.root)
        fixture(self.root)
        (self.root / "unsealed.txt").write_text("not allowed")
        with self.assertRaisesRegex(BundleError, "unsealed"):
            validate_bundle(self.root)

    def test_equal_size_digest_mismatch_and_required_index(self):
        target = self.root / "app.js"
        target.write_bytes(b"x" * target.stat().st_size)
        with self.assertRaisesRegex(BundleError, "mismatch"):
            validate_bundle(self.root)
        fixture(self.root)
        seal = copy.deepcopy(self.seal)
        del seal["files"]["index.html"]
        write_seal(self.root, seal)
        with self.assertRaisesRegex(BundleError, "sealed index.html"):
            validate_bundle(self.root)

    def test_inventory_traversal_and_seal_inclusion(self):
        for name in ("../escape", "/absolute", "a/../b", "a//b", "a\\b", "a%2fb", SEAL_NAME):
            with self.subTest(name=name):
                seal = copy.deepcopy(self.seal)
                seal["files"][name] = seal["files"]["app.js"]
                write_seal(self.root, seal)
                with self.assertRaises(BundleError):
                    validate_bundle(self.root)

    def test_bad_file_record(self):
        for entry in ({"size": True, "sha256": "0" * 64}, {"size": -1, "sha256": "0" * 64}, {"size": 1, "sha256": "bad"}, []):
            seal = copy.deepcopy(self.seal)
            seal["files"]["app.js"] = entry
            write_seal(self.root, seal)
            with self.assertRaises(BundleError):
                validate_bundle(self.root)

    def test_symlink_file_directory_root_and_seal(self):
        (self.root / "app.js").unlink()
        (self.root / "app.js").symlink_to("index.html")
        with self.assertRaises(BundleError):
            validate_bundle(self.root)
        (self.root / "app.js").unlink()
        fixture(self.root)
        (self.root / "alias").symlink_to("data", target_is_directory=True)
        with self.assertRaises(BundleError):
            validate_bundle(self.root)
        (self.root / "alias").unlink()
        (self.root / "alias").symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(BundleError):
            validate_bundle(self.root / "alias")
        (self.root / "alias").unlink()
        seal_content = (self.root / SEAL_NAME).read_bytes()
        (self.root / SEAL_NAME).unlink()
        (self.root / "seal-copy").write_bytes(seal_content)
        (self.root / SEAL_NAME).symlink_to("seal-copy")
        with self.assertRaises(BundleError):
            validate_bundle(self.root)

    def test_changed_file_after_validation(self):
        bundle = validate_bundle(self.root)
        (self.root / "app.js").write_bytes(b"replacement")
        with self.assertRaises(BundleError):
            bundle.open_file("app.js")
        with self.assertRaises(BundleError):
            bundle.open_file(SEAL_NAME)

    def test_prefix_normalization_and_mismatch(self):
        for prefix in ("/", "relative", "/bad/", "/two//parts", "/../escape", "/./dot", "/white space", "/path?x", "/encoded%2f", None):
            with self.subTest(prefix=prefix), self.assertRaises(BundleError):
                normalize_prefix(prefix)
        self.assertEqual(normalize_prefix("/a/b-1_2"), "/a/b-1_2")
        with self.assertRaisesRegex(BundleError, "does not match"):
            validate_bundle(self.root, "/different")


if __name__ == "__main__":
    unittest.main()
