"""Fail-closed validation of the local, versioned static bundle seal."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import stat
from dataclasses import dataclass
from typing import BinaryIO

SEAL_NAME = "kind-static-bundle.json"
SCHEMA = "kind-static-bundle/v1"
CHUNK_SIZE = 64 * 1024


class BundleError(ValueError):
    """A bundle is malformed, unsafe or inconsistent with its seal."""


def normalize_prefix(value: str) -> str:
    """Require the canonical compiled prefix; the root prefix is empty."""
    if not isinstance(value, str) or (value and not re.fullmatch(r"(?:/[A-Za-z0-9_~-][A-Za-z0-9_.~-]*)+", value)):
        raise BundleError("prefix must be empty (root) or a normalized /nested/path without a trailing slash")
    if any(part in {".", ".."} for part in value.split("/")):
        raise BundleError("prefix must not contain dot segments")
    return value


def relative_path(value: str) -> str:
    if not isinstance(value, str) or not value or value.startswith("/") or any(c in value for c in "\\%?#") or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise BundleError("inventory paths must be safe relative POSIX paths")
    if any(part in {"", ".", ".."} for part in value.split("/")):
        raise BundleError("inventory paths must not contain empty or dot segments")
    return value


def secure_open(root: Path, name: str) -> BinaryIO:
    """Walk with directory descriptors and O_NOFOLLOW, including at open time."""
    relative_path(name)
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        parts = name.split("/")
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise BundleError(f"not a regular file: {name}")
            return os.fdopen(fd, "rb")
        except BaseException:
            os.close(fd)
            raise
    finally:
        os.close(directory)


def fingerprint(info: os.stat_result) -> tuple[int, ...]:
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def digest_stream(stream: BinaryIO) -> str:
    digest = hashlib.sha256()
    while chunk := stream.read(CHUNK_SIZE):
        digest.update(chunk)
    return digest.hexdigest()


def _unique_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise BundleError(f"duplicate seal field: {key}")
        result[key] = value
    return result


@dataclass(frozen=True)
class FileRecord:
    size: int
    sha256: str
    fingerprint: tuple[int, ...]
    modified: float


@dataclass(frozen=True)
class Bundle:
    root: Path
    identity: dict
    files: dict[str, FileRecord]

    @property
    def prefix(self) -> str:
        return self.identity["compiled_prefix"]

    def open_file(self, name: str) -> BinaryIO:
        if name not in self.files:
            raise BundleError("file is not sealed")
        stream = secure_open(self.root, name)
        if fingerprint(os.fstat(stream.fileno())) != self.files[name].fingerprint:
            stream.close()
            raise BundleError("sealed file changed; revalidate the bundle before serving")
        return stream


def validate_bundle(path: Path | str, root_path: str | None = None) -> Bundle:
    """Validate all files before binding; identity deliberately contains no paths."""
    root = Path(os.path.abspath(path))
    try:
        if root.is_symlink() or not root.is_dir():
            raise BundleError("bundle must be a directory, not a symlink")
        with secure_open(root, SEAL_NAME) as stream:
            if os.fstat(stream.fileno()).st_size > 8 * 1024 * 1024:
                raise BundleError("bundle seal exceeds the 8 MiB limit")
            seal = json.load(stream, object_pairs_hook=_unique_object)
        if not isinstance(seal, dict) or seal.get("schema") != SCHEMA:
            raise BundleError(f"seal schema must be {SCHEMA}")
        version = seal.get("viewer_version")
        if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?", version):
            raise BundleError("viewer_version must be a semantic version")
        source = seal.get("source")
        if not isinstance(source, dict) or not isinstance(source.get("commit"), str) or not re.fullmatch(r"[0-9a-f]{40}", source["commit"]):
            raise BundleError("source.commit must be a pinned 40-character lowercase Git SHA")
        label = source.get("label")
        if not isinstance(label, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", label):
            raise BundleError("source.label must be a non-path local label")
        prefix = normalize_prefix(seal.get("compiled_prefix"))
        if root_path is not None and normalize_prefix(root_path) != prefix:
            raise BundleError("runtime root path does not match the bundle compiled prefix; rebuild for this prefix")
        if seal.get("mode") != "static" or seal.get("channel") != "kind-local":
            raise BundleError("local seal requires mode=static and channel=kind-local")
        data = seal.get("data")
        if not isinstance(data, dict) or not isinstance(data.get("id"), str) or not re.fullmatch(r"(?:synthetic-[A-Za-z0-9._-]+|lims-[0-9a-f]{64})", data["id"]):
            raise BundleError("data.id must identify synthetic data (synthetic-...) or a LIMS snapshot (lims-<sha256>)")
        manifest = relative_path(data.get("manifest"))
        inventory = seal.get("files")
        if not isinstance(inventory, dict) or not inventory:
            raise BundleError("files must be a nonempty relative file inventory")
        records = {}
        for name, entry in inventory.items():
            relative_path(name)
            if name == SEAL_NAME or not isinstance(entry, dict):
                raise BundleError("inventory must exclude the seal and contain file records")
            size, digest = entry.get("size"), entry.get("sha256")
            if type(size) is not int or size < 0 or not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
                raise BundleError(f"invalid size or SHA-256: {name}")
            with secure_open(root, name) as stream:
                before = os.fstat(stream.fileno())
                if before.st_size != size or digest_stream(stream) != digest:
                    raise BundleError(f"size or SHA-256 mismatch: {name}")
                if fingerprint(before) != fingerprint(os.fstat(stream.fileno())):
                    raise BundleError(f"file changed during validation: {name}")
                records[name] = FileRecord(size, digest, fingerprint(before), before.st_mtime)
        if "index.html" not in records:
            raise BundleError("bundle requires a sealed index.html")
        if manifest not in records or data.get("manifest_sha256") != records[manifest].sha256:
            raise BundleError("data manifest digest does not match the sealed inventory")
        if data["id"].startswith("lims-"):
            with secure_open(root, manifest) as stream:
                metadata = json.load(stream)
            snapshot = metadata.get("snapshot") if isinstance(metadata, dict) else None
            if not isinstance(snapshot, dict) or snapshot.get("sha256") != data["id"][5:]:
                raise BundleError("LIMS data identity must match manifest snapshot.sha256")
        actual = set()
        for directory, dirs, files in os.walk(root, followlinks=False):
            for name in dirs + files:
                child = Path(directory) / name
                if child.is_symlink():
                    raise BundleError("bundle must not contain symlinks")
            for name in files:
                actual.add((Path(directory) / name).relative_to(root).as_posix())
        if actual != set(records) | {SEAL_NAME}:
            raise BundleError("bundle contains missing or unsealed files")
        identity = {"schema": SCHEMA, "viewer_version": version, "source": {"commit": source["commit"], "label": label}, "compiled_prefix": prefix, "mode": "static", "channel": "kind-local", "data": {"id": data["id"], "manifest": manifest, "manifest_sha256": records[manifest].sha256}}
        return Bundle(root, identity, records)
    except (OSError, UnicodeError, json.JSONDecodeError, TypeError, RecursionError) as exc:
        raise BundleError(f"cannot validate bundle seal or files ({type(exc).__name__}); check seal, file access and inventory") from exc
