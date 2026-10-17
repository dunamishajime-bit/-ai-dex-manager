import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bottom = fs.readFileSync(path.join(root, "components/layout/BottomNav.tsx"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "components/layout/Sidebar.tsx"), "utf8");
const realtime = fs.readFileSync(path.join(root, "app/realtime/page.tsx"), "utf8");

assert.match(sidebar, /href: "\/realtime", label: "リアルタイム"/);
assert.match(bottom, /label: "リアル", href: "\/realtime"/);
assert.match(bottom, /aria-label=\{href === "\/realtime" \? "リアルタイム" : label\}/);
assert.match(bottom, /fixed bottom-0/);
assert.match(bottom, /md:hidden/);
assert.ok(bottom.indexOf('href: "/positions"') < bottom.indexOf('href: "/realtime"'));
assert.ok(bottom.indexOf('href: "/realtime"') < bottom.indexOf('href: "/decision-status"'));
assert.match(bottom, /const isActive = pathname === href/);
assert.match(realtime, /RealtimeRankingBoard/);
console.log("realtime PC/mobile navigation contract: PASS");
