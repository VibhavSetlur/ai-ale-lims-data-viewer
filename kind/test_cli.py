import http.server
import json
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from kind import APP_ID
from kind import cli


class KindCliTests(unittest.TestCase):
    def test_manifest_has_documented_load_bearing_fields(self):
        data = cli.manifest()
        self.assertEqual(data["type"], "app")
        self.assertEqual(data["id"], APP_ID)
        self.assertEqual(data["launch"]["cmd"], [APP_ID, "serve", "--port", "{port}", "--root-path", "{proxy_path}", "--no-king"])

    def test_manifest_validation_rejects_invalid_guide_fields(self):
        for mutation in (
            lambda data: data.update(type="service"),
            lambda data: data.update(id="not_canonical"),
            lambda data: data["launch"].update(cmd=[]),
            lambda data: data["launch"].update(cmd=[APP_ID, "serve"]),
        ):
            data = cli.manifest()
            mutation(data)
            with self.assertRaises(ValueError):
                cli.validate_manifest(data)

    def test_invalid_root_paths_are_rejected(self):
        for value in ("/", "relative", "/bad/", "/two//slashes", "/white space"):
            with self.assertRaises(SystemExit):
                cli.main(["serve", "--port", "9000", "--root-path", value, "--no-king"])

    def test_install_prints_valid_json_and_refuses_external_output(self):
        with self.assertRaises(SystemExit):
            cli.main(["kind-install", "--output", "/tmp/manifest.json"])
        self.assertEqual(cli.main(["kind-install"]), 0)

    def test_readiness_route_is_db_independent(self):
        route = (cli.REPO / "src/app/api/kind-ready/route.ts").read_text()
        self.assertIn("status: 'ready'", route)
        self.assertNotIn("@/lib/db", route)

    def test_proxy_strips_prefix_and_rewrites_absolute_html(self):
        class Upstream(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200); self.send_header("Content-Type", "text/html"); self.end_headers()
                self.wfile.write(b'<a href="/page"><img src="/asset">')
            def log_message(self, format, *args): pass
        upstream = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
        threading.Thread(target=upstream.serve_forever, daemon=True).start()
        proxy = http.server.ThreadingHTTPServer(("127.0.0.1", 0), cli._proxy_handler("/user/a/proxy/9000", upstream.server_port))
        threading.Thread(target=proxy.serve_forever, daemon=True).start()
        import urllib.request
        body = urllib.request.urlopen(f"http://127.0.0.1:{proxy.server_port}/user/a/proxy/9000/").read()
        self.assertIn(b'href="/user/a/proxy/9000/page"', body)
        self.assertIn(b'src="/user/a/proxy/9000/asset"', body)
        proxy.shutdown(); proxy.server_close(); upstream.shutdown(); upstream.server_close()

    def test_serve_cleans_child_after_readiness_failure(self):
        with patch.object(cli, "wait_ready", return_value=False), patch.object(cli.subprocess, "Popen") as popen, patch.object(cli.shutil, "which", return_value="/usr/bin/npm"), patch.object(cli.Path, "is_dir", return_value=True), patch.object(cli.os, "killpg") as killpg:
            child = popen.return_value; child.pid = 12345
            self.assertEqual(cli.main(["serve", "--port", "9000", "--root-path", "/proxy", "--no-king"]), 1)
            killpg.assert_called_once_with(12345, cli.signal.SIGTERM)
            child.wait.assert_called_once_with(timeout=10)
            child.kill.assert_not_called()


if __name__ == "__main__":
    unittest.main()
