"""Source-anchored one-hour ASTER incremental / HL XYZ snapshots L2 hypothesis.

Only privately stored, exact-SHA third-party AMZN 2026-09-02 16 UTC files.
ASTER requires prior full snapshot and contiguous declared update IDs, deletes
price levels at qty zero, skips identical double-received snapshots and
invalidates after any unexpected update. HL is 20/20 snapshot-only. Samples
1-second no-lookahead quote availability and 1500ms recency as a necessary
native V52 predicate. NO maker/hedge execution, native decision or true fills.
"""
from __future__ import annotations
from bisect import bisect_right
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from pathlib import Path
import json
import sys

ROOT=Path(__file__).resolve().parents[2]
PROFILE='docs/research/STABLE4_V52_PUBLIC_PAIRED_ONEHOUR_L2_PROFILE_20261128.json'
PROFILE_PIN='59cd3a3008c8a7a465750ae5109767e39418d083487290929b027ec558590860'
SEQUENCE='docs/research/STABLE4_V52_PAIRED_ONEHOUR_L2_SEQUENCE_QUALITY_20261128.json'
SEQUENCE_PIN='f878a19d0174ab655fe772641c78bffe3ec61cbd67bef67d168a60935d4366f8'
ENGINE='scripts/disdex_v13d_v11eq_stock_live_engine.py'
ENGINE_PIN='e1c6f16b5deb514fa636c44a859294fec8ee8f81e0dac3ef405cd55a3056a9d8'
START=1788364800000000000
NS=1_000_000_000
AGE_NS=1_500_000_000

class StrictBook:
    def __init__(self):
        self.bids={}
        self.asks={}
        self.seq=None
        self.valid=False
        self.last_received=None
        self.reset_count=0
        self.applied_packets=0
        self.duplicate_snapshot_receipts=0
        self.zero_qty_deletions=0
        self.missing_delete_updates=0
        self.sequence_rejections=0
        self.old_delta_packets_skipped=0
        self.crossed_packets=0
        self.invalidated_packets=0
        self.snapshot_identical_twins=0
        self._last_snapshot_fingerprint={}
    def _levels(self,rows):
        seen=set()
        records=[]
        for row in rows:
            t,event,first,last,previous,sequence,side,raw_price,raw_qty=row
            if side not in ('bid','ask'):
                raise ValueError('BOOK_SIDE_UNKNOWN')
            try:
                price,qty=Decimal(str(raw_price)),Decimal(str(raw_qty))
            except (InvalidOperation,TypeError):
                raise ValueError('NONNUMERIC_L2_PRICE_OR_QUANTITY')
            if not price.is_finite() or price<=0 or not qty.is_finite() or qty<0:
                raise ValueError('NEGATIVE_OR_NONFINITE_L2_LEVEL')
            key=(side,price)
            if key in seen:raise ValueError('DUPLICATE_L2_PRICE_IN_RECEIPT_PACKET')
            seen.add(key)
            records.append((side,price,qty))
        return records
    def _crossed(self):
        return not self.bids or not self.asks or max(self.bids)>=min(self.asks)
    def snapshot(self,t,rows):
        ids={r[5] for r in rows}
        if len(ids)!=1 or any(r[1]!='snapshot' for r in rows):
            raise ValueError('SNAPSHOT_MIXED_ID_OR_EVENT')
        sequence=next(iter(ids))
        if sequence is None:raise ValueError('SNAPSHOT_SEQUENCE_ID_MISSING')
        levels=self._levels(rows)
        if any(q==0 for _,_,q in levels):raise ValueError('ZERO_QUANTITY_IN_FULL_SNAPSHOT')
        fingerprint=tuple(sorted(levels))
        if sequence in self._last_snapshot_fingerprint:
            if self._last_snapshot_fingerprint[sequence]!=fingerprint:
                raise ValueError('DUPLICATE_SNAPSHOT_ID_CHANGED_PAYLOAD')
            self.duplicate_snapshot_receipts+=1
            self.snapshot_identical_twins+=1
            if sequence!=self.seq:
                raise ValueError('DUPLICATE_OUT_OF_ORDER_SNAPSHOT_ID')
            self.last_received=t
            return 'DUPLICATE_IDENTICAL_SNAPSHOT'
        self._last_snapshot_fingerprint[sequence]=fingerprint
        self.bids={p:q for s,p,q in levels if s=='bid'}
        self.asks={p:q for s,p,q in levels if s=='ask'}
        self.seq=sequence
        self.last_received=t
        self.reset_count+=1
        self.valid=not self._crossed()
        if not self.valid:self.crossed_packets+=1
        return 'FRESH_REINITIALIZED_SNAPSHOT'
    def update(self,t,rows):
        ids={(r[2],r[3],r[4]) for r in rows}
        if len(ids)!=1 or any(r[1]!='update' for r in rows):
            raise ValueError('DELTA_PACKET_IDS_INCONSISTENT')
        first,last,previous=next(iter(ids))
        if any(x is None or not isinstance(x,int) for x in (first,last,previous)) or first>last or previous>=last:
            raise ValueError('INVALID_DELTA_UPDATE_ID_ORDER')
        if not self.valid:
            self.invalidated_packets+=1
            return 'INVALID_PENDING_NEW_SNAPSHOT'
        # Published REST snapshot can arrive alongside a historical old update
        # whose final_update_id is exactly the already-applied snapshot ID.
        # An older/equal delta cannot be replayed AGAIN over the snapshot.
        if last<=self.seq:
            self.old_delta_packets_skipped+=1
            self.invalidated_packets+=1
            return 'OLDER_OR_EQUAL_DELTA_SUPERSEDED_BY_SNAPSHOT'
        if previous!=self.seq:
            self.valid=False
            self.sequence_rejections+=1
            self.invalidated_packets+=1
            return 'DELTA_SEQUENCE_MISMATCH_WAIT_FOR_SNAPSHOT'
        levels=self._levels(rows)
        for side,price,qty in levels:
            target=self.bids if side=='bid' else self.asks
            if qty==0:
                self.zero_qty_deletions+=1
                if price not in target:self.missing_delete_updates+=1
                target.pop(price,None)
            else:target[price]=qty
        self.seq=last
        self.last_received=t
        self.applied_packets+=1
        if self._crossed():
            self.crossed_packets+=1
            self.valid=False
            self.invalidated_packets+=1
            return 'REBUILT_SOURCE_BOOK_CROSSED_INVALID'
        return 'CONTIGUOUS_DELTA_APPLIED'
    def quote(self):
        if not self.valid:return None
        if self._crossed():raise ValueError('INTERNALLY_CROSSED_WHEN_VALID')
        bid=max(self.bids);ask=min(self.asks)
        return bid,ask


