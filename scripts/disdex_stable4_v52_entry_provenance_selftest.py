"""Native V52 immutable provenance boundary, no venue operations."""
import json
import os
import unittest
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch
import disdex_v52_aster_only_legacy_engine as mod

class ProvenanceTests(unittest.TestCase):
    def engine(self):
        e=object.__new__(mod.V52AsterOnlyEngine)
        e.live=True
        e.lock=SimpleNamespace(path=Path('/var/lib/disdex/shared/account-order.lock'),_owned=lambda:{'ownerId':'owner','leaseId':'lease','accountScope':'ASTER_FUTURES'})
        return e
    def test_v50_uses_entry_features_and_actual_native_identity_before_return(self):
        e=self.engine();now=1800000000000;sha='a'*40
        expected={'strategy':'V52','positionId':'client','sourceSha':sha,'symbol':'NVDAUSDT','side':'LONG','entryTs':now,'modelVersion':'STABLE4_CAUSAL_ENTRY_FEATURES_V1','score':.01,'capturedAt':now}
        sent=[]
        def publish(*args,**kwargs):
            request=json.loads(kwargs['input']);sent.append(request)
            return SimpleNamespace(returncode=0,stdout=json.dumps(expected))
        with patch.dict(os.environ,{'DISDEX_STABLE4_MODE':'LIVE','DISDEX_RELEASE_SHA':sha},clear=False),patch.object(mod.base,'now_ms',return_value=now),patch.object(mod.subprocess,'run',side_effect=publish):
            record=e._prepare_stable4_entry_opportunity(mod.V50_SLOT,{'symbol':'NVDA','side':'BUY','basisBps':-86,'signalBasisBps':-99,'exitBasisBps':999},1,'client')
        self.assertEqual(record,expected)
        self.assertEqual(sent[0]['input']['entrySnapshot'],{'capture_basis_bps':-99,'entry_basis_bps':-86})
        self.assertEqual(sent[0]['input']['logicalEntryTs'],now)
    def test_off_and_unmodeled_v11_never_spawn_publication(self):
        e=self.engine()
        with patch.dict(os.environ,{'DISDEX_STABLE4_MODE':'OFF'}),patch.object(mod.subprocess,'run') as run:
            self.assertIsNone(e._prepare_stable4_entry_opportunity(mod.V50_SLOT,{},1,'client'));run.assert_not_called()
        with patch.dict(os.environ,{'DISDEX_STABLE4_MODE':'LIVE'}),patch.object(mod.subprocess,'run') as run:
            self.assertIsNone(e._prepare_stable4_entry_opportunity(mod.V11_SLOT,{},1,'client'));run.assert_not_called()
    def test_changed_real_lease_is_rejected_after_evidence_subprocess(self):
        e=self.engine();documents=iter([{'ownerId':'owner','leaseId':'lease','accountScope':'ASTER_FUTURES'},{'ownerId':'another','leaseId':'lease','accountScope':'ASTER_FUTURES'}]);e.lock._owned=lambda:next(documents)
        with patch.dict(os.environ,{'DISDEX_STABLE4_MODE':'LIVE','DISDEX_RELEASE_SHA':'a'*40}),patch.object(mod.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='{}')):
            with self.assertRaisesRegex(RuntimeError,'ACCOUNT_LEASE_CHANGED'):
                e._prepare_stable4_entry_opportunity(mod.V50_SLOT,{'symbol':'NVDA','side':'BUY','basisBps':-86,'signalBasisBps':-99},1,'client')

if __name__=='__main__':unittest.main()
