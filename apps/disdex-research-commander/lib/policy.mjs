export const RESEARCH_REPO = 'dunamishajime-bit/-ai-dex-manager';
export const RESEARCH_BRANCH = 'research/win80-profit-optimization-v1';
export const RESEARCH_WRITE_ROOT = 'research/commander/candidates/';
export const RESEARCH_BT_WORKFLOW = 'disdex-research-commander-bt.yml';
export const MAX_RESEARCH_SHARDS = 5;

const DENY_RE = /(?:production|prod|live|deploy|promote|release|approval|kill[-_ ]?switch|account|wallet|private|secret|credential)/i;
const SECRET_KEY_RE = /(?:private[_-]?key|api[_-]?key|secret|password|token|cookie|credential)/i;
const SECRET_VALUE_RE = /(?:-----BEGIN|sk-[A-Za-z0-9]|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{20,})/;

export function assertResearchPath(path, { write = false } = {}) {
  if (typeof path !== 'string' || !path || path.length > 240 || path.startsWith('/') || path.includes('\\') || path.includes('..') || path.includes('//')) throw new Error('RESEARCH_PATH_TRAVERSAL_REJECTED');
  const prefix = write ? RESEARCH_WRITE_ROOT : 'research/';
  if (!path.startsWith(prefix)) throw new Error('RESEARCH_PATH_NOT_ALLOWED');
  if (DENY_RE.test(path)) throw new Error('PRODUCTION_PATH_REJECTED');
  return path;
}

export function assertResearchWorkflow(workflowFile) {
  if (workflowFile !== RESEARCH_BT_WORKFLOW) throw new Error('WORKFLOW_NOT_ALLOWLISTED');
  return workflowFile;
}

export function assertRequestId(value) {
  if (value === undefined || value === null || value === '') return 'research-request';
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(value)) throw new Error('RESEARCH_REQUEST_ID_INVALID');
  return value;
}

export function assertNoHoldoutStage(value) {
  const walk = (item) => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) return item.forEach(walk);
    for (const [key, child] of Object.entries(item)) {
      if (key !== 'confirmationHoldoutUntouched' && /confirmation|holdout|final2026|final_holdout/i.test(key)) throw new Error('CONFIRMATION_HOLDOUT_INACCESSIBLE');
      walk(child);
    }
  };
  walk(value);
  return true;
}

export function assertSafeOutput(value) {
  const walk = (item) => {
    if (Array.isArray(item)) return item.forEach(walk);
    if (!item || typeof item !== 'object') {
      if (typeof item === 'string' && SECRET_VALUE_RE.test(item)) throw new Error('CREDENTIAL_LIKE_OUTPUT_REJECTED');
      return;
    }
    for (const [key, child] of Object.entries(item)) {
      if (SECRET_KEY_RE.test(key)) throw new Error('CREDENTIAL_LIKE_OUTPUT_REJECTED');
      walk(child);
    }
  };
  walk(value);
  return true;
}

