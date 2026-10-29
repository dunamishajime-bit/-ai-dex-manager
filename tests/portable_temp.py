"""Portable disposable directories for tests on Microsoft Store Python."""

from __future__ import annotations

from contextlib import contextmanager
import os
from pathlib import Path
import shutil
import tempfile
import uuid


@contextmanager
def portable_temporary_directory(
    prefix: str = "disdex-test-",
    *,
    dir: str | Path | None = None,
):
    """Yield a writable disposable directory without changing Linux behavior.

    Microsoft Store Python can turn ``TemporaryDirectory``'s POSIX mode 0700
    into an ACL that rejects the creating process.  On Windows we create a
    normal user-writable directory explicitly; production Linux permissions
    and all POSIX tests continue to use ``TemporaryDirectory`` unchanged.
    """
    if os.name != "nt":
        with tempfile.TemporaryDirectory(prefix=prefix, dir=dir) as temporary:
            yield Path(temporary)
        return

    parent = Path(dir) if dir is not None else Path(tempfile.gettempdir())
    root = parent / f"{prefix}{uuid.uuid4().hex}"
    root.mkdir(mode=0o755)
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=False)
