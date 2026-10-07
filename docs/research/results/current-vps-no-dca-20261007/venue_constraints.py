"""Observed-current Aster quantity constraints; not a historical filter archive."""
import json,math
from pathlib import Path
from decimal import Decimal
FILTER_ROWS={r["symbol"]:r for r in json.loads(Path(__file__).with_name("venue-filters-observed-20261007.json").read_text())["symbols"]}
def normalize_quantity(symbol,requested,price):
 row=FILTER_ROWS.get(symbol)
 if not row:return 0.,"VENUE_FILTER_MISSING"
 filters={f["filterType"]:f for f in row.get("filters",[])}
 lot=filters.get("MARKET_LOT_SIZE") or filters.get("LOT_SIZE")
 if not lot:return 0.,"VENUE_QUANTITY_FILTER_MISSING"
 step=float(lot["stepSize"]);minimum=float(lot["minQty"]);maximum=float(lot["maxQty"])
 bounded=min(max(requested,0),maximum)
 scale=10**min(12,max(0,-Decimal(str(step)).as_tuple().exponent))
 integer_value=math.floor(bounded*scale+1e-9)
 integer_step=max(1,math.floor(step*scale+.5))
 quantity=math.floor(integer_value/integer_step)*integer_step/scale
 if quantity<minimum or quantity<=0:return 0.,"VENUE_MIN_QTY"
 minimum_notional=max(5.,float(filters.get("MIN_NOTIONAL",{}).get("notional",0)))
 if quantity*price+1e-9<minimum_notional:return 0.,"VENUE_MIN_NOTIONAL"
 return quantity,None
