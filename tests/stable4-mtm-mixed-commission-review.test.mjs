import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewMixedCommission } from '../scripts/research/stable4-mtm-mixed-commission-review.mjs';
const base = {fillId:'fixture-fill',quantityEvidenceId:'fixture-evidence',asset:'USDT',fillQty:'3',closingQty:'1',openingQty:'2',commissionUsd:'-0.0100'};
test('mixed fill conserves commission exactly, with candidate-only residual policy', () => {
  const r=reviewMixedCommission(base);
  assert.equal(r.status,'CANDIDATE_ONLY'); assert.equal(r.closingCommissionUsd,'-0.0033'); assert.equal(r.openingCommissionUsd,'-0.0067'); assert.equal(r.originalCommissionUsd,'-0.0100');
  for (const k of ['orderAuthority','signedObservationIssued','ownerAttestationIssued','officialAllocationVerified']) assert.equal(r[k],false);
});
test('fractional quantities and exact large integers remain lossless', () => {
  const r=reviewMixedCommission({...base,fillQty:'9007199254740993.3',closingQty:'9007199254740993.1',openingQty:'0.2',commissionUsd:'-0.000000000000000003'});
  assert.equal(r.closingCommissionUsd,'-0.000000000000000002'); assert.equal(r.openingCommissionUsd,'-0.000000000000000001');
});
test('zero fee is valid and both shares are zero', () => {
  const r=reviewMixedCommission({...base,commissionUsd:'0.0000'}); assert.equal(r.closingCommissionUsd,'0.0000'); assert.equal(r.openingCommissionUsd,'0.0000');
});
test('rejects unproven inputs, inconsistent split, credit, non-USDT and lossy numeric inputs', () => {
  for (const patch of [{quantityEvidenceId:''},{fillId:''},{closingQty:'0'},{openingQty:'1'},{commissionUsd:'0.01'},{commissionUsd:-0.01},{fillQty:'3e0'},{asset:'ASTER'},{closingQty:'-1'}]) assert.equal(reviewMixedCommission({...base,...patch}).status,'BLOCKED');
});
