import os
import pandas as pd
from pengu_v2_okx_frozen import candles, prep

OUT='research/pengu-v2-okx-export-recent'
os.makedirs(OUT,exist_ok=True)
p=candles('PENGU-USDT-SWAP')
b=candles('BTC-USDT-SWAP')
d=prep(p,b)
d.to_csv(os.path.join(OUT,'okx_aligned_features.csv'),index=False)
print('EXPORTED',len(d),d.t.iloc[0],d.t.iloc[-1])
