import assert from "node:assert/strict";
import test from "node:test";
import { observeRunnerServiceActivity, type ExecFileCommand } from "../lib/disdex-service-activity";

const UNIT = "disdex-v12-x1-all@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.service";

test("maps a bounded systemctl timeout to unavailable activity", async () => {
  let receivedOptions: Parameters<ExecFileCommand>[2] | undefined;
  const execFile: ExecFileCommand = async (_file, _args, options) => {
    receivedOptions = options;
    const error = Object.assign(new Error("command timed out"), { code: "ETIMEDOUT" });
    throw error;
  };

  const env: NodeJS.ProcessEnv = { ...process.env, DISDEX_RUNNER_V12_SERVICE_UNIT: UNIT };
  const activity = await observeRunnerServiceActivity(env, execFile);

  assert.ok(receivedOptions?.timeout && receivedOptions.timeout > 0);
  assert.equal(receivedOptions?.killSignal, "SIGTERM");
  assert.equal(activity.V12, undefined);
});
