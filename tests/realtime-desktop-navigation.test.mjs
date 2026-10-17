import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sidebar = fs.readFileSync(path.join(root, "components/layout/Sidebar.tsx"), "utf8");
const home = fs.readFileSync(path.join(root, "app/page.tsx"), "utf8");

assert.match(sidebar, /href: "\/realtime"/);
assert.match(sidebar, /label: "リアルタイム"/);
assert.match(home, /<QuickLink href="\/realtime"/);
assert.match(home, /title="リアルタイム判定"/);

console.log("realtime desktop navigation contract: PASS");