def run(data_root,reader_root):
    for p,h in ((PROFILE,PROFILE_PIN),(SEQUENCE,SEQUENCE_PIN),(ENGINE,ENGINE_PIN)):
        if sha256((ROOT/p).read_bytes()).hexdigest()!=h:raise ValueError('SOURCE_PIN_CHANGED:'+p)
    if not data_root.resolve().is_relative_to(Path.home().resolve()) or not reader_root.resolve().is_relative_to(Path.home().resolve()):
        raise ValueError('OWNER_RESEARCH_DATA_ROOT_REQUIRED')
    profile=json.loads((ROOT/PROFILE).read_bytes())
    old_quality=json.loads((ROOT/SEQUENCE).read_bytes())
    if profile.get('orderAuthority') is not False or old_quality.get('orderAuthority') is not False:
        raise ValueError('SOURCE_PROFILE_LIVE_AUTHORITY_FORBIDDEN')
    sys.path.insert(0,str(reader_root))
    import duckdb
    db=duckdb.connect(':memory:')
    source={}
    for market in ('ASTER','HYPERLIQUID_XYZ'):
        f=profile['files'][market]
        path=data_root/f['localFilename']
        if not path.is_file() or sha256(path.read_bytes()).hexdigest()!=f['sha256']:
            raise ValueError('PRIVATE_L2_SOURCE_SHA_CHANGED:'+market)
        source[market]=str(path)
    raw=db.execute('''SELECT received_time,event_type,first_update_id,final_update_id,
      prev_final_update_id,last_update_id,side,price,quantity
      FROM read_parquet(?) ORDER BY received_time,event_type,side,price''',[source['ASTER']]).fetchall()
    if len(raw)!=profile['profile']['ASTER']['rows']:
        raise ValueError('SOURCE_ASTER_ROW_COUNT_MISMATCH')
    packs=defaultdict(list)
    for row in raw:
        if not START<=row[0]<START+3600*NS:raise ValueError('ASTER_SAMPLE_CLOCK_NOT_IN_HOUR')
        packs[row[0]].append(row)
    # Validate source-level repeated snapshots independently of book reset policy.
    # A snapshot+delta with identical received_time has no provable ordering.
    # Even if event_time differs, it is not a source guarantee of complete
    # websocket order, therefore QUARANTINE until another clean snapshot.
    grouped_source_snapshots=defaultdict(list)
    for t,rows in sorted(packs.items()):
        snaps=[row for row in rows if row[1]=='snapshot']
        if snaps:
            fingerprint=tuple(sorted((row[6],row[7],row[8]) for row in snaps))
            ids={row[5] for row in snaps}
            if len(ids)!=1:raise ValueError('RECEIPT_HAS_MULTIPLE_SNAPSHOT_IDS')
            grouped_source_snapshots[next(iter(ids))].append((t,fingerprint))
    if len(grouped_source_snapshots)!=19 or any(len(v)!=2 or v[0][1]!=v[1][1] for v in grouped_source_snapshots.values()):
        raise ValueError('19_DOUBLE_RECEIVED_SNAPSHOT_PAYLOADS_NOT_IDENTICAL')
    ambiguous_clock_count=sum(len({r[1] for r in rows})>1 for rows in packs.values())
    if ambiguous_clock_count!=12:raise ValueError('MIXED_SOURCE_CLOCK_GRAIN_CHANGED')
    def apply_packet(b,t,rows):
        kinds={r[1] for r in rows}
        if len(kinds)!=1:
            # Do not infer a sequence within one identical received timestamp.
            # Exactly one update packet at each mixed source clock.
            delta=[r for r in rows if r[1]=='update']
            snaps=[r for r in rows if r[1]=='snapshot']
            if not delta or not snaps or len({(r[2],r[3],r[4]) for r in delta})!=1:
                raise ValueError('MIXED_SOURCE_CLOCK_PACKET_GRAIN_UNKNOWN')
            b.valid=False
            b.invalidated_packets+=1
            return 'MIXED_SNAPSHOT_AND_DELTA_SAME_CLOCK_FAIL_CLOSED'
        return b.snapshot(t,rows) if 'snapshot' in kinds else b.update(t,rows)
    book=StrictBook();event_counts=Counter();events=[]
    for t,rows in sorted(packs.items()):
        status=apply_packet(book,t,rows)
        if status=='FRESH_REINITIALIZED_SNAPSHOT':
            events.append({'type':'SOURCE_SNAPSHOT_RESET','receivedNs':t,'sequenceId':book.seq,
               'levels':len(rows),'crossed':not book.valid})
        event_counts[status]+=1
    if (book.reset_count!=19 or book.duplicate_snapshot_receipts!=7
        or event_counts['MIXED_SNAPSHOT_AND_DELTA_SAME_CLOCK_FAIL_CLOSED']!=12
        or book.applied_packets+book.invalidated_packets!=old_quality['aster']['deltaPackets']
        or book.crossed_packets<0):
        raise ValueError('SOURCE_NATIVE_BOOK_HYPOTHESIS_RECONCILIATION_FAILED')
    # Recalculate time-aligned quote state as-of each second using packet ingestion order.
    # Must never use a future event. Re-run separate state due to offline archive.
    xraw=db.execute('''SELECT received_time,last_update_id,side,price,quantity,event_type
       FROM read_parquet(?) ORDER BY received_time,side,price''',[source['HYPERLIQUID_XYZ']]).fetchall()
    hx=defaultdict(list)
    for t,seq,side,price,qty,event in xraw:
        if event!='snapshot':raise ValueError('XYZ_NON_SNAPSHOT_EVENT_UNSUPPORTED')
        hx[t].append((seq,side,price,qty))
    if len(hx)!=old_quality['hyperliquidXyz']['distinctSnapshots']:
        raise ValueError('XYZ_SOURCE_RECEIPT_COUNT_DRIFT')
    xyz=[]
    for t,rows in sorted(hx.items()):
        if len(rows)!=40 or sum(side=='bid' for _,side,_,_ in rows)!=20:
            raise ValueError('XYZ_FULL_20_BID_20_ASK_MISSING')
        if len({s for s,_,_,_ in rows})!=1:raise ValueError('XYZ_SNAPSHOT_ID_CONFLICT')
        bids=[Decimal(price) for seq,side,price,qty in rows if side=='bid' and Decimal(qty)>0]
        asks=[Decimal(price) for seq,side,price,qty in rows if side=='ask' and Decimal(qty)>0]
        if not bids or not asks or max(bids)>=min(asks):raise ValueError('XYZ_CROSSED_SNAPSHOT')
        xyz.append((t,max(bids),min(asks)))
    # Timestamp keyed state snapshots and forward fill as-of one-second clock;
    # never increase availability before the first source snapshot (16:15:20).
    states=[];book=StrictBook();snapshot_events=[]
    for t,rows in sorted(packs.items()):
        status=apply_packet(book,t,rows)
        if status in ('FRESH_REINITIALIZED_SNAPSHOT','DUPLICATE_IDENTICAL_SNAPSHOT'):
            snapshot_events.append(status)
        q=book.quote()
        states.append((t,q))
    if len(states)!=len(packs) or len(states)!=profile['profile']['ASTER']['distinctReceivedClocks']:
        raise ValueError('SOURCE_SOURCE_CLOCK_GRAIN_UNVERIFIED')
    ats=[x[0] for x in states];hts=[x[0] for x in xyz]
    stats=Counter();per_minute=[];some_valid=[];longest_unavailable=0;current_unavailable=0
    for minute in range(60):
        bucket=Counter()
        for sec in range(minute*60,(minute+1)*60):
            t=START+sec*NS
            i=bisect_right(ats,t)-1;j=bisect_right(hts,t)-1
            a_age=t-ats[i] if i>=0 else None
            h_age=t-hts[j] if j>=0 else None
            a_valid=i>=0 and states[i][1] is not None
            x_valid=j>=0
            a_fresh=a_valid and a_age<=AGE_NS
            x_fresh=x_valid and h_age<=AGE_NS
            both=bool(a_fresh and x_fresh)
            if a_valid:bucket['asterStateAvailable']+=1
            if a_fresh:bucket['asterStateFresh']+=1
            if x_fresh:bucket['xyzSnapshotFresh']+=1
            if both:
                bucket['pairedSourceFreshState']+=1
                a=states[i][1];h=xyz[j]
                if a is None:raise ValueError('SOURCE_BOOK_FUTURE_QUOTE')
                if len(some_valid)<4:
                    some_valid.append({'sec':sec,'asterBid':str(a[0]),'asterAsk':str(a[1]),
                     'xyzBid':str(h[1]),'xyzAsk':str(h[2]),
                     'asterSourceAgeMs':a_age/1e6,'xyzSourceAgeMs':h_age/1e6})
                current_unavailable=0
            else:
                current_unavailable+=1
                longest_unavailable=max(longest_unavailable,current_unavailable)
        per_minute.append({'minuteUtc':minute,**{k:bucket[k] for k in ('asterStateAvailable','asterStateFresh','xyzSnapshotFresh','pairedSourceFreshState')}})
        stats.update(bucket)
    if stats['pairedSourceFreshState']>stats['xyzSnapshotFresh'] or stats['pairedSourceFreshState']>stats['asterStateFresh']:
        raise ValueError('SOURCE_STATE_FRESHNESS_INTERSECTION_ERROR')
    return {
      'schema':'stable4-v52-public-l2-aster-book-hypothesis-xyz-paired-1h/v1',
      'status':'SOURCE_ONLY_RECONSTRUCTION_HYPOTHESIS_NOT_V52_NATIVE_BOOK_OR_FILLS',
      'sourceHourlyProfileSha256':PROFILE_PIN,'sourceSequenceQualitySha256':SEQUENCE_PIN,
      'nativeV52EngineSha256':ENGINE_PIN,'sampleHourUtc':'2026-09-02T16:00:00Z',
      'reconstructionAssumptions':[
        'Each ASTER update packet shares receive_clock and first/final/previous IDs, and price/quantity levels are ABSOLUTE replacements by (side, price); qty=0 deletes.',
        'An ASTER full snapshot resets the local test book to exactly the published nonzero levels with its last_update_id. Nineteen repeated-snapshot-ID pairs must be identical; identical receipts are skipped only when not mixed with a delta at the same timestamp.',
        'Twelve source received_time clocks have BOTH snapshot and delta rows. Without a demonstrated within-timestamp feed order, mark the reconstructed book invalid until a later clean full snapshot; never resolve ambiguous order by guessing.',
        'Any delta with final_update_id <= current snapshot/update ID is stale and skipped (never applied twice); any unexpected delta prev_final_update_id or crossed/missing best side invalidates until an independent full snapshot.',
        'Hyperliquid XYZ snapshot of 20 bid and 20 ask absolute rows is usable only as-of that snapshot receipt clock. Both source books must have age <= 1500 ms, not native live venue websocket latency.',
      ],
      'sourceRowCount':{'ASTER':len(raw),'HYPERLIQUID_XYZ':len(xraw)},
      'asterDeltaReceivedPackets':old_quality['aster']['deltaPackets'],
      'asterFullSnapshotResets':book.reset_count,'asterIdenticalDuplicateSnapshotReceiptsProcessed':book.duplicate_snapshot_receipts,
      'asterSourceIdenticalSnapshotIdPairs':len(grouped_source_snapshots),
      'asterMixedSnapshotAndDeltaSameReceivedClocksQuarantined':ambiguous_clock_count,
      'asterAppliedDeltaPackets':book.applied_packets,'asterInvalidatedOrDiscardedDeltaPackets':book.invalidated_packets,
      'asterSequenceRejections':book.sequence_rejections,
      'asterOldOrEqualDeltaPacketsSkippedAfterSnapshot':book.old_delta_packets_skipped,
      'asterZeroQuantityLevelDeletes':book.zero_qty_deletions,
      'asterUnknownExistingPriceDeletes':book.missing_delete_updates,
      'asterCrossedOrMissingSidePackets':book.crossed_packets,
      'asterFirstValidSnapshotReceivedNs':next((t for t,rows in sorted(packs.items()) if rows[0][1]=='snapshot'),None),
      'hyperliquidFullSnapshots':len(xyz),'secondsChecked':3600,
      'oneSecondSourceConditionCounts':dict(stats),
      'oneSecondSourceConditionPct':{k:round(v/36,6) for k,v in stats.items()},
      'longestPairedSourceUnavailableSeconds':longest_unavailable,
      'perMinute':per_minute,'sampleObservationsNotNativeBasis':some_valid,
      'orderAuthority':False,'nativeV52BookParityProven':False,'actualVenueOrdersOrFillsProven':False,
      'fullAnnualTwoVenueFiveStockReconstructionProven':False,'sharedSevenRunnerAnnualBtComplete':False,
      'productionEligible':False,
      'limitations':[
       'This is a **hypothesis** of third-party absolute L2 event semantics, not publisher exchange-source official state validation or native V52 V11EQ 2s/30s reference and hedge reconstruction.',
       'Updates before the first ASTER snapshot are deliberately discarded; gaps, mixed-timestamp snapshot+delta or crossed books invalidate until a new clean snapshot. No 1-hour coverage claim before the first valid book.',
       'Use only private locally SHA-pinned source data; no new HTTP/network, credentials, trading or production mutation.',
       'No spread-based synthetic PnL, no maker queue, short locate, slippage/fees/funding, actual signed order lifecycle, resident stops, cumulative account DD or Owner approval.',
      ],
    }

if __name__=='__main__':
    if len(sys.argv)!=4:raise ValueError('PRIVATE_L2_ROOT ISOLATED_DUCKDB_PATH NEW_REPORT_OUTPUT_REQUIRED')
    report=run(Path(sys.argv[1]),Path(sys.argv[2]))
    with open(sys.argv[3],'x',encoding='utf8',newline='\n') as f:
        json.dump(report,f,indent=2,sort_keys=True);f.write('\n')
    print('L2_SOURCE_BOOK_HYPOTHESIS',json.dumps({
      k:report[k] for k in ('asterFullSnapshotResets','asterIdenticalDuplicateSnapshotReceiptsProcessed',
       'asterAppliedDeltaPackets','asterInvalidatedOrDiscardedDeltaPackets',
       'asterSequenceRejections','asterOldOrEqualDeltaPacketsSkippedAfterSnapshot','asterZeroQuantityLevelDeletes',
       'asterUnknownExistingPriceDeletes','asterCrossedOrMissingSidePackets',
       'oneSecondSourceConditionCounts')},sort_keys=True),flush=True)
