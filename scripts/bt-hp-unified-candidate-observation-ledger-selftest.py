import importlib.util,hashlib,copy,pathlib,sys
sys.dont_write_bytecode=True
p=pathlib.Path(__file__).with_name("bt-hp-unified-candidate-observation-ledger.py")
spec=importlib.util.spec_from_file_location("ledger",p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
pin=hashlib.sha256(b"engineered-fixture-not-live").hexdigest()
manifest={f:pin for f in m.FAMILIES}
rows=[dict(id=f+"-fixture",family=f,runner=f,symbol="TEST",sourceSha256=pin,sourcePath="fixtures/offline",stage="FEATURE_ONLY",decision="NONE",eventTs=100+i,availableAtTs=110+i) for i,f in enumerate(sorted(m.FAMILIES))]
rows.append(dict(rows[0],id="q102-monthly",family="Q102",runner="Q102",stage="RESEARCH_RULE_SELECTED"))
r=m.build(rows,200,manifest)
assert len(r["observations"])==8 and all(r["familyCounts"].values())
assert r["sha256"]==m.build(list(reversed(rows)),200,manifest)["sha256"]
assert r["execution"]["orders"]==r["execution"]["fills"]==0
def reject(update,reason):
    v=copy.deepcopy(rows);update(v)
    try:m.build(v,200,manifest)
    except m.EvidenceError as e:assert str(e)==reason,(str(e),reason)
    else:raise AssertionError("accepted "+reason)
reject(lambda x:x[0].update(availableAtTs=201),"LOOKAHEAD_OR_FUTURE")
reject(lambda x:x[0].update(availableAtTs=99),"LOOKAHEAD_OR_FUTURE")
reject(lambda x:x[0].update(sourceSha256="0"*64),"SOURCE_PIN_MISMATCH")
reject(lambda x:x[0].update(fillPrice=1),"EXECUTION_FIELDS_FORBIDDEN")
reject(lambda x:x[0].update(pnl=1),"EXECUTION_FIELDS_FORBIDDEN")
reject(lambda x:x[0].update(decision="LONG"),"FEATURE_NOT_SIGNAL")
reject(lambda x:x[0].update(stage="ENTRY_VERIFIED",decision="LONG"),"ENTRY_NOT_PROVEN")
reject(lambda x:x[0].update(stage="RESEARCH_RULE_SELECTED"),"RESEARCH_SELECTION_NOT_ENTRY")
reject(lambda x:x[1].update(id=x[0]["id"],family=x[0]["family"]),"DUPLICATE_ROW")
reject(lambda x:x[0].update(sourcePath=""),"MISSING_SOURCEPATH")
reject(lambda x:x[0].update(nativeEntryProof=True),"UNVERIFIED_ENTRY_PROOF")
print("PASS BT-481-H 7 families deterministic ledger 11 fail-closed checks zero fills")
