"""Allow bounded real decision observation through slow causal recalculation.

Freshness/identity checks remain in the real observer; this changes only how
long it waits for a new completed cycle, never the age of an accepted cycle.
"""

def decision_wait_seconds(previous_tick, explicit_timeout=None):
    if previous_tick is not None and (type(previous_tick) is not int or previous_tick <= 0):
        raise ValueError('V4_DECISION_PREVIOUS_TICK_INVALID')
    if explicit_timeout is not None:
        if type(explicit_timeout) not in (int, float) or not 0 < explicit_timeout <= 600:
            raise ValueError('V4_DECISION_WAIT_BOUND_INVALID')
        return explicit_timeout
    return 600
