/** H48 canonical Kill Switch environment checker (READ ONLY).
 * The upstream HYPE systemd template loads multiple legacy env files. If any
 * alias points to a different file, a fresh H48 runner must not trade even
 * if one alias or a private legacy file reports inactive.
 */
import { lstat } from "node:fs/promises";
import { readSharedKillSwitch, type SharedKillSwitchView } from "./disdex-shared-kill-switch";

export const H48_CANONICAL_KILL_SWITCH = "/var/lib/disdex/shared/kill-switch.json" as const;
export const H48_KILL_SWITCH_ALIASES = [
  "DISDEX_SHARED_KILL_SWITCH_FILE",
  "DISDEX_V13D_V11EQ_V96_KILL_SWITCH_FILE",
  "DISDEX_V11EQ_ASTER_ONLY_KILL_SWITCH_FILE",
  "DISDEX_V52_ASTER_ONLY_KILL_SWITCH_FILE",
  "DISDEX_V96_KILL_SWITCH_FILE",
  "PENGU_DUAL_LS_V2_KILL_SWITCH_FILE",
  "QUALITY102_CAUSAL_V1_KILL_SWITCH_FILE",
] as const;

export type H48CanonicalKillObservation = Readonly<{
  canonicalPath: typeof H48_CANONICAL_KILL_SWITCH;
  globalHold: boolean;
  action: SharedKillSwitchView["action"];
  reason: string | undefined;
  allAliasesVerified: true;
  ordersAllowed: false;
}>;

/** Require every configured H48-related alias to exist and point to the
 * exact canonical shared source. A symlink or malformed HOLD must never
 * be treated as permission; the full issuer validates Root provenance.
 */
export function validateH48CanonicalKillPaths(
  env:NodeJS.ProcessEnv,
):typeof H48_CANONICAL_KILL_SWITCH {
  for(const name of H48_KILL_SWITCH_ALIASES){
    const path=env[name];
    if(path!==H48_CANONICAL_KILL_SWITCH)
      throw Error("H48_KILL_SWITCH_ENV_ALIAS_MISMATCH:"+name);
  }
  return H48_CANONICAL_KILL_SWITCH;
}

export async function inspectH48CanonicalKillSwitch(
  env:NodeJS.ProcessEnv = process.env,
):Promise<H48CanonicalKillObservation> {
  const canonical=validateH48CanonicalKillPaths(env);
  // A missing canonical HOLD file must never count as an inactive switch.
  const before=await lstat(canonical);
  if(!before.isFile()||before.isSymbolicLink()
     ||(before.mode&0o022)!==0)
    throw Error("H48_KILL_SWITCH_FILE_UNTRUSTED");
  const view=await readSharedKillSwitch(env);
  const after=await lstat(canonical);
  if(!after.isFile()||after.isSymbolicLink()
     ||before.ino!==after.ino||before.dev!==after.dev
     ||before.mtimeMs!==after.mtimeMs||before.size!==after.size)
    throw Error("H48_KILL_SWITCH_FILE_CHANGED");
  if(view.configuredPaths.length!==1||view.configuredPaths[0]!==canonical)
    throw Error("H48_KILL_SWITCH_RUNTIME_PATH_MISMATCH");
  if(view.active&&!(view.action==="HOLD_PROTECTED"&&view.scope==="GLOBAL"))
    throw Error("H48_KILL_SWITCH_UNEXPECTED_ACTIVE_MODE");
  return Object.freeze({
    canonicalPath:canonical,globalHold:view.active,
    action:view.action,reason:view.reason,
    allAliasesVerified:true as const,ordersAllowed:false as const,
  });
}
