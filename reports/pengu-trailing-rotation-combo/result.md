# PENGU Trailing + Rotation Comparison

| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | PENGU contribution | PENGU trailing exits | rotate count |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| legacy_base | Original strongest profile before PENGU trailing was added. | 206790.86 | 186.47 | -31.04 | 2.739 | 58.33 | 60 | 95169.16 | 0 | 0 |
| trailing_base | Production candidate with PENGU-only trailing protection. | 241345.05 | 202.28 | -31.04 | 2.924 | 58.33 | 60 | 125308.66 | 3 | 0 |
| trailing_plus_rotate_gap10_once | PENGU trailing plus rotation from stalled normal trend into PENGU on a single 12H lead. | 288470.92 | 221.6 | -32.57 | 2.468 | 55.56 | 63 | 135442.5 | 3 | 4 |
| trailing_plus_rotate_gap10_twice | PENGU trailing plus rotation only after the 10-point lead persists for 2 consecutive 12H bars. | 244914.54 | 203.82 | -31.04 | 2.721 | 57.38 | 61 | 109590.15 | 3 | 1 |