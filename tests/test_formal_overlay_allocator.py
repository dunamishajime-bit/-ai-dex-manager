import unittest
from test_formal_core_live_ownership import OwnershipReplayTest


class OverlayAllocatorTest(OwnershipReplayTest):
    def overlay(self, role, entry, exit, index=2, selected=True):
        r=self.candidate(role,entry,exit,index=index)
        r.update(overlay_role=role,requested_gross=1.,route='TEST',generic_accepted=True,
                 route_selected=selected,overlay_source_current=True)
        return r

    def test_idle_rejected_by_current_core_signal_even_if_core_cannot_enter(self):
        c=self.candidate('V12',1,3); c['requested_gross']=0.
        r=self.replay([c,self.overlay('IDLE',1,4)])
        self.assertEqual(r['rejected_entries'].get('IDLE:CORE_SIGNAL_OR_POSITION'),1)

    def test_idle_does_not_preempt_core(self):
        r=self.replay([self.candidate('V12',1,5),self.overlay('IDLE',2,4)])
        self.assertEqual(r['closed_trades'],1)
        self.assertEqual(r['trade_rows'][0]['exit_ts_ms'],self.t+5*self.h)

    def test_later_core_does_not_preempt_idle(self):
        r=self.replay([self.overlay('IDLE',1,6,index=1),self.candidate('V12',2,4,index=2)])
        self.assertEqual(r['closed_trades'],1)
        self.assertEqual(r['trade_rows'][0]['exit_ts_ms'],self.t+6*self.h)

    def test_residual_is_whole_position_released_to_core(self):
        r=self.replay([self.overlay('RESIDUAL',1,6,index=1),self.candidate('V12',2,4,index=2)])
        self.assertEqual(r['closed_trades'],2)
        self.assertEqual(r['trade_rows'][0]['exit_ts_ms'],self.t+2*self.h)
        self.assertEqual(r['trade_rows'][0]['accepted_gross'],1.)

    def test_generic_long_advances_lifecycle_without_creating_trade(self):
        r=self.replay([self.overlay('IDLE',1,3,index=1,selected=False),self.overlay('IDLE',2,4)])
        self.assertEqual(r['closed_trades'],0)
        self.assertEqual(r['rejected_entries'].get('IDLE:GENERIC_LIFECYCLE_ACTIVE'),1)

    def test_unknown_overlay_source_is_fail_closed(self):
        c=self.overlay('IDLE',1,3);c['overlay_source_current']=False
        r=self.replay([c])
        self.assertEqual(r['closed_trades'],0)
        self.assertEqual(r['rejected_entries'].get('IDLE:SOURCE_INCOMPLETE'),1)

    def test_generic_lifecycle_not_only_filled_trade_blocks_idle_priority(self):
        from scripts.research.formal_core_live_ownership import prepare_overlay_batch
        active={1:{'strategy_id':'RESIDUAL','symbol':'AVAXUSDT','entry_ts_ms':self.t}}
        idle=self.overlay('IDLE',2,4); lifecycle={'DOGEUSDT':self.t+13*self.h}
        def close(pid,ts,price,reason):active.pop(pid)
        prepare_overlay_batch([idle],active,[],self.t+2*self.h,lambda s,t:100.,
                              lambda:10000.,lambda p,e:1.,close,lifecycle)
        self.assertIn(1,active)


if __name__=='__main__':unittest.main()
