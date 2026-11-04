import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest

from ai_ale_kind_static.bundle import BundleError, validate_bundle
from ai_ale_kind_static.server import create_server
from support import fixture


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.prefix = "/user/alice/proxy/9000"
        fixture(self.root, self.prefix)
        self.bundle = validate_bundle(self.root, self.prefix)
        self.server = create_server(self.bundle, 0)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01})
        self.thread.start()
        self.addCleanup(self.stop_server)

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        self.assertFalse(self.thread.is_alive())

    def request(self, path, method="GET", headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        connection.request(method, path, headers=headers or {})
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def test_health_head_redirect_and_prefix_boundary(self):
        status, headers, body = self.request(self.prefix + "/api/kind-ready")
        self.assertEqual(status, 200)
        identity = json.loads(body)
        self.assertEqual(identity["status"], "ready")
        self.assertEqual(identity["identity"]["compiled_prefix"], self.prefix)
        self.assertNotIn(str(self.root), body.decode())
        self.assertEqual(headers["Cache-Control"], "no-store")
        status, head_headers, body = self.request(self.prefix + "/api/kind-ready", "HEAD")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"")
        self.assertEqual(head_headers["Content-Length"], headers["Content-Length"])
        status, headers, body = self.request(self.prefix + "?x=1")
        self.assertEqual(status, 308)
        self.assertEqual(headers["Location"], self.prefix + "/?x=1")
        for path in ("/", "/api/kind-ready", self.prefix + "-other/", "/user/alice/proxy/900/"):
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)

    def test_mime_head_and_directory_routes(self):
        for name, mime in (("app.js", "text/javascript"), ("style.css", "text/css"), ("data/manifest.json", "application/json"), ("worker.wasm", "application/wasm"), ("data/test.db", "application/octet-stream"), ("index.html", "text/html")):
            with self.subTest(name=name):
                status, headers, body = self.request(self.prefix + "/" + name)
                self.assertEqual(status, 200)
                self.assertEqual(headers["Content-Type"], mime)
                self.assertEqual(int(headers["Content-Length"]), len(body))
                head_status, head_headers, head_body = self.request(self.prefix + "/" + name, "HEAD")
                self.assertEqual(head_status, status)
                self.assertEqual(head_body, b"")
                for field in ("Content-Length", "ETag", "Last-Modified", "Content-Type"):
                    self.assertEqual(head_headers[field], headers[field])
        self.assertEqual(self.request(self.prefix + "/")[0], 200)
        self.assertEqual(self.request(self.prefix + "/route")[0], 308)
        self.assertEqual(self.request(self.prefix + "/route/")[2], b"<html>nested route</html>")

    def test_ranges_and_head_ranges(self):
        name = self.prefix + "/data/test.db"
        content = (self.root / "data/test.db").read_bytes()
        cases = (("bytes=0-9", 0, 9), ("bytes=65530-65540", 65530, 65540), ("bytes=262140-", 262140, len(content) - 1), ("bytes=-7", len(content) - 7, len(content) - 1), ("bytes=262140-999999", 262140, len(content) - 1), ("bytes=-999999", 0, len(content) - 1))
        for value, start, end in cases:
            with self.subTest(range=value):
                status, headers, body = self.request(name, headers={"Range": value})
                self.assertEqual(status, 206)
                self.assertEqual(body, content[start:end + 1])
                self.assertEqual(headers["Content-Range"], f"bytes {start}-{end}/{len(content)}")
                self.assertEqual(int(headers["Content-Length"]), end - start + 1)
                head_status, head_headers, body = self.request(name, "HEAD", {"Range": value})
                self.assertEqual(head_status, 206)
                self.assertEqual(head_headers["Content-Length"], headers["Content-Length"])
                self.assertEqual(body, b"")
        for value in ("bytes=999999-", "bytes=10-9", "bytes=-0", "bytes=-", "bytes=0-1,3-4", "items=0-1", "bytes=one-two", "bytes=" + "9" * 100 + "-"):
            with self.subTest(range=value):
                status, headers, body = self.request(name, headers={"Range": value})
                self.assertEqual(status, 416)
                self.assertEqual(headers["Content-Range"], f"bytes */{len(content)}")
                self.assertEqual(body, b"")
        self.assertEqual(self.request(self.prefix + "/empty.bin", headers={"Range": "bytes=0-0"})[0], 416)
        self.assertEqual(self.request(self.prefix + "/empty.bin")[2], b"")

    def test_cache_validators_and_if_range(self):
        path = self.prefix + "/app.js"
        _, headers, content = self.request(path)
        for condition in ({"If-None-Match": headers["ETag"]}, {"If-None-Match": "W/" + headers["ETag"]}, {"If-None-Match": "*"}, {"If-Modified-Since": headers["Last-Modified"]}):
            with self.subTest(condition=condition):
                status, cached_headers, body = self.request(path, headers=condition)
                self.assertEqual(status, 304)
                self.assertEqual(body, b"")
                self.assertNotIn("Content-Length", cached_headers)
        self.assertEqual(self.request(path, headers={"If-None-Match": '"different"', "If-Modified-Since": headers["Last-Modified"]})[0], 200)
        for value in (headers["ETag"], headers["Last-Modified"]):
            self.assertEqual(self.request(path, headers={"Range": "bytes=0-3", "If-Range": value})[0], 206)
        self.assertEqual(self.request(path, headers={"Range": "bytes=0-3", "If-Range": '"stale"'})[2], content)
        self.assertEqual(self.request(path, headers={"If-Modified-Since": "bad"})[0], 200)

    def test_missing_files_no_listing_and_invalid_paths(self):
        for name in ("missing.js", "missing.json", "missing-route", "data/", "kind-static-bundle.json"):
            self.assertEqual(self.request(self.prefix + "/" + name)[0], 404)
        for name in ("../index.html", "%2e%2e/index.html", "%252e%252e/index.html", "data%2ftest.db", "data%5ctest.db", "a//b", "./app.js", "%00", "%ZZ", "%ff"):
            with self.subTest(name=name):
                self.assertEqual(self.request(self.prefix + "/" + name)[0], 400)
        self.assertEqual(self.request(self.prefix + "/app.js", "POST")[0], 501)

    def test_changed_files_and_symlink_after_start_fail_closed(self):
        target = self.root / "app.js"
        target.write_text("modified")
        self.assertEqual(self.request(self.prefix + "/app.js")[0], 503)
        target.unlink()
        target.symlink_to("index.html")
        self.assertEqual(self.request(self.prefix + "/app.js")[0], 503)
        (self.root / "new-secret.txt").write_text("not sealed")
        self.assertEqual(self.request(self.prefix + "/new-secret.txt")[0], 404)
        data = self.root / "data"
        data.rename(self.root / "old-data")
        data.symlink_to("old-data", target_is_directory=True)
        self.assertEqual(self.request(self.prefix + "/data/test.db")[0], 503)

    def test_occupied_port(self):
        with self.assertRaisesRegex(BundleError, "cannot bind loopback port"):
            create_server(self.bundle, self.server.server_port)

    def test_concurrent_reads(self):
        results = []
        workers = [threading.Thread(target=lambda: results.append(self.request(self.prefix + "/data/test.db", headers={"Range": "bytes=10-19"}))) for _ in range(8)]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join(5)
        self.assertEqual(len(results), 8)
        self.assertTrue(all(status == 206 and body == bytes(range(10, 20)) for status, _, body in results))


class PrefixTests(unittest.TestCase):
    def test_root_and_second_nested_prefix(self):
        for prefix in ("", "/notebook/b/proxy/1234"):
            with self.subTest(prefix=prefix), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                fixture(root, prefix)
                server = create_server(validate_bundle(root, prefix), 0)
                thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01})
                thread.start()
                try:
                    conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
                    conn.request("GET", prefix + "/")
                    response = conn.getresponse()
                    self.assertEqual(response.status, 200)
                    self.assertIn((prefix + "/app.js").encode(), response.read())
                    conn.close()
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join(3)


if __name__ == "__main__":
    unittest.main()
