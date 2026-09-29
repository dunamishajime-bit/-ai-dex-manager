import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const EXPECTED_SHA256="5029baad39bd07c9fc40ec4ba75941cb089697d5cebc437c29838cbc924f3e48";
const EXPECTED_BYTES=22234;
const EXPECTED_ROWS=63;
const EXPECTED_ROUTES={
  DOT_MOMENTUM_SHORT_BTCREL:15,
  JUP_RELATIVE_SHORT:14,
  RENDER_RELATIVE_SHORT:15,
  TAO_BREAKDOWN_SHORT_RELWEAK2:9,
  TIA_BREAKDOWN_SHORT_VOLCAP100:10,
} as const;

function parseCsv(text:string){
 const lines=text.replace(/\r/g,"").split("\n").filter(Boolean);
 if(lines.length<2) throw new Error("IDLE_EVIDENCE_EMPTY");
 const header=lines[0].split(",").map(x=>x.trim());
 const routeIndex=header.findIndex(x=>/^(route|strategy|variant)$/i.test(x));
 if(routeIndex<0) throw new Error("IDLE_EVIDENCE_ROUTE_COLUMN_MISSING");
 return lines.slice(1).map(line=>line.split(",").map(x=>x.trim())).map(cols=>({route:cols[routeIndex]}));
}

const path=process.argv[2];
if(!path) throw new Error("USAGE: tsx scripts/idle-priority-short-parity-evidence.ts <idle_candidate_filtered.csv>");
const bytes=readFileSync(path);
const sha=createHash("sha256").update(bytes).digest("hex");
if(sha!==EXPECTED_SHA256) throw new Error(`IDLE_EVIDENCE_SHA256_MISMATCH expected=${EXPECTED_SHA256} actual=${sha}`);
if(bytes.byteLength!==EXPECTED_BYTES) throw new Error(`IDLE_EVIDENCE_BYTES_MISMATCH expected=${EXPECTED_BYTES} actual=${bytes.byteLength}`);
const rows=parseCsv(bytes.toString("utf8"));
if(rows.length!==EXPECTED_ROWS) throw new Error(`IDLE_EVIDENCE_ROW_COUNT_MISMATCH expected=${EXPECTED_ROWS} actual=${rows.length}`);
const counts:Record<string,number>={};
for(const row of rows) counts[row.route]=(counts[row.route]||0)+1;
for(const [route,count] of Object.entries(EXPECTED_ROUTES)){
 if(counts[route]!==count) throw new Error(`IDLE_EVIDENCE_ROUTE_COUNT_MISMATCH route=${route} expected=${count} actual=${counts[route]||0}`);
}
const extras=Object.keys(counts).filter(x=>!(x in EXPECTED_ROUTES));
if(extras.length) throw new Error(`IDLE_EVIDENCE_UNKNOWN_ROUTES ${extras.join(",")}`);
console.log(JSON.stringify({status:"PASS",sha256:sha,bytes:bytes.byteLength,rows:rows.length,routeCounts:counts}));
