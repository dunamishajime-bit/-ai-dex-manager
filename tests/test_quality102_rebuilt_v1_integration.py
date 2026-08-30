import importlib.util
import inspect
from pathlib import Path

MODULE = Path('scripts/quality102_rebuilt_v1_integration.py')
spec = importlib.util.spec_from_file_location('quality102_rebuilt_v1_integration', MODULE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

assert mod.START_ISO == '2024-08-10T00:00:00Z'
assert mod.END_ISO == '2026-08-10T00:00:00Z'
assert mod.WARM_START_ISO == '2024-05-01T00:00:00Z'
assert mod.INITIAL_JPY == 10_000
assert mod.MONTHLY_JPY == 20_000
assert mod.CONTRIBUTION_COUNT == 24
assert mod.TOTAL_CONTRIBUTED_JPY == 490_000
assert mod.QUALITY_REQUESTED_GROSS == 0.50
assert mod.CRYPTO_GROSS_CAP == 2.0
assert mod.TOTAL_GROSS_CAP == 2.5

assert mod.allocate_quality_gross(base_crypto_gross=1.3, base_total_gross=1.8) == 0.50
assert abs(mod.allocate_quality_gross(base_crypto_gross=1.8, base_total_gross=2.2) - 0.20) < 1e-12
assert abs(mod.allocate_quality_gross(base_crypto_gross=1.0, base_total_gross=2.4) - 0.10) < 1e-12
assert mod.allocate_quality_gross(base_crypto_gross=2.0, base_total_gross=2.0) == 0.0
sig = inspect.signature(mod.allocate_quality_gross)
assert set(sig.parameters) == {'base_crypto_gross', 'base_total_gross'}

v12_wrapper_source = '''
replaceOnce("const START = Date.UTC(2025, 7, 21);", "const START = Date.UTC(2025, 7, 1);");
replaceOnce("const END = Date.UTC(2026, 7, 21);", "const END = Date.UTC(2026, 7, 1);");
'''
patched_v12 = mod.patch_v12_top2_two_year_wrapper(v12_wrapper_source)
assert '"const START = Date.UTC(2024, 7, 10);"' in patched_v12
assert '"const END = Date.UTC(2026, 7, 10);"' in patched_v12
assert 'Date.UTC(2025, 7, 1)' not in patched_v12
assert 'Date.UTC(2026, 7, 1)' not in patched_v12

pengu_source = '''
const WARM_START = Date.parse("2025-07-01T00:00:00Z");
const EVAL_START = Date.parse("2025-08-10T00:00:00Z");
const EVAL_END = Date.parse("2026-08-10T00:00:00Z");
assert.equal(normalMetrics.trades,70,`V8 normal trade drift ${JSON.stringify(normalMetrics)}`);
assert.equal(stressMetrics.trades,70,`V8 severe trade drift ${JSON.stringify(stressMetrics)}`);
assert.ok(Math.abs(normalMetrics.returnPct-574.2299381960086)<1e-9,`V8 normal return drift ${normalMetrics.returnPct}`);
assert.equal(ledger.period.startInclusive,"2025-08-10T00:00:00.000Z");
assert.equal(ledger.period.endExclusive,"2026-08-10T00:00:00.000Z");
'''
patched_pengu = mod.patch_pengu_v8_two_year_source(pengu_source)
assert 'Date.parse("2024-05-01T00:00:00Z")' in patched_pengu
assert 'Date.parse("2024-08-10T00:00:00Z")' in patched_pengu
assert 'Date.parse("2026-08-10T00:00:00Z")' in patched_pengu
assert 'V8 normal trade drift' not in patched_pengu
assert 'V8 severe trade drift' not in patched_pengu
assert 'normal return drift' not in patched_pengu
assert 'ledger.period.startInclusive,"2024-08-10T00:00:00.000Z"' in patched_pengu
assert 'ledger.period.endExclusive,"2026-08-10T00:00:00.000Z"' in patched_pengu

dca_source = '''
START = dt.datetime(2025, 8, 10, tzinfo=UTC)
END = dt.datetime(2026, 8, 10, tzinfo=UTC)
INITIAL_JPY = 10_000.0
MONTHLY_JPY = 10_000.0
TOTAL_GROSS_CAP = 2.5
CRYPTO_GROSS_CAP = 2.0
cur = dt.datetime(2025, 9, 1, tzinfo=UTC)
'''
patched_dca = mod.patch_dca_two_year_source(dca_source)
assert 'START = dt.datetime(2024, 8, 10, tzinfo=UTC)' in patched_dca
assert 'END = dt.datetime(2026, 8, 10, tzinfo=UTC)' in patched_dca
assert 'INITIAL_JPY = 10_000.0' in patched_dca
assert 'MONTHLY_JPY = 20_000.0' in patched_dca
assert 'cur = dt.datetime(2024, 9, 1, tzinfo=UTC)' in patched_dca
assert 'TOTAL_GROSS_CAP = 2.5' in patched_dca
assert 'CRYPTO_GROSS_CAP = 2.0' in patched_dca

print('QUALITY102_REBUILT_V1_INTEGRATION_CONTRACT=PASS')
