import json,unittest,collections,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parent
def data(name):return json.loads((ROOT/name).read_text(encoding="utf8"))
class FETIDLEPinned(unittest.TestCase):
 def test_fet_source_11(self):
  x=data("P107_FET_PIN_NATIVE_ONE_YEAR_11_ENTRY_PARITY_20261123.json")
  self.assertEqual((x["oldCount"],x["newNativeCount"],x["oldOnly"],x["newOnly"],x["featuresPriceMismatches"]),(11,11,0,0,0))
  self.assertFalse(x["fullP107STABLE4Parity"])
 def test_idle_legacy_183_repro(self):
  x=data("P107_IDLE_LEGACY_80BAR_WARMUP_183_EXACT_REPLAY_20261123.json")
  self.assertEqual((x["oldCount"],x["nativeAcceptedCount"],x["oldOnly"],x["newOnly"],x["featureMismatchCount"]),(183,183,0,0,0))
 def test_idle_fixed_184_extra_one_JUP(self):
  x=data("P107_IDLE_PIN_NATIVE_FIVE_SYMBOL_1Y_183_SIGNAL_COMPARISON_20261123.json")
  self.assertEqual((x["oldCount"],x["nativeAcceptedCount"],x["oldOnly"],x["newOnly"],x["featureMismatchCount"]),(183,184,0,1,0))
  self.assertEqual((x["newOnlySamples"][0]["symbol"],x["newOnlySamples"][0]["signalTs"]),("JUPUSDT",1768240800000))
 def test_corrected_tape_is_184_not_live(self):
  x=data("P107_FET11_IDLE184_PINNED_SOURCE_CORRECTION_VERDICT_20261123.json")
  p=ROOT/x["IDLE"]["correctedRawTapeFile"]
  self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),x["IDLE"]["correctedRawTapeSHA256"])
  events=[json.loads(l) for l in p.read_text(encoding="utf8").splitlines() if l]
  self.assertEqual(len(events),184)
  self.assertEqual(collections.Counter(e["symbol"] for e in events),{"JUPUSDT":59,"RENDERUSDT":45,"TIAUSDT":35,"TAOUSDT":29,"DOTUSDT":16})
  self.assertEqual(x["actualVenueOrders"],0)
  self.assertFalse(x["fullP107STABLE4AccountParity"])
if __name__=="__main__":unittest.main()
