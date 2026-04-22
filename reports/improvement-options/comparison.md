# Improvement Options Backtest

## Baseline

- mode: RETQ22
- end_equity: 82553.59
- CAGR: 108.22%
- MaxDD: -45.27%
- WinRate: 51.72%
- PF: 1.69
- Trades: 58

## Comparison

| variant | end_equity | CAGR % | MaxDD % | WinRate % | PF | trades | delta equity | delta CAGR | delta MaxDD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12H entry + 4H exit check | 30305.97 | 47.00 | -53.91 | 33.75 | 1.45 | 80 | -52247.63 | -61.22 | -8.64 |
| 6H decision | 20446.80 | 27.54 | -52.14 | 37.84 | 1.20 | 111 | -62106.79 | -80.68 | -6.88 |
| 6H decision + 4H exit check | 15584.31 | 16.29 | -50.22 | 37.50 | 1.18 | 80 | -66969.28 | -91.93 | -4.95 |
| 12H decision + faster SMA40 exit | 82036.17 | 107.77 | -44.31 | 51.72 | 1.69 | 58 | -517.42 | -0.45 | 0.96 |
| 12H decision + stricter efficiency filter | 44402.09 | 67.86 | -43.55 | 47.06 | 1.62 | 51 | -38151.50 | -40.36 | 1.72 |
| 1H early-entry reference | 50822.27 | 75.93 | -44.82 | 41.56 | 1.23 | 154 | -31731.32 | -32.29 | 0.45 |

## Details

### 12H entry + 4H exit check

- mode: RETQ22
- end_equity: 30305.97
- CAGR: 47.00%
- MaxDD: -53.91%
- WinRate: 33.75%
- PF: 1.45
- Trades: 80

### 6H decision

- mode: RETQ22
- end_equity: 20446.80
- CAGR: 27.54%
- MaxDD: -52.14%
- WinRate: 37.84%
- PF: 1.20
- Trades: 111

### 6H decision + 4H exit check

- mode: RETQ22
- end_equity: 15584.31
- CAGR: 16.29%
- MaxDD: -50.22%
- WinRate: 37.50%
- PF: 1.18
- Trades: 80

### 12H decision + faster SMA40 exit

- mode: RETQ22
- end_equity: 82036.17
- CAGR: 107.77%
- MaxDD: -44.31%
- WinRate: 51.72%
- PF: 1.69
- Trades: 58

### 12H decision + stricter efficiency filter

- mode: RETQ22
- end_equity: 44402.09
- CAGR: 67.86%
- MaxDD: -43.55%
- WinRate: 47.06%
- PF: 1.62
- Trades: 51

### 1H early-entry reference

- mode: RETQ22
- end_equity: 50822.27
- CAGR: 75.93%
- MaxDD: -44.82%
- WinRate: 41.56%
- PF: 1.23
- Trades: 154
