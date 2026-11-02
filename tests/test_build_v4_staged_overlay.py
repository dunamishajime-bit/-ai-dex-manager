import json, subprocess, tempfile, unittest
from pathlib import Path
import sys
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).parents[1]/"scripts"/"ops"/"deploy"))
import build_v4_staged_overlay as m

class V4StagedOverlayBuildTest(unittest.TestCase):
    def test_composite_preview_never_claims_a_production_release_marker(self):
        repo=Path(__file__).parents[1]
        with tempfile.TemporaryDirectory() as td:
            out=Path(td)/"candidate"
            with patch.object(m,"archive_base"):
                evidence=m.build(repo,out,"a"*40)
            self.assertFalse((out/".disdex-release-sha").exists())
            self.assertIs(evidence["productionRelease"],False)

    def test_existing_output_directory_is_never_deleted(self):
        repo=Path(__file__).parents[1]
        with tempfile.TemporaryDirectory() as td:
            out=Path(td)/"existing"
            out.mkdir()
            sentinel=out/"keep.txt"
            sentinel.write_text("preserve")
            with patch.object(m,"archive_base"):
                with self.assertRaises(FileExistsError):
                    m.build(repo,out,"a"*40)
            self.assertEqual(sentinel.read_text(),"preserve")

    def test_manifest_is_bound_to_prod53_and_whitelisted_sources(self):
        repo=Path(__file__).parents[1]
        value=m.load_manifest(repo)
        self.assertEqual(value["baseSha"],m.BASE_SHA)
        targets={row["target"] for row in value["files"]}
        self.assertIn("scripts/v12-v4-production-runner.ts",targets)
        self.assertIn("scripts/v12-v4-monitor-only-runner.ts",targets)
        self.assertIn("lib/disdex-runner-tick-heartbeat.ts",targets)
        self.assertNotIn("lib/v12-v4-runner-engine.ts",targets)
        self.assertNotIn("config/integratedProductionRiskPolicy.ts",targets)
        self.assertIn("scripts/ops/root/disdex-pending-exposure-readonly-reconcile.ts",targets)

    def test_materialized_candidate_preserves_core_engine_and_only_overlays_declared_targets(self):
        repo=Path(__file__).parents[1]
        with tempfile.TemporaryDirectory() as td:
            out=Path(td)/"candidate"; sha="a"*40
            evidence=m.build(repo,out,sha)
            self.assertFalse((out/".disdex-release-sha").exists())
            baseline=subprocess.check_output(
                ["git","show",m.BASE_SHA+":lib/v12-v4-runner-engine.ts"],cwd=repo)
            self.assertEqual((out/"lib/v12-v4-runner-engine.ts").read_bytes().replace(b"\r\n",b"\n"),
                             baseline.replace(b"\r\n",b"\n"))
            marker=json.loads((out/".disdex-v4-staged-release.json").read_text())
            self.assertIs(marker["productionRelease"],False)
            self.assertEqual(marker["economicBaselineSha"],m.BASE_SHA)
            self.assertEqual(set(marker["overlayTargets"]),set(evidence["overlayTargets"]))
            for row in m.load_manifest(repo)["files"]:
                with self.subTest(target=row["target"]):
                    overlay=repo/"deploy/v4-staged-overlay"/row["source"]
                    self.assertEqual((out/row["target"]).read_bytes(),overlay.read_bytes())
            runner=(out/"scripts/v12-v4-production-runner.ts").read_text(encoding="utf-8-sig")
            self.assertIn("writeRunnerTickHeartbeat",runner)
            monitor=(out/"scripts/v12-v4-monitor-only-runner.ts").read_text(encoding="utf-8-sig")
            self.assertNotIn("V4RunnerEngine",monitor)
            self.assertNotIn("V12AsterLiveAdapter",monitor)

if __name__=="__main__": unittest.main()
