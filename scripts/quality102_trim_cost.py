from __future__ import annotations

import ast
import math


def _finite(name: str, value: float) -> float:
    out = float(value)
    if not math.isfinite(out):
        raise ValueError(f'{name} must be finite: {value!r}')
    return out


def resolve_quality102_gross_cap(raw: str | None, *, default: float = 0.50, maximum: float = 0.50) -> float:
    """Resolve Quality102 gross cap, defaulting to the validated 0.50x ceiling."""
    source = default if raw is None or str(raw).strip() == '' else raw
    try:
        value = float(source)
    except (TypeError, ValueError) as exc:
        raise ValueError(f'QUALITY102_GROSS_CAP must be numeric: {source!r}') from exc
    if not math.isfinite(value) or value <= 0.0 or value > maximum + 1e-12:
        raise ValueError(f'QUALITY102_GROSS_CAP must be finite and in (0,{maximum}]: {source!r}')
    return value


def _target_names(node: ast.AST) -> list[str]:
    if isinstance(node, ast.Name):
        return [node.id]
    if isinstance(node, (ast.Tuple, ast.List)):
        out: list[str] = []
        for elt in node.elts:
            out.extend(_target_names(elt))
        return out
    return []


def patch_named_numeric_assignment(source: str, target_name: str, *, expected_old: float, new_value: float) -> str:
    """Patch exactly one named numeric assignment without touching report literals."""
    new_number = _finite('new_value', new_value)
    tree = ast.parse(source)
    matches: list[ast.Constant] = []
    for node in ast.walk(tree):
        names: list[str] = []
        value_node: ast.AST | None = None
        if isinstance(node, ast.Assign):
            for target in node.targets:
                names.extend(_target_names(target))
            value_node = node.value
        elif isinstance(node, ast.AnnAssign):
            names.extend(_target_names(node.target))
            value_node = node.value
        if target_name not in names or not isinstance(value_node, ast.Constant) or not isinstance(value_node.value, (int, float)):
            continue
        if abs(float(value_node.value) - float(expected_old)) <= 1e-12:
            matches.append(value_node)
    if len(matches) != 1:
        raise ValueError(f'expected exactly one {target_name} assignment at {expected_old}; found {len(matches)}')
    node = matches[0]
    if node.end_lineno != node.lineno or node.end_col_offset is None:
        raise ValueError(f'{target_name} numeric assignment must be on one line')
    lines = source.splitlines(keepends=True)
    line = lines[node.lineno - 1]
    lines[node.lineno - 1] = line[:node.col_offset] + format(new_number, '.12g') + line[node.end_col_offset:]
    return ''.join(lines)


def solve_trim_resize(
    *,
    old_notional_jpy: float,
    equity_jpy: float,
    base_total_gross: float,
    base_crypto_gross: float,
    total_gross_cap: float,
    crypto_gross_cap: float,
    quality_gross_cap: float,
    trim_cost_bps: float,
) -> dict:
    """Return a fail-closed Quality102 residual-cap resize decision.

    Gross sizing is decided on the pre-trim-execution-cost equity snapshot.
    The execution-friction charge is then applied once to the trimmed notional
    as an economic PnL deduction. Keeping those bases separate prevents a trim
    fee from recursively changing the sizing decision for the same entry event.
    """
    old_notional = _finite('old_notional_jpy', old_notional_jpy)
    equity = _finite('equity_jpy', equity_jpy)
    base_total = _finite('base_total_gross', base_total_gross)
    base_crypto = _finite('base_crypto_gross', base_crypto_gross)
    total_cap = _finite('total_gross_cap', total_gross_cap)
    crypto_cap = _finite('crypto_gross_cap', crypto_gross_cap)
    quality_cap = _finite('quality_gross_cap', quality_gross_cap)
    cost_bps = _finite('trim_cost_bps', trim_cost_bps)

    if old_notional < 0.0:
        raise ValueError('old_notional_jpy must be >= 0')
    if equity <= 0.0:
        raise ValueError('equity_jpy must be > 0')
    if base_total < 0.0 or base_crypto < 0.0:
        raise ValueError('base gross inputs must be >= 0')
    if total_cap <= 0.0 or crypto_cap <= 0.0 or quality_cap <= 0.0:
        raise ValueError('gross caps must be > 0')
    if cost_bps < 0.0:
        raise ValueError('trim_cost_bps must be >= 0')

    total_headroom = max(0.0, total_cap - base_total)
    crypto_headroom = max(0.0, crypto_cap - base_crypto)
    cap_candidates = (
        ('TOTAL', total_headroom),
        ('CRYPTO', crypto_headroom),
        ('QUALITY102', quality_cap),
    )
    binding_cap, allowed_quality_gross = min(cap_candidates, key=lambda item: item[1])
    max_notional = equity * allowed_quality_gross
    new_notional = max(0.0, min(old_notional, max_notional))
    trimmed_notional = max(0.0, old_notional - new_notional)

    if trimmed_notional <= 1e-12:
        binding_cap = 'NONE'
        trimmed_notional = 0.0
        new_notional = old_notional

    trim_cost = trimmed_notional * (cost_bps / 10_000.0)
    equity_after_cost = equity - trim_cost
    if equity_after_cost <= 0.0:
        raise ValueError('trim execution cost exhausts equity')

    sizing_quality = new_notional / equity
    sizing_total = base_total + sizing_quality
    sizing_crypto = base_crypto + sizing_quality

    # These economic diagnostics deliberately use the post-cost equity. They
    # are not the contract basis for the already-made entry sizing decision.
    base_total_notional = base_total * equity
    base_crypto_notional = base_crypto * equity
    economic_quality = new_notional / equity_after_cost
    economic_total = (base_total_notional + new_notional) / equity_after_cost
    economic_crypto = (base_crypto_notional + new_notional) / equity_after_cost

    return {
        'notionalBeforeJpy': old_notional,
        'notionalAfterJpy': new_notional,
        'trimmedNotionalJpy': trimmed_notional,
        'trimCostBps': cost_bps,
        'trimExecutionCostJpy': trim_cost,
        'sizingEquityJpy': equity,
        'equityAfterCostJpy': equity_after_cost,
        'totalHeadroomGross': total_headroom,
        'cryptoHeadroomGross': crypto_headroom,
        'allowedQualityGross': allowed_quality_gross,
        'bindingCap': binding_cap,
        'sizingQualityGrossAfter': sizing_quality,
        'sizingTotalGrossAfter': sizing_total,
        'sizingCryptoGrossAfter': sizing_crypto,
        'economicQualityGrossAfterCost': economic_quality,
        'economicTotalGrossAfterCost': economic_total,
        'economicCryptoGrossAfterCost': economic_crypto,
    }
