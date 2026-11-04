from contextlib import redirect_stderr, redirect_stdout
import http.client
import io
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from ai_ale_kind_static import cli
from support import fixture


class CliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.prefix = "/user/alice/proxy/9000"
        fixture(self.root, self.prefix)

    def invoke(self, args):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            code = cli.main(args)
        return code, stdout.getvalue(), stderr.getvalue()

    def test_info_and_doctor(self):
        code, out, err = self.invoke(["info"])
        self.assertEqual(code, 0)
        self.assertFalse(json.loads(out)["registered"])
        self.assertEqual(err, "")
        code, out, err = self.invoke(["doctor", "--bundle", str(self.root), "--root-path", self.prefix])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["validated_files"], 8)
        self.assertNotIn(str(self.root), out)
        self.assertEqual(err, "")

    def test_environment_bundle_and_explicit_precedence(self):
        with patch.dict(os.environ, {cli.BUNDLE_ENV: str(self.root)}):
            self.assertEqual(self.invoke(["doctor", "--root-path", self.prefix])[0], 0)
        with patch.dict(os.environ, {cli.BUNDLE_ENV: "/nonexistent"}):
            self.assertEqual(self.invoke(["doctor", "--bundle", str(self.root), "--root-path", self.prefix])[0], 0)

    def test_missing_corrupt_mismatched_bundle(self):
        with patch.dict(os.environ, {}, clear=True):
            code, out, err = self.invoke(["doctor", "--root-path", self.prefix])
            self.assertEqual(code, 2)
            self.assertIn("specify --bundle", err)
        code, _, err = self.invoke(["serve", "--bundle", str(self.root), "--root-path", "/wrong", "--port", "9000"])
        self.assertEqual(code, 2)
        self.assertIn("does not match", err)
        (self.root / "app.js").write_text("corrupt")
        code, _, err = self.invoke(["doctor", "--bundle", str(self.root), "--root-path", self.prefix])
        self.assertEqual(code, 2)
        self.assertIn("mismatch", err)
        self.assertNotIn("Traceback", err)

    def test_argument_validation(self):
        for port in ("0", "65536", "abc"):
            with self.subTest(port=port), redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
                cli.main(["serve", "--port", port, "--root-path", self.prefix])
            self.assertEqual(error.exception.code, 2)
        for prefix in ("/", "/bad/", "/../bad"):
            with self.subTest(prefix=prefix), redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                cli.main(["doctor", "--root-path", prefix])

    def test_occupied_port_error(self):
        with socket.socket() as occupied:
            occupied.bind(("127.0.0.1", 0))
            occupied.listen()
            code, _, err = self.invoke(["serve", "--bundle", str(self.root), "--root-path", self.prefix, "--port", str(occupied.getsockname()[1]), "--no-king"])
        self.assertEqual(code, 2)
        self.assertIn("cannot bind loopback port", err)

    def test_real_module_launch_and_clean_signals_without_node(self):
        source = str(Path(cli.__file__).resolve().parent.parent)
        for stop_signal in (signal.SIGTERM, signal.SIGINT):
            with self.subTest(signal=stop_signal):
                with socket.socket() as reservation:
                    reservation.bind(("127.0.0.1", 0))
                    port = reservation.getsockname()[1]
                child = subprocess.Popen([sys.executable, "-B", "-m", "ai_ale_kind_static", "serve", "--bundle", str(self.root), "--root-path", self.prefix, "--port", str(port), "--no-king"], cwd=self.root, env={**os.environ, "PYTHONPATH": source, "PATH": ""}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                try:
                    deadline = time.monotonic() + 5
                    ready = False
                    while time.monotonic() < deadline and child.poll() is None:
                        try:
                            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=0.2)
                            connection.request("GET", self.prefix + "/api/kind-ready")
                            response = connection.getresponse()
                            ready = response.status == 200 and json.loads(response.read())["status"] == "ready"
                            connection.close()
                            if ready:
                                break
                        except OSError:
                            time.sleep(0.02)
                    self.assertTrue(ready, "launcher did not become ready")
                    child.send_signal(stop_signal)
                    stdout, stderr = child.communicate(timeout=5)
                    self.assertEqual(child.returncode, 0, stderr)
                    self.assertIn("local static viewer ready", stdout)
                    self.assertEqual(stderr, "")
                    with socket.socket() as probe:
                        probe.settimeout(0.2)
                        self.assertNotEqual(probe.connect_ex(("127.0.0.1", port)), 0)
                finally:
                    if child.poll() is None:
                        child.kill()
                        child.communicate(timeout=3)


if __name__ == "__main__":
    unittest.main()
