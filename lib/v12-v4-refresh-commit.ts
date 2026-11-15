/** Root-published proof of one bounded evidence refresh, never order authority. */
import {createHash} from 'node:crypto';
import validity from '../config/v12-v4-evidence-validity.json';
export const V4_REFRESH_COMMIT_PATH='/etc/disdex/v12-v4-evidence/refresh-commit.json';
export const V4_DYNAMIC_EVIDENCE_KEYS=['establishedAsterOrders','signedAsterAccount','sharedRiskAndPeers'] as const;
export function validateV4RefreshCommit(raw:unknown,sha:string,now=Date.now()):Record<string,string>{
 const c=raw as Record<string,any>;
 const captured=Date.parse(String(c?.capturedAt||''));
 if(!c||typeof c!=='object'||Array.isArray(c)||c.schema!=='disdex-v4-dynamic-evidence-commit/v1'
  ||c.sha!==sha||!/^[a-f0-9]{40}$/.test(sha)||c.scope!=='V4_EVIDENCE_REFRESH_ONLY'
  ||c.ordersEnabled!==false||c.authorizesTrading!==false
  ||typeof c.refreshGeneration!=='string'||!c.refreshGeneration||c.refreshGeneration.length>160
  ||typeof c.leaseId!=='string'||!/^[a-f0-9]{32}$/.test(c.leaseId)
  ||typeof c.planSha256!=='string'||!/^[a-f0-9]{64}$/.test(c.planSha256)
  ||!Number.isSafeInteger(c.leaseApprovedAt)||!Number.isSafeInteger(c.leaseExpiresAt)
  ||c.leaseApprovedAt<=0||c.leaseApprovedAt*1000>now
  ||c.leaseExpiresAt<=c.leaseApprovedAt||c.leaseExpiresAt-c.leaseApprovedAt>validity.refreshLeaseDays*86400
  ||!Number.isFinite(captured)||captured>now
  ||captured<c.leaseApprovedAt*1000||captured>=c.leaseExpiresAt*1000
  ||!c.evidenceSha256||Object.keys(c.evidenceSha256).sort().join('|')!==[...V4_DYNAMIC_EVIDENCE_KEYS].sort().join('|')
  ||!V4_DYNAMIC_EVIDENCE_KEYS.every(k=>typeof c.evidenceSha256[k]==='string'&&/^[a-f0-9]{64}$/.test(c.evidenceSha256[k]))
  ||!c.evidencePayloads||Object.keys(c.evidencePayloads).sort().join('|')!==[...V4_DYNAMIC_EVIDENCE_KEYS].sort().join('|')
  ||!V4_DYNAMIC_EVIDENCE_KEYS.every(k=>c.evidencePayloads[k]&&typeof c.evidencePayloads[k]==='object'&&!Array.isArray(c.evidencePayloads[k])
    &&createHash('sha256').update(JSON.stringify(c.evidencePayloads[k],null,2)+'\n').digest('hex')===c.evidenceSha256[k]))
  throw Error('V4_REFRESH_COMMIT_INVALID');
 if(c.leaseExpiresAt*1000<=now)throw Error('V4_REFRESH_LEASE_EXPIRED');
 if(now-captured>900000)throw Error('V4_REFRESH_COMMIT_STALE');
 return {...c.evidenceSha256};
}
