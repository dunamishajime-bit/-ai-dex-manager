"""Research adapter invariants; executes actual causal_exit AST in a synthetic barbook.
This is NOT venue certification and does not touch production.
"""
import ast
import pathlib
import unittest

H = 3_600_000
HERE = pathlib.Path(__file__).resolve().parent
SIMPLE = HERE / "exit_protection_3change_integrated_20261016.py"
STRESS = HERE / "exit_protection_3change_stress_20261016.py"


def load_exit_logic(script):
    tree = ast.parse(script.read_text(encoding="utf-8"))
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "causal_exit")
    book = {}
    env = {"H": H, "hbar": lambda symbol, ts: book.get((symbol, ts)),
           "atr14": lambda s, t: 1.0}
    compiled = compile(ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[])),
                       filename=str(script), mode="exec")
    exec(compiled, env)
    return env["causal_exit"], book


def make_candidate(strategy="V12", route="REC_G5_SLOW_TREND", family=None, side="LONG", end=4):
    return dict(strategy_id=strategy, route=route, family=family, symbol="FAKEUSDT",
                side=side, entry_price=100.0, entry_ts_ms=0, exit_ts_ms=end*H,
                exit_price=98.0)


def observations():
    return dict(changed=0, byStrategy={}, byReason={}, h1gap=0, noATR=0)


def bar(op, high, low, close):
    return dict(open=op, high=high, low=low, close=close)


class ProfitFloorCausality(unittest.TestCase):
    def setUp(self):
        self.exit, self.book = load_exit_logic(SIMPLE)
        self.book.update({("FAKEUSDT", 0):bar(100,104,99,103),
                          ("FAKEUSDT", H):bar(102,103,100.0,100.4),
                          ("FAKEUSDT", 2*H):bar(100.4,101,99.8,100),
                          ("FAKEUSDT", 3*H):bar(100,100.4,98,99)})

    def test_trigger_is_effective_only_next_hour(self):
        row=make_candidate()
        res=self.exit(row,"combined_no_residual",observations())
        self.assertEqual(res["exit_ts_ms"],2*H)
        self.assertAlmostEqual(res["exit_price"],100.5)

    def test_intrabar_high_without_close_does_not_arm(self):
        self.book[("FAKEUSDT",0)]=bar(100,104,99,101)
        self.book[("FAKEUSDT",H)]=bar(101,101,99.8,100)
        self.book[("FAKEUSDT",2*H)]=bar(100,101,99.5,100)
        self.book[("FAKEUSDT",3*H)]=bar(100,101,97.0,99)
        row=make_candidate()
        self.assertEqual(self.exit(row,"combined_no_residual",observations()),row)

    def test_gap_is_filled_adversely(self):
        self.book[("FAKEUSDT",H)]=bar(98,99,97,98)
        res=self.exit(make_candidate(),"combined_no_residual",observations())
        self.assertAlmostEqual(res["exit_price"],98)
        self.assertEqual(res["exit_ts_ms"],2*H)

    def test_short_floor_direction(self):
        self.book[("FAKEUSDT",0)]=bar(100,101,97,97)
        self.book[("FAKEUSDT",H)]=bar(98,101,96,100)
        row=make_candidate(side="SHORT")
        res=self.exit(row,"combined_no_residual",observations())
        self.assertAlmostEqual(res["exit_price"],99.5)
        self.assertEqual(res["exit_ts_ms"],2*H)

    def test_q102_mr_only_not_highvol(self):
        mr=make_candidate("Q102",route=None,family="MR")
        mr["exit_price"]=95
        self.assertNotEqual(self.exit(mr,"combined_no_residual",observations()),mr)
        hv=dict(mr,family="HIGH_VOL")
        self.assertEqual(self.exit(hv,"combined_no_residual",observations()),hv)

    def test_v12_only_two_routes_and_pengu_unchanged(self):
        for strategy,route in (("PENGU","REC_G5_SLOW_TREND"),
                               ("V12","REC_Y06_REV_D0_T72"),
                               ("HYPE_LONG",None),("FET",None),("IDLE",None),
                               ("V52",None),("RESIDUAL",None)):
            c=make_candidate(strategy,route)
            self.assertIs(self.exit(c,"combined_no_residual",observations()),c,
                          f"Unexpected change for {strategy}/{route}")

    def test_x05_threshold(self):
        x=make_candidate(route="REC_X05_TIME_36H")
        self.book[("FAKEUSDT",0)]=bar(100,103,99,102)
        self.assertEqual(self.exit(x,"combined_no_residual",observations()),x)
        self.book[("FAKEUSDT",0)]=bar(100,103,99,103)
        self.assertAlmostEqual(self.exit(x,"combined_no_residual",observations())["exit_price"],101)

    def test_missing_h1_is_fail_closed(self):
        del self.book[("FAKEUSDT",H)]
        x=make_candidate()
        o=observations()
        self.assertEqual(self.exit(x,"combined_no_residual",o),x)
        self.assertEqual(o["h1gap"],1)

    def test_stress_slippage_only_on_stop(self):
        exit_stress,book=load_exit_logic(STRESS)
        book.update(self.book)
        res=exit_stress(make_candidate(),"three_slip50",observations())
        self.assertAlmostEqual(res["exit_price"],100.5*(1-0.005))

    def test_stress_activation_delay(self):
        exit_stress,book=load_exit_logic(STRESS)
        book.update(self.book)
        normal=exit_stress(make_candidate(),"three_slip50",observations())
        delayed=exit_stress(make_candidate(),"three_delay1",observations())
        self.assertNotEqual(normal["exit_price"],delayed["exit_price"])


if __name__=="__main__":
    unittest.main(verbosity=2)
