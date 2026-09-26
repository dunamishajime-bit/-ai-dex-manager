"""Official ECB JPY/EUR : USD/EUR cross is explicit, causal, and never misidentified as FRED."""
import unittest
import tempfile
import json
import hashlib
from datetime import date,datetime,timezone
from pathlib import Path
from research.formal_five_bt.sources import fetch_ecb_usdjpy
from research.formal_five_bt.datasets import load_fred_fx
from research.formal_five_bt.market_data import deposit_usdt
CSV=("FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,TIME_PERIOD,OBS_VALUE\n"
     "D,JPY,EUR,SP00,2025-08-08,160.00\n"
     "D,USD,EUR,SP00,2025-08-08,1.25\n"
     "D,JPY,EUR,SP00,2025-08-11,159.60\n"
     "D,USD,EUR,SP00,2025-08-11,1.20\n")
def acquire():return fetch_ecb_usdjpy(date(2025,8,8),date(2025,8,13),
    fetch=lambda url: CSV.encode())
class ECBFXFallback(unittest.TestCase):
    def test_explicit_cross_and_conservative_availability(self):
        fx=acquire()
        self.assertEqual(len(fx.observations),2)
        self.assertAlmostEqual(fx.observations[0]["rate_jpy_per_usd"],128.0)
        self.assertAlmostEqual(fx.observations[1]["rate_jpy_per_usd"],133.0)
        self.assertEqual(fx.observations[0]["source"],"ECB")
        self.assertEqual(fx.observations[0]["instrument"],"USDJPY_ECB_CROSS")
        self.assertEqual(datetime.fromtimestamp(fx.observations[0]["event_time_ms"]/1000,timezone.utc).date(),date(2025,8,8))
    def test_missing_euro_leg_never_invents_cross(self):
        raw=CSV.replace("D,USD,EUR,SP00,2025-08-11,1.20\n","")
        fx=fetch_ecb_usdjpy(date(2025,8,8),date(2025,8,12),fetch=lambda url: raw.encode())
        self.assertEqual(len(fx.observations),1)
    def test_provenance_validation_and_no_same_day_lookahead(self):
        fx=acquire()
        with tempfile.TemporaryDirectory() as temp:
            d=Path(temp)
            p=d/"normalized/ecb/USDJPY_EUR_CROSS.jsonl"
            p.parent.mkdir(parents=True)
            raw=("".join(json.dumps(x,sort_keys=True,separators=(",",":"))+"\n" for x in fx.observations)).encode()
            p.write_bytes(raw)
            m={"fx":{"status":"ACQUIRED","provider":"ECB_DAILY_CROSS_NOT_FRED",
                 "normalized_path":p.relative_to(d).as_posix(),"normalized_sha256":hashlib.sha256(raw).hexdigest()}}
            (d/"acquisition-manifest.json").write_text(json.dumps(m))
            rates,issues=load_fred_fx(d)
            self.assertEqual(len(rates),2)
            self.assertFalse(issues,issues)
            self.assertEqual(rates[0].exchange,"ECB")
            before=datetime(2025,8,8,12,0,tzinfo=timezone.utc)
            with self.assertRaisesRegex(ValueError,"no FX observation"):
                deposit_usdt(10_000,before,rates)
            on_weekend=datetime(2025,8,10,0,0,tzinfo=timezone.utc)
            deposit=deposit_usdt(10_000,on_weekend,rates)
            self.assertAlmostEqual(deposit.amount_usdt,10_000/128)
            on_11th_morning=datetime(2025,8,11,10,0,tzinfo=timezone.utc)
            self.assertAlmostEqual(deposit_usdt(10_000,on_11th_morning,rates).rate_jpy_per_usd,128)
    def test_corrupted_csv_is_rejected(self):
        with self.assertRaisesRegex(ValueError,"SCHEMA"):
            fetch_ecb_usdjpy(date(2025,1,1),date(2025,12,31),fetch=lambda url:b"day,value\n")
if __name__=="__main__":unittest.main()
