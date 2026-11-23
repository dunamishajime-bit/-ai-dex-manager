from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from disdex_v52_daily_loss import update_v52_strategy_daily_latch
from datetime import datetime

def ms(value):
    return int(datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000)

day2 = ms('2026-07-28T00:01:00Z')
roll = update_v52_strategy_daily_latch({'utcDay':'2026-07-27','tripped':True,'strategyStartCapitalUsd':100}, [], 0, 100, day2, 3.5, True)
assert roll['tripped'] is False and roll['resetReason'] == 'UTC_DAY_ROLLOVER'
same = update_v52_strategy_daily_latch(roll, [{'closedAt':day2,'realizedPnl':-4,'commission':0,'funding':0,'deposits':0,'withdrawals':0}], 0, 100, day2 + 60000, 3.5, True)
assert same['tripped'] is True and same['latchName'] == 'v52StrategyDailyLossLatch'
deposit = update_v52_strategy_daily_latch(None, [{'closedAt':day2,'realizedPnl':0,'commission':0,'funding':0,'deposits':10,'withdrawals':0}], 0, 100, day2, 3.5, True)
assert deposit['tripped'] is False
unavailable = update_v52_strategy_daily_latch(None, [], 0, 0, day2, 3.5, False)
assert unavailable['tripped'] is True and unavailable['failClosed'] is True
print('DISDEX_V52_DAILY_LOSS_SELFTEST_PASS')
