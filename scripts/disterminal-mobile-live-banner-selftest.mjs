import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const banner = fs.readFileSync(path.join(root, "components/layout/LiveProductionBanner.tsx"), "utf8");

assert.match(banner, /<details className="[^"]*md:hidden[^"]*">/, "mobile banner must use a details disclosure hidden on desktop");
assert.match(banner, /<summary/, "mobile banner must provide a summary control");
assert.match(banner, /運用ロジック情報/, "mobile summary must identify the strategy information");
assert.equal(/<details[^>]*\sopen(?:=|\s|>)/.test(banner), false, "mobile banner must be collapsed by default");
assert.match(banner, /group-open:rotate-180/, "mobile disclosure indicator must reflect open state");
assert.match(banner, /hidden[^\"]*md:block/, "desktop banner must remain always visible from md breakpoint");

console.log("DISTERMINAL_MOBILE_LIVE_BANNER_SELFTEST_PASS");
