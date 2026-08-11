import { spawnSync } from "node:child_process";

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("python3", ["-m", "pip", "install", "--disable-pip-version-check", "numpy", "pandas"]);
run("python3", ["research/aifx_early_wave_bt.py"]);
console.log("AIFX Early Wave proxy BT completed");
