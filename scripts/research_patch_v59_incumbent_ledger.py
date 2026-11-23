from pathlib import Path

TARGET = Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src = TARGET.read_text()

needle = '  await fs.mkdir(OUTPUT_DIR,{recursive:true});\n  await fs.writeFile(path.join(OUTPUT_DIR,"v59-result.json"),JSON.stringify(resultPayload,null,2)+"\\n","utf8");'
insert = r'''  const incumbentV57Normal=replay(rows,funding,{mode:"normal",longMode:"V57_REGIME72_BREAKOUT"}).trades;
  const incumbentV57Stress=replay(rows,funding,{mode:"stress",longMode:"V57_REGIME72_BREAKOUT"}).trades;
  const incumbentV57LedgerPayload={
    ...ledgerPayload,
    longVariant:"PENGU_DUAL_LS_V2_FINAL_V57_REGIME72_BREAKOUT",
    researchCandidate:{promoted:false,longMode:"V57_REGIME72_BREAKOUT",shortVeto:null,diagnosticsSchema:"pengu-v59-incumbent-v57/v1"},
    integrity:{
      noOverlap:incumbentV57Normal.every((t,i)=>i===0||t.entryTs>incumbentV57Normal[i-1].exitTs),
      maximumRequestedGross:Math.max(...incumbentV57Normal.map((t)=>t.requestedGross)),
    },
    modes:{
      normal:{metrics:metrics(incumbentV57Normal),trades:incumbentV57Normal.map(publicTrade)},
      stress:{metrics:metrics(incumbentV57Stress),trades:incumbentV57Stress.map(publicTrade)},
    },
  };
  assert.equal(incumbentV57LedgerPayload.integrity.noOverlap,true);
  await fs.mkdir(OUTPUT_DIR,{recursive:true});
  await fs.writeFile(path.join(OUTPUT_DIR,"incumbent-v57-pengu-ledger.json"),JSON.stringify(incumbentV57LedgerPayload,null,2)+"\n","utf8");
  await fs.writeFile(path.join(OUTPUT_DIR,"v59-result.json"),JSON.stringify(resultPayload,null,2)+"\n","utf8");'''

if needle not in src:
    raise SystemExit('V59 output marker missing')
src = src.replace(needle, insert, 1)
TARGET.write_text(src)
print(f'PATCHED_V59_INCUMBENT={TARGET} bytes={TARGET.stat().st_size}')
