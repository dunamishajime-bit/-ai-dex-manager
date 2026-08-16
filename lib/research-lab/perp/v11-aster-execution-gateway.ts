import {
  AsterApiError,
  AsterRequestDeadlineError,
  AsterV3Client,
  type AsterOrderResponse,
} from "@/lib/aster-v3-client";
import {
  V11ExecutionUnknownError,
  V11OrderNotFoundError,
  V11StaleEntryError,
  type V11AsterGateway,
  type V11OrderSnapshot,
  type V11OrderStatus,
} from "./v11-execution-safety";

function normalizeStatus(value?: string): V11OrderStatus {
  switch (String(value || "").toUpperCase()) {
    case "NEW": return "NEW";
    case "PARTIALLY_FILLED": return "PARTIALLY_FILLED";
    case "FILLED": return "FILLED";
    case "CANCELED": return "CANCELED";
    case "EXPIRED": return "EXPIRED";
    case "REJECTED": return "REJECTED";
    default: return "UNKNOWN";
  }
}

function snapshot(order: AsterOrderResponse): V11OrderSnapshot {
  return {
    clientOrderId: String(order.clientOrderId || ""),
    symbol: String(order.symbol || "").toUpperCase(),
    status: normalizeStatus(order.status),
    reduceOnly: order.reduceOnly,
    stopPrice: order.stopPrice,
  };
}

function isOrderNotFound(error: unknown) {
  if (!(error instanceof AsterApiError)) return false;
  if (error.code === -2011 || error.code === -2013) return true;
  return /order (does not exist|not found)|unknown order/i.test(error.message);
}

function executionUnknown(error: unknown) {
  if (error instanceof AsterApiError && error.executionUnknown) {
    return new V11ExecutionUnknownError(error.message);
  }
  return null;
}

/** Concrete research adapter joining entry, reconciliation, and protective
 * orders on one AsterV3Client. A single client keeps one monotonic nonce stream
 * per Agent signer inside each executor. It does not enable trading by itself. */
export class V11AsterExecutionGateway implements V11AsterGateway {
  constructor(private readonly tradingClient: AsterV3Client) {}

  async isOneWayMode() {
    const mode = await this.tradingClient.getPositionMode();
    return mode.dualSidePosition === false;
  }

  async supportsStopMarket(symbol: string) {
    const normalized = symbol.toUpperCase();
    const info = await this.tradingClient.getExchangeInfo();
    const row = info.symbols.find((item) => item.symbol?.toUpperCase() === normalized);
    return row?.status === "TRADING" && (row.orderTypes || []).includes("STOP_MARKET");
  }

  async getOrder(symbol: string, clientOrderId: string) {
    try {
      return snapshot(await this.tradingClient.getOrder(symbol.toUpperCase(), clientOrderId));
    } catch (error) {
      if (isOrderNotFound(error)) throw new V11OrderNotFoundError();
      throw error;
    }
  }

  async placeMarket(input: Parameters<V11AsterGateway["placeMarket"]>[0]) {
    try {
      return snapshot(await this.tradingClient.placeMarketOrder({
        symbol: input.symbol.toUpperCase(),
        side: input.side,
        quantity: input.quantity,
        positionSide: "BOTH",
        reduceOnly: false,
        newClientOrderId: input.clientOrderId,
        newOrderRespType: "RESULT",
        deadlineTs: input.deadlineTs,
      }));
    } catch (error) {
      if (error instanceof AsterRequestDeadlineError) throw new V11StaleEntryError(error.message);
      const unknown = executionUnknown(error);
      if (unknown) throw unknown;
      throw error;
    }
  }

  async placeReduceOnlyStopMarket(input: Parameters<V11AsterGateway["placeReduceOnlyStopMarket"]>[0]) {
    try {
      return snapshot(await this.tradingClient.placeReduceOnlyStopMarket({
        symbol: input.symbol.toUpperCase(),
        side: input.side,
        quantity: input.quantity,
        stopPrice: input.stopPrice,
        newClientOrderId: input.clientOrderId,
        workingType: "CONTRACT_PRICE",
        priceProtect: false,
      }));
    } catch (error) {
      const unknown = executionUnknown(error);
      if (unknown) throw unknown;
      throw error;
    }
  }

  async cancelOrder(symbol: string, clientOrderId: string) {
    try {
      return snapshot(await this.tradingClient.cancelOrder(symbol.toUpperCase(), clientOrderId));
    } catch (error) {
      const unknown = executionUnknown(error);
      if (unknown) throw unknown;
      throw error;
    }
  }
}
