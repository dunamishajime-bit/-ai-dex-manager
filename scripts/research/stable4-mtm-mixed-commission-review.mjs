/** Offline candidate accounting only; not a venue or owner attestation. */
function decimal(raw) {
  if (typeof raw !== 'string' || raw.length > 60 || !/^-?\d+(?:\.\d+)?$/.test(raw)) throw Error('INVALID_DECIMAL');
  const [whole, fraction = ''] = raw.replace(/^-/, '').split('.');
  return { units: BigInt(whole + fraction) * (raw.startsWith('-') ? -1n : 1n), scale: fraction.length };
}
const align = (v, s) => v.units * 10n ** BigInt(s - v.scale);
function format(units, scale) {
  const sign = units < 0n ? '-' : '';
  const s = (units < 0n ? -units : units).toString().padStart(scale + 1, '0');
  return sign + (scale ? s.slice(0, -scale) + '.' + s.slice(-scale) : s);
}
const validId = x => typeof x === 'string' && x.trim() === x && x.length > 0 && x.length <= 200;
export function reviewMixedCommission(input) {
  const status = { orderAuthority: false, signedObservationIssued: false, ownerAttestationIssued: false };
  const block = reason => ({ status: 'BLOCKED', reason, ...status });
  if (!input || !validId(input.fillId) || !validId(input.quantityEvidenceId) || input.asset !== 'USDT') return block('MISSING_FILL_OR_QUANTITY_EVIDENCE');
  try {
    const f = decimal(input.fillQty), c = decimal(input.closingQty), o = decimal(input.openingQty), fee = decimal(input.commissionUsd);
    const s = Math.max(f.scale, c.scale, o.scale), F = align(f, s), C = align(c, s), O = align(o, s);
    if (F <= 0n || C <= 0n || O <= 0n || C + O !== F || fee.units > 0n) return block('INVALID_QUANTITY_OR_FEE');
    // Policy candidate: truncate closing share toward zero, allocate residual to opening.
    // Never infer venue rounding or position ownership from this arithmetic.
    const closing = fee.units * C / F;
    const opening = fee.units - closing;
    return { status: 'CANDIDATE_ONLY', fillId: input.fillId, quantityEvidenceId: input.quantityEvidenceId,
      originalCommissionUsd: format(fee.units, fee.scale), closingCommissionUsd: format(closing, fee.scale),
      openingCommissionUsd: format(opening, fee.scale), allocationPolicy: 'QUANTITY_PRO_RATA_OPENING_RESIDUAL',
      officialAllocationVerified: false, ...status };
  } catch { return block('INVALID_DECIMAL'); }
}
