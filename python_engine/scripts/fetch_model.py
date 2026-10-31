#!/usr/bin/env python3
"""Download the default GGUF weights.

Idempotent: skips the download if the file is already present and the size
matches. Verifies the SHA-256 when a checksum is known, and refuses to leave a
partial file behind on failure.

Usage:
    python scripts/fetch_model.py [--force]
"""

from __future__ import annotations

import argparse
import hashlib
import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TARGET = REPO_ROOT / "models" / "Qwen3-0.6B-Q4_K_M.gguf"

# Upstream: unsloth/Qwen3-0.6B-GGUF on Hugging Face.
URL = (
    "https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/"
    "Qwen3-0.6B-Q4_K_M.gguf?download=true"
)
EXPECTED_BYTES = 396_705_472
# Left empty when the upstream checksum has not been independently confirmed.
# The size check still runs; a wrong size is a hard failure.
EXPECTED_SHA256 = ""


def sha256(path: Path, chunk: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="re-download even if present")
    args = parser.parse_args()

    TARGET.parent.mkdir(parents=True, exist_ok=True)

    if TARGET.exists() and not args.force:
        size = TARGET.stat().st_size
        if size == EXPECTED_BYTES:
            print(f"already present: {TARGET} ({size / 1e6:.1f} MB)")
            return 0
        print(f"size mismatch ({size} != {EXPECTED_BYTES}); re-downloading")

    partial = TARGET.with_suffix(".gguf.part")
    print(f"downloading {URL}\n     -> {TARGET}")
    try:
        with urllib.request.urlopen(URL) as response, partial.open("wb") as out:
            total = int(response.headers.get("Content-Length") or 0)
            done = 0
            while chunk := response.read(1 << 20):
                out.write(chunk)
                done += len(chunk)
                if total:
                    pct = done * 100 / total
                    print(f"\r  {done / 1e6:7.1f} / {total / 1e6:.1f} MB ({pct:5.1f}%)", end="")
        print()
    except Exception as exc:  # noqa: BLE001 - any download failure must clean up the partial file
        partial.unlink(missing_ok=True)
        print(f"download failed: {exc}", file=sys.stderr)
        return 1

    size = partial.stat().st_size
    if size != EXPECTED_BYTES:
        partial.unlink(missing_ok=True)
        print(f"size check failed: got {size}, expected {EXPECTED_BYTES}", file=sys.stderr)
        return 1

    if EXPECTED_SHA256:
        actual = sha256(partial)
        if actual != EXPECTED_SHA256:
            partial.unlink(missing_ok=True)
            print(f"checksum mismatch: {actual}", file=sys.stderr)
            return 1
        print(f"sha256 ok: {actual}")

    partial.replace(TARGET)
    print(f"done: {TARGET} ({size / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
