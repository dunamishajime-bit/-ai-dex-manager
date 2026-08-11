import { spawnSync } from "node:child_process";

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("python3", ["-m", "pip", "install", "--disable-pip-version-check", "numpy", "pandas"]);
run("python3", ["research/aifx_early_wave_bt.py"]);
const yearly = `import json\nr=json.load(open('early_wave_results.json'))\nout={}\nfor p,pr in r['pairs'].items():\n out[p]={}\n for d,dr in pr['directions'].items():\n  out[p][d]={tf:{'chosen_family':x['chosen_family'],'development_by_year':x['development_by_year'],'development_gate':x['development_gate']} for tf,x in dr['timeframes'].items()}\nprint('AIFX_DEV_YEARLY_BEGIN')\nprint(json.dumps(out,separators=(',',':')))\nprint('AIFX_DEV_YEARLY_END')`;
run("python3", ["-c", yearly]);
console.log("AIFX Early Wave proxy BT completed");
