"""Read-only AST inventory of installed DisDex Root dependencies.

No import, eval, exec, systemd, secrets, approval, or trading action. A complete
filesystem dependency graph remains *observed*, not cryptographically certified
as a deployable release. Private source bytes must never be published.
"""
import ast
import hashlib
import json
from pathlib import Path
import re
import stat

INSTALLED_ROOT = Path("/usr/local/libexec/disdex-unified")
ROOTS = (
    "disdex_hype_scoped_root_cutover",
    "disdex_unified_root_gate",
    "disdex_v4_venue_witness",
    "disdex_pending_maintenance_install",
)
MODULE = re.compile(r"disdex_[A-Za-z0-9_]+\Z")


def dependency_names(raw, *, name):
    tree = ast.parse(raw, filename=name + ".py")
    deps, dynamic = set(), []
    import_names = {"import_module"}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == "importlib":
            import_names.update(alias.asname or alias.name for alias in node.names
                                if alias.name == "import_module")
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.startswith("disdex_"):
                    deps.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("disdex_"):
            deps.add(node.module.split(".")[0])
        elif isinstance(node, ast.Call):
            target = node.func
            import_module = ((isinstance(target, ast.Attribute) and target.attr == "import_module")
                             or (isinstance(target, ast.Name) and target.id in import_names))
            builtin_import = isinstance(target, ast.Name) and target.id == "__import__"
            code_loader = ((isinstance(target, ast.Attribute) and target.attr in (
                "spec_from_file_location", "exec_module", "SourceFileLoader", "run_path"))
                or (isinstance(target, ast.Name) and target.id in ("eval", "exec")))
            if code_loader:
                dynamic.append(dict(module=name, line=node.lineno,
                                    kind="EXTERNAL_CODE_LOADER_REQUIRES_REVIEW"))
            if import_module or builtin_import:
                if not node.args or not isinstance(node.args[0], ast.Constant) or not isinstance(node.args[0].value, str):
                    dynamic.append(dict(module=name, line=node.lineno, kind="DYNAMIC_MODULE_NAME"))
                elif node.args[0].value.startswith("disdex_"):
                    deps.add(node.args[0].value.split(".")[0])
    if any(not MODULE.fullmatch(dep) for dep in deps):
        raise ValueError("ROOT_IMPORT_MODULE_NAME_INVALID")
    return sorted(deps), dynamic


def scan(root=INSTALLED_ROOT, *, seeds=ROOTS, expected_sha256_by_name=None,
         enforce_root_ownership=True, owner_uid=0):
    root = Path(root)
    if not root.is_dir() or root.is_symlink():
        raise ValueError("ROOT_SOURCE_DIR_MISSING_OR_LINKED")
    if enforce_root_ownership:
        st = root.lstat()
        if st.st_uid != owner_uid or st.st_mode & 0o022:
            raise ValueError("ROOT_SOURCE_DIR_WRITABLE_OR_UNOWNED")
    checked = {}
    pending = list(seeds)
    missing = []
    dynamic = []
    expected = expected_sha256_by_name or {}
    if not isinstance(expected, dict):
        raise ValueError("ROOT_EXPECTED_DIGESTS_INVALID")
    while pending:
        name = pending.pop(0)
        if not MODULE.fullmatch(name):
            raise ValueError("ROOT_MODULE_NAME_INVALID")
        if name in checked or name in missing:
            continue
        if len(checked) + len(missing) >= 128:
            raise ValueError("ROOT_MODULE_GRAPH_TOO_LARGE")
        path = root / (name + ".py")
        if not path.exists() or path.is_symlink() or not path.is_file():
            missing.append(name)
            continue
        before = path.lstat()
        if not stat.S_ISREG(before.st_mode) or before.st_size > 2_000_000:
            raise ValueError("ROOT_MODULE_NOT_REGULAR_OR_TOO_LARGE:" + name)
        if enforce_root_ownership and (before.st_uid != owner_uid or before.st_mode & 0o022):
            raise ValueError("ROOT_MODULE_WRITABLE_OR_UNOWNED:" + name)
        raw = path.read_bytes()
        after = path.lstat()
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
                after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
            raise ValueError("ROOT_MODULE_CHANGED_DURING_AUDIT:" + name)
        digest = hashlib.sha256(raw).hexdigest()
        if name in expected and expected[name] != digest:
            raise ValueError("ROOT_MODULE_INDEPENDENT_HASH_CHANGED:" + name)
        deps, uncertain = dependency_names(raw, name=name)
        checked[name] = {"sha256": digest, "sizeBytes": len(raw), "imports": deps}
        dynamic += uncertain
        pending += [dep for dep in deps if dep not in checked and dep not in missing]
    status = ("BLOCKED_MISSING_OR_DYNAMIC_ROOT_MODULES"
              if missing or dynamic else "INSTALLED_ROOT_GRAPH_OBSERVED_REVIEW_REQUIRED")
    return {
        "schema": "disdex-stable4-root-graph-readonly/v1",
        "status": status,
        "root": str(root),
        "roots": list(seeds),
        "modules": dict(sorted(checked.items())),
        "moduleCount": len(checked),
        "missing": sorted(missing),
        "dynamicImports": dynamic,
        "sourceClosureCertified": False,
        "deploymentAuthorized": False,
        "ordersEnabled": False,
        "productionMutated": False,
    }


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=INSTALLED_ROOT)
    args = parser.parse_args()
    print(json.dumps(scan(root=args.root), sort_keys=True, indent=2))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())