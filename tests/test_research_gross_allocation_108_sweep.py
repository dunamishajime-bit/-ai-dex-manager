import importlib.util
from pathlib import Path

MODULE = Path('scripts/research_gross_allocation_108_sweep.py')
assert MODULE.exists(), 'research gross-allocation sweep implementation is missing'

spec = importlib.util.spec_from_file_location('gross108', MODULE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

assert mod.PENGU_GROSS_LEVELS == (0.75, 1.0, 1.25, 1.5)
assert mod.Q102_GROSS_LEVELS == (1.0, 1.25, 1.5)
assert mod.STOCK_GROSS_LEVELS == (1.5, 1.75, 2.0)
assert mod.SHARED_CAP_PROFILES == (
    (2.0, 2.5),
    (2.5, 3.0),
    (3.0, 3.5),
)

assert mod.V12_AGGREGATE_GROSS == 1.5
assert mod.V12_PER_POSITION_GROSS == 1.0
assert mod.V12_MAX_POSITIONS == 2
assert mod.SHARED_CRYPTO_DAILY_LOSS_LIMIT == -0.075

cases = mod.build_case_matrix()
assert len(cases) == 108
assert len({row['caseId'] for row in cases}) == 108

baseline = [row for row in cases if (
    row['penguGross'] == 0.75
    and row['q102Gross'] == 1.0
    and row['stockGross'] == 1.5
    and row['cryptoGrossCap'] == 2.0
    and row['totalGrossCap'] == 2.5
)]
assert len(baseline) == 1
assert baseline[0]['isBaseline'] is True

assert max(row['totalGrossCap'] for row in cases) == 3.5
assert min(row['cryptoGrossCap'] for row in cases) == 2.0
assert all(row['cryptoGrossCap'] <= row['totalGrossCap'] for row in cases)
assert all(row['v12AggregateGross'] == 1.5 for row in cases)
assert all(row['sharedCryptoDailyLossLimit'] == -0.075 for row in cases)

print('GROSS_ALLOCATION_108_SWEEP_CONTRACT=PASS')
