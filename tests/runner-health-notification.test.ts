import assert from "node:assert/strict";
import test from "node:test";

import {
  DELIVERY_RETRY_INTERVAL_MS,
  formatRunnerHealthEmail,
  markRunnerAlertAttempt,
  markRunnerAlertDelivered,
  observeRunnerStatus,
} from "../lib/server/runner-health-notification";

test("active startup stays quiet and one transient failure is ignored", () => {
  const t0 = new Date("2026-09-07T00:00:00.000Z");
  const active1 = observeRunnerStatus(undefined, "ACTIVE", t0);
  assert.equal(active1.shouldSend, false);
  const active2 = observeRunnerStatus(active1.record, "ACTIVE", new Date(t0.getTime() + 60_000));
  assert.equal(active2.shouldSend, false);

  const failed1 = observeRunnerStatus(active2.record, "FAILED", new Date(t0.getTime() + 120_000));
  assert.equal(failed1.shouldSend, false);
  const recovered = observeRunnerStatus(failed1.record, "ACTIVE", new Date(t0.getTime() + 180_000));
  assert.equal(recovered.shouldSend, false);
});

test("two consecutive unhealthy checks send once, then stay quiet", () => {
  const t0 = new Date("2026-09-07T00:00:00.000Z");
  const active = observeRunnerStatus(undefined, "ACTIVE", t0);
  const activeBaseline = observeRunnerStatus(active.record, "ACTIVE", new Date(t0.getTime() + 60_000));
  const failed1 = observeRunnerStatus(activeBaseline.record, "FAILED", new Date(t0.getTime() + 120_000));
  const failed2 = observeRunnerStatus(failed1.record, "FAILED", new Date(t0.getTime() + 180_000));
  assert.equal(failed2.transition, "UNHEALTHY");
  assert.equal(failed2.shouldSend, true);

  const delivered = markRunnerAlertDelivered(failed2.record, "FAILED", new Date(t0.getTime() + 180_000));
  const repeat = observeRunnerStatus(delivered, "FAILED", new Date(t0.getTime() + 240_000));
  assert.equal(repeat.transition, "NONE");
  assert.equal(repeat.shouldSend, false);
});

test("failed delivery is not retried every minute", () => {
  const t0 = new Date("2026-09-07T00:00:00.000Z");
  let state = observeRunnerStatus(undefined, "FAILED", t0).record;
  const incident = observeRunnerStatus(state, "FAILED", new Date(t0.getTime() + 60_000));
  assert.equal(incident.shouldSend, true);
  state = markRunnerAlertAttempt(incident.record, new Date(t0.getTime() + 60_000));

  const oneMinuteLater = observeRunnerStatus(state, "FAILED", new Date(t0.getTime() + 120_000));
  assert.equal(oneMinuteLater.shouldSend, false);
  const retry = observeRunnerStatus(state, "FAILED", new Date(t0.getTime() + DELIVERY_RETRY_INTERVAL_MS + 60_000));
  assert.equal(retry.shouldSend, true);
});

test("intentional V52 stop is quiet and mail is Japanese", () => {
  const intentional = observeRunnerStatus(undefined, "INTENTIONAL_STOP", new Date("2026-09-07T00:00:00.000Z"));
  assert.equal(intentional.shouldSend, false);
  const mail = formatRunnerHealthEmail({
    runnerLabel: "V12 X1.00 ALL",
    service: "disdex-v12-x1-all@abc.service",
    status: "FAILED",
    previousStatus: "ACTIVE",
    transition: "UNHEALTHY",
    observedAt: new Date("2026-09-07T00:00:00.000Z"),
  });
  assert.match(mail.subject, /点検異常/);
  assert.match(mail.text, /対象ロジック/);
  assert.match(mail.text, /読み取り専用/);
  assert.doesNotMatch(mail.text, /runner health alert|stopped or unhealthy/i);
});
