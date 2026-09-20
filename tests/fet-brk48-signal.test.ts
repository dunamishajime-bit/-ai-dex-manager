import assert from "node:assert/strict"; import test from "node:test"; import {buildFetBrk48Signal,type FetBrk48Bar} from "../lib/fet-brk48-signal";
const H=3_600_000; const base=Date.UTC(2026,0,1,0);
function bars():FetBrk48Bar[]{return Array.from({length:73},(_,i)=>({openTs:base+i*H,closeTs:base+(i+1)*H-1,open:1,high:1.1,low:.9,close:1,volume:100}));}
test("BRK48 uses previous completed H1 at entry hour%4==1",()=>{const b=bars(); b[72]={...b[72],close:1.2,high:1.21,volume:121}; const entry=base+73*H; assert.equal(new Date(entry).getUTCHours()%4,1); const s=buildFetBrk48Signal(b,entry+1000); assert.ok(s); assert.equal(s?.entryTs,entry); assert.equal(s?.referenceTs,b[72].closeTs); assert.equal(s?.prior48hHigh,1.1); assert.ok((s?.volumeRatio||0)>=1.2);});
test("no lookahead and threshold gates",()=>{const b=bars(); b[72]={...b[72],close:1.2,high:1.21,volume:119}; const entry=base+73*H; assert.equal(buildFetBrk48Signal(b,entry+1000),undefined); const future={...b[72],openTs:entry,closeTs:entry+H-1,close:2,high:2,volume:999}; assert.equal(buildFetBrk48Signal([...b,future],entry+1000),undefined);});

test("late entry window is rejected instead of chasing the H1 open",()=>{const b=bars(); b[72]={...b[72],close:1.2,high:1.21,volume:121}; const entry=base+73*H; assert.ok(buildFetBrk48Signal(b,entry+1000)); assert.equal(buildFetBrk48Signal(b,entry+5*60_000+1),undefined);});
