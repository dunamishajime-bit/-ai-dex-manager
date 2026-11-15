import hashlib,json
FAMILIES={"V4","Q102","PENGU","FET","IDLE","V52","HYPE"}
STAGES={"FEATURE_ONLY","SOURCE_CANDIDATE","RESEARCH_RULE_SELECTED","ENTRY_VERIFIED"}
class EvidenceError(ValueError): pass
def check(ok,reason):
    if not ok: raise EvidenceError(reason)
def build(rows,cutoff,manifest):
    check(type(cutoff)==int and cutoff>=0,"INVALID_CUTOFF")
    check(isinstance(rows,list) and isinstance(manifest,dict),"INVALID_INPUT")
    check(all(k in FAMILIES and isinstance(v,str) and len(v)==64 and all(c in "0123456789abcdef" for c in v) for k,v in manifest.items()),"INVALID_MANIFEST")
    output=[];seen=set()
    for row in rows:
        check(isinstance(row,dict),"INVALID_ROW")
        family=row.get("family");stage=row.get("stage");ident=row.get("id")
        check(family in FAMILIES and family in manifest,"MISSING_FAMILY_PIN")
        check(row.get("sourceSha256")==manifest[family],"SOURCE_PIN_MISMATCH")
        check(isinstance(ident,str) and bool(ident.strip()),"INVALID_ID")
        check((family,ident) not in seen,"DUPLICATE_ROW");seen.add((family,ident))
        check(stage in STAGES,"INVALID_STAGE")
        event=row.get("eventTs");available=row.get("availableAtTs")
        check(type(event)==int and type(available)==int and 0<=event<=available<=cutoff,"LOOKAHEAD_OR_FUTURE")
        for field in ("runner","symbol","sourcePath"):
            check(isinstance(row.get(field),str) and bool(row[field].strip()),"MISSING_"+field.upper())
        decision=row.get("decision")
        check(decision in ("LONG","SHORT","NONE"),"INVALID_DECISION")
        if stage=="FEATURE_ONLY":check(decision=="NONE","FEATURE_NOT_SIGNAL")
        if stage=="RESEARCH_RULE_SELECTED":check(family=="Q102" and decision=="NONE","RESEARCH_SELECTION_NOT_ENTRY")
        if stage=="ENTRY_VERIFIED":check(row.get("nativeEntryProof") is True,"ENTRY_NOT_PROVEN")
        else:check("nativeEntryProof" not in row,"UNVERIFIED_ENTRY_PROOF")
        forbidden={"orderId","fillId","fillPrice","fillQty","position","gross","pnl","realizedPnl","funding","balance","stopOrder"}
        check(not forbidden.intersection(row),"EXECUTION_FIELDS_FORBIDDEN")
        output.append({k:row[k] for k in ("id","family","runner","symbol","sourceSha256","sourcePath","stage","decision","eventTs","availableAtTs")})
    output.sort(key=lambda x:(x["availableAtTs"],x["eventTs"],x["family"],x["id"]))
    result={"schema":"bt-pr481-causal-candidate-ledger-v1","cutoffTs":cutoff,"sourceManifest":dict(sorted(manifest.items())),"observations":output,"familyCounts":{f:sum(x["family"]==f for x in output) for f in sorted(FAMILIES)},"stageCounts":{s:sum(x["stage"]==s for x in output) for s in sorted(STAGES)},"execution":{"orders":0,"fills":0,"positions":0,"gross":None,"pnl":None},"status":"SOURCE_OBSERVATION_ONLY_NOT_INTEGRATED_BT"}
    result["sha256"]=hashlib.sha256(json.dumps(result,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()).hexdigest()
    return result
if __name__=="__main__":
    import sys,pathlib
    check(len(sys.argv)==3,"USAGE_INPUT_OUTPUT")
    inp=pathlib.Path(sys.argv[1]);out=pathlib.Path(sys.argv[2])
    check(inp.resolve()!=out.resolve(),"INPUT_OUTPUT_COLLISION")
    data=json.loads(inp.read_text(encoding="utf-8"))
    result=build(data["observations"],data["cutoffTs"],data["sourceManifest"])
    out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("PASS source observations",len(result["observations"]),result["sha256"])
