import assert from "node:assert/strict";
import { test } from "node:test";
import { AsterRecoveryV8ProtectiveOrderGateway, normalizeRecoveryV8OrderValue, placeRecoveryV8EntryHardStop } from "@/lib/pengu-recovery-v8-protective-orders";

test("PENGU Recovery V8 formats protective stop values to the venue filters", async () => {
    assert.equal(normalizeRecoveryV8OrderValue(0.00652172, "0.0000010", 7), "0.006521");
    assert.equal(normalizeRecoveryV8OrderValue(4354, "1", 0), "4354");

    let submitted: { quantity?: string; stopPrice?: string } | undefined;
    const client = {
        getExchangeInfo: async () => ({
            symbols: [{
                symbol: "PENGUUSDT",
                pricePrecision: 7,
                quantityPrecision: 0,
                filters: [
                    { filterType: "PRICE_FILTER", tickSize: "0.0000010" },
                    { filterType: "LOT_SIZE", stepSize: "1", minQty: "1" },
                ],
            }],
        }),
        placeStopMarketOrder: async (input: { quantity: string; stopPrice: string; newClientOrderId: string }) => {
            submitted = input;
            return {
                symbol: "PENGUUSDT",
                clientOrderId: input.newClientOrderId,
                status: "NEW",
                reduceOnly: true,
                origQty: input.quantity,
                stopPrice: input.stopPrice,
            };
        },
    } as never;
    const gateway = new AsterRecoveryV8ProtectiveOrderGateway(client);
    await placeRecoveryV8EntryHardStop(gateway, {
        symbol: "PENGUUSDT",
        quantity: 4354,
        entryTs: 1_000_000,
        entryPrice: 0.006938,
    });
    assert.equal(submitted?.quantity, "4354");
    assert.equal(submitted?.stopPrice, "0.006521");
});
