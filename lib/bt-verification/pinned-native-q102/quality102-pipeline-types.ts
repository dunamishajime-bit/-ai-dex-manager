/** Strictly type-only snapshot extracted from native Q102 causal pipeline.
 * Original upstream lib/disdex-quality102-causal-pipeline.ts:
 * SHA256 7483c4ca504320ff9b4f06479c84418604d1b310aeeaa6c3574ae8ca5285ab8f
 * No runtime engine, venue access, or execution is imported.
 */
export type Quality102Side = -1|1;
export interface Quality102Candle {
 timestampMs:number;
 open:number;high:number;low:number;close:number;quoteVolume:number;
 baseVolume?:number;
}
