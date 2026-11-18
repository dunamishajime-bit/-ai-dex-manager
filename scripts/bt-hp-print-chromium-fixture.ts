import fs from "node:fs";
import path from "node:path";
import {createH48ResearchReplay} from "../lib/bt-verification/h48-research-sandbox";
import {buildPrintableBtReport} from "../lib/bt-verification/print-report";
const out=process.argv[2];
if(!out)throw Error("Usage: tsx script outputfile.html");
const data=createH48ResearchReplay(123456,"trend",10);
fs.writeFileSync(out,buildPrintableBtReport(data,"BT481 H48 研究動作確認","H48 standalone synthetic"),"utf8");
console.log("SAVED HTML "+out+" "+fs.statSync(out).size);
