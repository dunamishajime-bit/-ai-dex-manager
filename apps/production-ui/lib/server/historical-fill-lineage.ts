/**
 * Read-only historical lineage recovered from Aster GET /fapi/v3/order and
 * Production state archives. These records repair periods before the fill
 * notification spool captured complete strategy/route metadata.
 *
 * Never infer PnL from this table. PnL remains Aster official userTrades truth.
 */
export const HISTORICAL_FILL_LINEAGE_BY_ORDER_ID: Record<string, Record<string, unknown>> = {
  "1045562381": { strategyId: "V12_X1.00_ALL", eventType: "ENTRY_FILL", symbol: "INJUSDT", orderId: "1045562381", clientOrderId: "v12-entry-4330344fa0b2a11c67e8d2", reason: "V12 historical Aster order read-back" },
  "1046238272": { strategyId: "V12_X1.00_ALL", eventType: "EXIT_FILL", symbol: "INJUSDT", orderId: "1046238272", clientOrderId: "v12-stop-f85d849b7cab05aef7d792", reduceOnly: true, reason: "V12_PROTECTION_FILL_RECONCILED / historical Aster order read-back" },
  "1073622400": { strategyId: "PENGU_DUAL_LS_V2_FINAL", eventType: "ENTRY_FILL", symbol: "PENGUUSDT", orderId: "1073622400", clientOrderId: "dualls2-1a49e5cb0f7bfdd2bfcf04c8cd7b", reason: "PENGU historical Aster order read-back" },
  "1075020188": { strategyId: "PENGU_DUAL_LS_V2_FINAL", eventType: "EXIT_FILL", symbol: "PENGUUSDT", orderId: "1075020188", clientOrderId: "dualls2-f78f6a9c1b4b22fc7a3d4a21a26a", reduceOnly: true, reason: "PENGU historical Aster order read-back" },
  "4973997180": { strategyId: "V12_X1.00_ALL", eventType: "ENTRY_FILL", symbol: "SOLUSDT", orderId: "4973997180", clientOrderId: "v12-entry-c19288275c89afd5844402", reason: "V12 historical Aster order read-back" },
  "4975992672": { strategyId: "V12_X1.00_ALL", eventType: "EXIT_FILL", symbol: "SOLUSDT", orderId: "4975992672", clientOrderId: "mg-1-1-solusdt-1787337799358", reduceOnly: true, reason: "MARGIN_GUARD_FORCED_EXIT / V12" },
  "18019909741": { strategyId: "V12_X1.00_ALL", eventType: "ENTRY_FILL", symbol: "ETHUSDT", orderId: "18019909741", clientOrderId: "v12-entry-c7cb6157b2fe531e5b89cc", reason: "V12 historical Aster order read-back" },
  "1504868331": { strategyId: "V12_X1.00_ALL", eventType: "ENTRY_FILL", symbol: "AVAXUSDT", orderId: "1504868331", clientOrderId: "v12-entry-148241a03f73b47532066d", reason: "V12 historical Aster order read-back" },
  "18022294490": { strategyId: "V12_X1.00_ALL", eventType: "EXIT_FILL", symbol: "ETHUSDT", orderId: "18022294490", clientOrderId: "v12-stop-b74162cf3e84421a09093f", reduceOnly: true, reason: "V12_PROTECTION_FILL_RECONCILED / historical Aster order read-back" },
  "1505295369": { strategyId: "V12_X1.00_ALL", eventType: "EXIT_FILL", symbol: "AVAXUSDT", orderId: "1505295369", clientOrderId: "v12-stop-a4a7c259dfb35a84385821", reduceOnly: true, reason: "V12_PROTECTION_FILL_RECONCILED / historical Aster order read-back" },
  "3640714287": { strategyId: "V12_X1.00_ALL", eventType: "ENTRY_FILL", symbol: "XRPUSDT", orderId: "3640714287", clientOrderId: "v12-entry-7e80e45c300df53a7678c7", reason: "V12 historical Aster order read-back" },
  "1505763559": { strategyId: "V12_X1.00_ALL", eventType: "ENTRY_FILL", symbol: "AVAXUSDT", orderId: "1505763559", clientOrderId: "v12-entry-875612ef5a29781a849f3c", reason: "V12 historical Aster order read-back" },
  "1505955857": { strategyId: "V12_X1.00_ALL", eventType: "EXIT_FILL", symbol: "AVAXUSDT", orderId: "1505955857", clientOrderId: "v12-stop-48527e53ad9b1d99a15300", reduceOnly: true, reason: "V12_PROTECTION_FILL_RECONCILED / historical Aster order read-back" },

  "3754790615": { strategyId: "V12_X1.00_ALL", eventType: "ENTRY_FILL", symbol: "XRPUSDT", orderId: "3754790615", clientOrderId: "v12-entry-817f9d78aee6a971095456", reason: "V12 historical Aster order read-back" },
  "3755677028": { strategyId: "V12_X1.00_ALL", eventType: "EXIT_FILL", symbol: "XRPUSDT", orderId: "3755677028", clientOrderId: "v12-stop-95a250adea097aa69fc499", reduceOnly: true, reason: "V12_PROTECTION_FILL_RECONCILED / historical Aster order read-back" },

  "1118631921": { strategyId: "PENGU_DUAL_LS_V2_FINAL", eventType: "ENTRY_FILL", symbol: "PENGUUSDT", orderId: "1118631921", clientOrderId: "dualls2-47f1f5ac095505865c1260d3c38e", reason: "PENGU historical Aster order read-back" },
  "1120245457": { strategyId: "PENGU_DUAL_LS_V2_FINAL", eventType: "EXIT_FILL", symbol: "PENGUUSDT", orderId: "1120245457", clientOrderId: "mg-1-1-penguusdt-1789667173777", reduceOnly: true, reason: "MARGIN_GUARD_FORCED_EXIT / PENGU" },
  "1120664114": { strategyId: "PENGU_DUAL_LS_V2_FINAL", eventType: "ENTRY_FILL", symbol: "PENGUUSDT", orderId: "1120664114", clientOrderId: "rec-v8-restore-4bf30a10a75ead1d57601", routeLabel: "Recovery V8", entryVersion: "RECOVERY_V8", reason: "PENGU Recovery V8 restore / historical Aster order read-back" },

  "1446880778": { strategyId: "V12_X1.00_ALL", eventType: "EXIT_FILL", symbol: "LTCUSDT", orderId: "1446880778", clientOrderId: "mg-1-1-ltcusdt-1789793587793", reduceOnly: true, reason: "MARGIN_GUARD_FORCED_EXIT / V12" },

  "1547929214": { strategyId: "V12_X1.00_ALL", eventType: "ENTRY_FILL", symbol: "LINKUSDT", orderId: "1547929214", routeLabel: "Dynamic Residual", reason: "signal-entry-with-dynamic-residual / Production state archive" },
  "1547976000": { strategyId: "V12_X1.00_ALL", eventType: "EXIT_FILL", symbol: "LINKUSDT", orderId: "1547976000", clientOrderId: "mg-1-2-linkusdt-1789793588249", reduceOnly: true, routeLabel: "Dynamic Residual", reason: "MARGIN_GUARD_FORCED_EXIT / V12 Dynamic Residual" },
  "1548021388": { strategyId: "V12_X1.00_ALL", eventType: "ENTRY_FILL", symbol: "LINKUSDT", orderId: "1548021388", clientOrderId: "v12-entry-adc3340253027a871b9f2c", routeLabel: "Dynamic Residual", reason: "signal-entry-with-dynamic-residual / Production state archive" },
  "1548032432": { strategyId: "V12_X1.00_ALL", eventType: "EXIT_FILL", symbol: "LINKUSDT", orderId: "1548032432", reduceOnly: true, routeLabel: "Dynamic Residual", reason: "V12_PROTECTION_FILL_RECONCILED / Dynamic Residual" },

  "1449500751": { strategyId: "V12_X1.00_ALL", eventType: "ENTRY_FILL", symbol: "LTCUSDT", orderId: "1449500751", routeLabel: "Dynamic Residual", reason: "signal-entry-with-dynamic-residual / Production state archive" },
  "1449500769": { strategyId: "V12_X1.00_ALL", eventType: "EXIT_FILL", symbol: "LTCUSDT", orderId: "1449500769", clientOrderId: "v12-tp-cd0fe6a83501c052f8ca88", reduceOnly: true, routeLabel: "Dynamic Residual", reason: "V12_PROTECTION_FILL_RECONCILED / Dynamic Residual" },

  "543410575": { strategyId: "FET_BRK48_RESIDUAL", eventType: "ENTRY_FILL", symbol: "FETUSDT", orderId: "543410575", clientOrderId: "fet-entry-29fd82c9e457b158abf80e", reason: "FET BRK48 / historical Aster order read-back" },
};

export const HISTORICAL_FILL_LINEAGE_AUDIT = {
  schemaVersion: 1,
  evidence: "Aster GET /fapi/v3/order read-back plus immutable Production state archives",
  tradingMutation: 0,
} as const;
