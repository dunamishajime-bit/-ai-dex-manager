V58_MODES = (
    'V58_ONE_FAIL_CORE',
    'V58_ONE_OR_TWO_FAIL_CORE',
    'V58_ONE_OR_TWO_FAIL_ELITE',
)

ONE_FAIL_GROSS_CAP = 0.625
TWO_FAIL_GROSS_CAP = 0.375


def allowed_core_failure_count(count: int) -> bool:
    return count in (1, 2)


def recovery_gross_cap(count: int):
    if count == 1:
        return ONE_FAIL_GROSS_CAP
    if count == 2:
        return TWO_FAIL_GROSS_CAP
    return None
