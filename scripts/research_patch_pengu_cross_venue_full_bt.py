from pathlib import Path

TARGET=Path('.pengu-current/scripts/.research_pengu_v57.generated.ts')
src=TARGET.read_text()

# Allow venue/base URL/symbols to be overridden without changing logic.
src=src.replace('const BASE_URL = "https://fapi.asterdex.com";','const BASE_URL = process.env.PENGU_BASE_URL || "https://fapi.asterdex.com";',1)
src=src.replace('const PENGU_SYMBOL = "PENGUUSDT";','const PENGU_SYMBOL = process.env.PENGU_SYMBOL || "PENGUUSDT";',1) if 'const PENGU_SYMBOL = "PENGUUSDT";' in src else src
src=src.replace('const BTC_SYMBOL = "BTCUSDT";','const BTC_SYMBOL = process.env.PENGU_BTC_SYMBOL || "BTCUSDT";',1) if 'const BTC_SYMBOL = "BTCUSDT";' in src else src

# Replace literal download symbols where present.
src=src.replace('downloadCandles("PENGUUSDT")','downloadCandles(process.env.PENGU_SYMBOL || "PENGUUSDT")')
src=src.replace('downloadCandles("BTCUSDT")','downloadCandles(process.env.PENGU_BTC_SYMBOL || "BTCUSDT")')
src=src.replace('downloadFunding("PENGUUSDT")','downloadFunding(process.env.PENGU_SYMBOL || "PENGUUSDT")')

TARGET.write_text(src)
print(f'PATCHED_CROSS_VENUE={TARGET}')
