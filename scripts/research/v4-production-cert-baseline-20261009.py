"""Read-only source import; output exclusively in production-cert worktree. No network."""
import sys, pathlib, hashlib, json, os, time
sys.dont_write_bytecode = True
SOURCE = pathlib.Path("C:/Users/dis/DisDex-five-improvements-20261008")
DEST = pathlib.Path(__file__).resolve().parents[2] / "docs/research/results/v4-production-cert-20261009/bt-baseline"
DEST.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(SOURCE / "scripts/research"))
original = SOURCE / "scripts/research/run_v12_v2_integrated_confirm_20261009.py"
code = original.read_text(encoding="utf-8")
code = code.replace('OUT = ROOT / "docs/research/results/v12-v2-integrated-confirm-20261009"', "OUT = DEST")
ns = {"__file__": str(original), "__name__": "__cert_import__", "DEST": DEST}
exec(compile(code, str(original), "exec"), ns)
started = time.time()
ns["main"]()
hashes = []
for scenario in sorted((DEST / "cases" / ns["NAME"] / "runs").glob("*")):
    if not scenario.is_dir(): continue
    for p in sorted(scenario.glob("*")):
        if p.is_file():
            ref = SOURCE / "docs/research/results/v12-v2-integrated-confirm-20261009/cases" / ns["NAME"] / "runs" / scenario.name / p.name
            h = hashlib.sha256(p.read_bytes()).hexdigest()
            rh = hashlib.sha256(ref.read_bytes()).hexdigest() if ref.exists() else None
            hashes.append({"path": str(p.relative_to(DEST)), "sha256": h, "reference_sha256": rh, "equal": h == rh})
sources = []
for m in list(sys.modules.values()):
    p = getattr(m, "__file__", None)
    if p and str(SOURCE).lower() in str(p).lower() and pathlib.Path(p).is_file():
        sources.append({"path": str(p), "sha256": hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()})
manifest = {"status": "RESEARCH_BASELINE_RERUN_NOT_RUNTIME_CERTIFICATION", "seconds": time.time()-started,
            "source_root": str(SOURCE), "sources": sources, "outputs": hashes,
            "hindsight_rank_causal_in_train": False, "trading_mutation": 0, "network_calls": 0}
(DEST / "rerun-manifest.json").write_text(json.dumps(manifest, indent=2)+"\n", encoding="utf-8")
print("CERT_MANIFEST", DEST / "rerun-manifest.json", flush=True)
