"""V4 Y06 source chronology / episode non-IID fail-closed synthetic tests."""
import copy,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from bt_hp_v4_y06_direction_episode_audit import (
    audit_breadth,audit_episodes,build,EXPECTED_SHA,
)
def breadth():
    split={
      "train":{"n":211,"wrong":39,"wrong_rate":39/211,
          "first_utc":"2025-10-05T02:00:00+00:00","last_utc":"2026-06-15T00:00:00+00:00"},
      "validation":{"n":70,"wrong":33,"wrong_rate":33/70,
          "first_utc":"2026-06-15T10:00:00+00:00","last_utc":"2026-08-24T18:00:00+00:00"},
      "test":{"n":71,"wrong":48,"wrong_rate":48/71,
          "first_utc":"2026-08-24T20:00:00+00:00","last_utc":"2026-09-23T14:00:00+00:00"},
    }
    model={"accepted":False,"splits":{
       "train":{"roc_auc":.66},
       "validation":{"roc_auc":.33,"harmful_flips":5,"beneficial_flips":0,"flags":5},
       "unseen_test":{"roc_auc":.65}}}
    return {"status":"UNRESOLVED_DATA_OR_SEPARATION","route":"REC_Y06_REV_D0_T72",
        "source_runtime_sha":EXPECTED_SHA,"events":352,"unique_entry_hours":280,
        "native_side":"SHORT","wrong_native_by_split":split,
        "closed_h1_feature_parity":{"checked_events":352,"comparisons":2816,
          "live_bar_used":False,"universe_excludes_btc":True,
          "max_abs_error_by_feature":{"breadth_pos12":0.0}},
        "strict_72h_purge":{"train_fit_n":208,"validation_calibration_n":54},
        "models":{"native_entry_only":model}}
def episodes():
    allrows=[];index=0
    for i in range(31):
       count=11 if i<30 else 22
       vals=.1 if i<15 else -.1 if i<29 else 0.
       allrows.append({"start":index,"end":index+count-1,
          "n":count,"members":list(range(index,index+count)),
          "h60_delta_sum":vals})
       index+=count
    assert index==352
    return {"study":"Y06 non-IID exposure episodes, descriptive regime shifts",
         "events":352,"matched_feature_rows":352,"episodes":allrows,
         "episode_bootstrap":{"episode_count":31,
            "episode_positive":15,"episode_negative":14,"episode_zero":2,
            "total_route_60h_delta_sum":.1,
            "resampled_total_ci95_raw_return_sum":[-.8,1.0]},
         "split_crossing_episodes":[{},{}]}
class Y06DirectionEpisodesTests(unittest.TestCase):
 def test_native_research_has_chronological_label_drift(self):
    result=audit_breadth(breadth())
    self.assertGreater(result["wrongDirectionProxyTrainToTestPctPoints"],45)
    self.assertEqual(result["targetYearSelectedRule"],None)
 def test_future_bar_feature_leakage_rejected(self):
    x=breadth();x["closed_h1_feature_parity"]["live_bar_used"]=True
    with self.assertRaisesRegex(ValueError,"FEATURE_CLOSED_H1_PARITY_FAILED"):
      audit_breadth(x)
 def test_prohibited_gate_promotion_rejected(self):
    x=breadth();x["models"]["native_entry_only"]["accepted"]=True
    with self.assertRaisesRegex(ValueError,"UNSUPPORTED_GATE_PROMOTED"):
      audit_breadth(x)
 def test_bad_wrong_direction_counts_rejected(self):
    x=breadth();x["wrong_native_by_split"]["test"]["wrong_rate"]=.01
    with self.assertRaisesRegex(ValueError,"SPLIT_METRICS_DRIFT"):
      audit_breadth(x)
 def test_31_episodes_account_all_352_events(self):
    x=audit_episodes(episodes())
    self.assertEqual(x["exposureEpisodes"],31)
    self.assertTrue(x["episodeBootstrapIsNOTIndependentOOS"])
 def test_duplicate_episode_events_rejected(self):
    x=episodes()
    x["episodes"][1]["members"]=x["episodes"][0]["members"]
    with self.assertRaisesRegex(ValueError,"MEMBER_DUPLICATED"):
      audit_episodes(x)
 def test_episode_ci_not_crossing_zero_is_not_robust(self):
    x=episodes();x["episode_bootstrap"]["resampled_total_ci95_raw_return_sum"]=[.1,.8]
    with self.assertRaisesRegex(ValueError,"BOOTSTRAP_CONFIDENCE_INCORRECT"):
      audit_episodes(x)
 def test_research_insufficient_for_live_change(self):
    x=build(breadth(),episodes())
    self.assertFalse(x["independentForwardMarketPerformanceCertified"])
    self.assertFalse(x["v4CurrentCodexLivePinCertified"])
    self.assertEqual(x["productionMutations"],0)
if __name__=="__main__":unittest.main()
