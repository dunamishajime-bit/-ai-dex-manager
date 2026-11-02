import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
MODULE=ROOT/"scripts/ops/deploy/disdex_allrunner_order_enable_prep.py"

def load_module():
    spec=importlib.util.spec_from_file_location("order_enable_prep",MODULE)
    module=importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module

class OrderEnablePrepTests(unittest.TestCase):
    def setUp(self):
        self.m=load_module()

    def test_effective_execstartpre_honors_reset_and_preserves_other_checks(self):
        cat="""# /etc/systemd/system/x.service
[Service]
ExecStartPre=/usr/bin/test -f /one
ExecStartPre=/usr/bin/node /r/gate.mjs --runner X --activation-path /old
# /etc/systemd/system/x.service.d/50-extra.conf
[Service]
ExecStartPre=
ExecStartPre=/usr/bin/test -f /two
ExecStartPre=+/usr/bin/node /r/disdex-live-operator-activation-gate.mjs --runner X --activation-path /var/lib/disdex/shared/operator-activation/current.json
ExecStartPre=/usr/bin/test -f /three
"""
        cmds=self.m.effective_execstartpre_from_cat(cat)
        self.assertEqual(len(cmds),3)
        self.assertIn("/two",cmds[0])
        self.assertIn("disdex-live-operator-activation-gate.mjs",cmds[1])
        self.assertIn("/three",cmds[2])

    def test_rewrite_changes_only_single_activation_path(self):
        cmds=[
            "/usr/bin/test -f /release/.disdex-release-sha",
            "+/usr/bin/node /release/disdex-live-operator-activation-gate.mjs --release-root /release --sha abc --runner QUALITY102_CAUSAL_V1 --activation-path /var/lib/disdex/shared/operator-activation/current.json",
            "/release/node_modules/.bin/tsx runner.ts --preflight",
        ]
        out=self.m.ensure_scoped_activation_gate(
            cmds,
            "QUALITY102_CAUSAL_V1",
            "e"*40,
            "/var/lib/disdex/shared/operator-activation/current.json",
            "/var/lib/disdex/quality102-causal-v1/operator-activation/current.json",
        )
        self.assertEqual(len(out),len(cmds))
        self.assertEqual(out[0],cmds[0])
        self.assertEqual(out[2],cmds[2])
        self.assertIn("/var/lib/disdex/quality102-causal-v1/operator-activation/current.json",out[1])
        self.assertNotIn("--activation-path /var/lib/disdex/shared/operator-activation/current.json",out[1])

    def test_rewrite_rejects_multiple_gates_or_unknown_old_path(self):
        gate="+/usr/bin/node /r/disdex-live-operator-activation-gate.mjs --runner X --activation-path /old"
        with self.assertRaisesRegex(ValueError,"ACTIVATION_GATE_COUNT"):
            self.m.ensure_scoped_activation_gate([gate,gate],"V52","4"*40,"/old","/new")
        with self.assertRaisesRegex(ValueError,"ACTIVATION_OLD_PATH_UNEXPECTED"):
            self.m.ensure_scoped_activation_gate([gate],"V52","4"*40,"/allowed","/new")

    def test_missing_gate_is_appended_without_removing_existing_preflights(self):
        cmds=["/usr/bin/test -f /a","/usr/bin/test -f /b"]
        out=self.m.ensure_scoped_activation_gate(
            cmds,"V12_V4","5"*40,
            "/var/lib/disdex/shared/operator-activation/current.json",
            "/var/lib/disdex/shared/operator-activation/v12-v4-full.json",
        )
        self.assertEqual(out[:2],cmds)
        self.assertEqual(len(out),3)
        self.assertIn("--runner V12_V4",out[2])
        self.assertIn("--activation-path /var/lib/disdex/shared/operator-activation/v12-v4-full.json",out[2])

    def test_render_dropin_resets_then_replays_every_preflight(self):
        cmds=["/usr/bin/test -f /a","+/usr/bin/node /gate --activation-path /new","/usr/bin/test -f /b"]
        text=self.m.render_dropin(cmds)
        self.assertTrue(text.startswith("[Service]\nExecStartPre=\n"))
        self.assertEqual(text.count("ExecStartPre="),4)
        for cmd in cmds:
            self.assertIn("ExecStartPre="+cmd,text)

    def test_dropin_transaction_rolls_back_on_validation_failure(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"99-test.conf"
            p.write_text("old\n",encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError,"validation"):
                self.m.apply_dropin_transaction(
                    {p:"new\n"},
                    daemon_reload=lambda: None,
                    post_validate=lambda: (_ for _ in ()).throw(RuntimeError("validation")),
                )
            self.assertEqual(p.read_text(encoding="utf-8"),"old\n")

    def test_logical_lines_join_backslash_continuation(self):
        text="[Service]\nExecStartPre=/bin/sh -c 'one \\\n two'\nExecStartPre=/bin/true\n"
        lines=self.m.logical_lines(text)
        self.assertIn("ExecStartPre=/bin/sh -c 'one  two'",lines)

if __name__=="__main__":
    unittest.main()
