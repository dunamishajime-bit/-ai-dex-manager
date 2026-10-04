# Compact ranking layout —2026-10-04

User requested the ranking to fit one desktop viewport, with a small title, three compact rectangular leaders and three vertical columns of15 entries. The full current49 routes are retained:45 in the primary grid and4 in a narrow footer. Detail gates open in a native modal instead of expanding the ranking rows.

The realtime page removes nested page padding and bottom spacer. The application shell uses dynamic viewport height and explicit minimum-height handling; sidebar overflow is scrollable. Realtime's production banner is collapsed by default. Other pages retain their existing banner presentation.

The board uses available height with a560px minimum for legibility. Short or zoomed desktop views can scroll instead of compressing text below readable row height. Mobile uses stacked columns and vertical scrolling.

## Preview browser measurements

|Viewport|Rows|Column counts|Footer|Last row bottom|Horizontal overflow|Main scrolling needed|
|---|---:|---|---:|---:|---|---|
|1440×900|49|15 /15 /15|4|886px|No|No|
|1280×720|49|15 /15 /15|4|706px|No|No|
|1024×768|49|15 /15 /15|4|754px|No|No|
|1920×900|49|15 /15 /15|4|886px|No|No|

Detail modal, Escape dismissal, symbol search including multiple FET routes, simulated rank-change gold flash, and390×844 mobile scrolling passed. Browser page errors: none. Verification browser blocked mutation requests and used a synthetic local profile. Trading and score calculation are unchanged.

Final isolated Linux TypeScript check and Next.js production build passed. At1280×500, the page scrolls vertically without compressing or clipping ranking rows. Final browser verification confirms all49 routes, detail dialog, search, gold flash and mobile fallback; page errors: none.
