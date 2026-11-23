export type Quality102CausalV4Layer = "S3" | "S4";
export type Quality102CausalV4Family = "PB" | "MR" | "BRK" | "REV";

export interface Quality102CausalV4ModelRow {
  readonly key: string;
  readonly symbol: string;
  readonly variant: string;
  readonly family: Quality102CausalV4Family;
  readonly layer: Quality102CausalV4Layer;
  readonly developmentN: number;
  readonly developmentSpf: number;
  readonly developmentAvg: number;
}

export const QUALITY102_CAUSAL_V4_DEVELOPMENT_PERIOD = Object.freeze({
  startInclusive: "2025-03-01T00:00:00Z",
  endExclusive: "2025-08-01T00:00:00Z",
  source: "PRE_EVALUATION_DEVELOPMENT_ONLY" as const,
});

export const QUALITY102_CAUSAL_V4_S34_MODEL: readonly Quality102CausalV4ModelRow[] = Object.freeze([
  Object.freeze({ key: "AAVE|MR48_Z2.5_H24", symbol: "AAVEUSDT", variant: "MR48_Z2.5_H24", family: "MR", layer: "S3", developmentN: 10, developmentSpf: 1.52236777276818, developmentAvg: 0.0108654242977555 }),
  Object.freeze({ key: "APT|REV24_T0.05_H24", symbol: "APTUSDT", variant: "REV24_T0.05_H24", family: "REV", layer: "S3", developmentN: 44, developmentSpf: 1.27729468528803, developmentAvg: 0.00656674098033 }),
  Object.freeze({ key: "APT|REV6_T0.03_H24", symbol: "APTUSDT", variant: "REV6_T0.03_H24", family: "REV", layer: "S3", developmentN: 18, developmentSpf: 2.39382185041081, developmentAvg: 0.0215414819560662 }),
  Object.freeze({ key: "AVAX|MR24_Z1.5_H24", symbol: "AVAXUSDT", variant: "MR24_Z1.5_H24", family: "MR", layer: "S3", developmentN: 53, developmentSpf: 1.24626770590961, developmentAvg: 0.0057750426106673 }),
  Object.freeze({ key: "AVAX|PB168_0.1_P24_0.04_H24", symbol: "AVAXUSDT", variant: "PB168_0.1_P24_0.04_H24", family: "PB", layer: "S3", developmentN: 7, developmentSpf: 1.71016853501698, developmentAvg: 0.0110802317833757 }),
  Object.freeze({ key: "AVAX|REV12_T0.03_H12", symbol: "AVAXUSDT", variant: "REV12_T0.03_H12", family: "REV", layer: "S3", developmentN: 75, developmentSpf: 1.52026808715621, developmentAvg: 0.006927005619842 }),
  Object.freeze({ key: "AVAX|REV12_T0.03_H8", symbol: "AVAXUSDT", variant: "REV12_T0.03_H8", family: "REV", layer: "S3", developmentN: 78, developmentSpf: 1.40325068773588, developmentAvg: 0.0047583867652531 }),
  Object.freeze({ key: "AVAX|REV12_T0.08_H24", symbol: "AVAXUSDT", variant: "REV12_T0.08_H24", family: "REV", layer: "S3", developmentN: 9, developmentSpf: 2.3806830797075, developmentAvg: 0.0219786966819735 }),
  Object.freeze({ key: "DOGE|BRK24_H48_V1.0", symbol: "DOGEUSDT", variant: "BRK24_H48_V1.0", family: "BRK", layer: "S3", developmentN: 38, developmentSpf: 1.28734054076723, developmentAvg: 0.0096629482231092 }),
  Object.freeze({ key: "DOGE|BRK72_H48_V0.8", symbol: "DOGEUSDT", variant: "BRK72_H48_V0.8", family: "BRK", layer: "S3", developmentN: 29, developmentSpf: 1.35891257238384, developmentAvg: 0.0112041987595541 }),
  Object.freeze({ key: "DOGE|MR48_Z2.0_H12", symbol: "DOGEUSDT", variant: "MR48_Z2.0_H12", family: "MR", layer: "S4", developmentN: 35, developmentSpf: 1.47637548088035, developmentAvg: 0.0080984366274167 }),
  Object.freeze({ key: "DOGE|MR72_Z1.5_H12", symbol: "DOGEUSDT", variant: "MR72_Z1.5_H12", family: "MR", layer: "S4", developmentN: 72, developmentSpf: 1.38502939392078, developmentAvg: 0.0061897682920218 }),
  Object.freeze({ key: "DOGE|MR72_Z2.5_H12", symbol: "DOGEUSDT", variant: "MR72_Z2.5_H12", family: "MR", layer: "S4", developmentN: 11, developmentSpf: 1.43133377123862, developmentAvg: 0.0102975813022613 }),
  Object.freeze({ key: "DOT|BRK72_H48_V0.8", symbol: "DOTUSDT", variant: "BRK72_H48_V0.8", family: "BRK", layer: "S3", developmentN: 33, developmentSpf: 1.24740411002169, developmentAvg: 0.0065267354063517 }),
  Object.freeze({ key: "FET|BRK24_H48_V1.2", symbol: "FETUSDT", variant: "BRK24_H48_V1.2", family: "BRK", layer: "S3", developmentN: 39, developmentSpf: 1.32803399016521, developmentAvg: 0.0097905549346322 }),
  Object.freeze({ key: "FET|PB168_0.1_P24_0.02_H12", symbol: "FETUSDT", variant: "PB168_0.1_P24_0.02_H12", family: "PB", layer: "S3", developmentN: 26, developmentSpf: 2.00067621132769, developmentAvg: 0.0100534613762825 }),
  Object.freeze({ key: "FET|PB72_0.1_P12_0.04_H12", symbol: "FETUSDT", variant: "PB72_0.1_P12_0.04_H12", family: "PB", layer: "S3", developmentN: 13, developmentSpf: 1.81484714670338, developmentAvg: 0.0095011104136757 }),
  Object.freeze({ key: "FET|REV12_T0.05_H12", symbol: "FETUSDT", variant: "REV12_T0.05_H12", family: "REV", layer: "S3", developmentN: 50, developmentSpf: 1.58520129707493, developmentAvg: 0.0087653491849914 }),
  Object.freeze({ key: "FET|REV12_T0.08_H24", symbol: "FETUSDT", variant: "REV12_T0.08_H24", family: "REV", layer: "S3", developmentN: 11, developmentSpf: 8.08070422039161, developmentAvg: 0.0413021804029054 }),
  Object.freeze({ key: "FET|REV24_T0.05_H8", symbol: "FETUSDT", variant: "REV24_T0.05_H8", family: "REV", layer: "S3", developmentN: 69, developmentSpf: 1.29882917503414, developmentAvg: 0.0043871257099106 }),
  Object.freeze({ key: "FET|REV24_T0.08_H8", symbol: "FETUSDT", variant: "REV24_T0.08_H8", family: "REV", layer: "S3", developmentN: 31, developmentSpf: 1.90794772499766, developmentAvg: 0.0096499259228725 }),
  Object.freeze({ key: "LDO|BRK24_H24_V1.0", symbol: "LDOUSDT", variant: "BRK24_H24_V1.0", family: "BRK", layer: "S3", developmentN: 57, developmentSpf: 1.31281148909032, developmentAvg: 0.0076779880422025 }),
  Object.freeze({ key: "LDO|BRK48_H24_V1.0", symbol: "LDOUSDT", variant: "BRK48_H24_V1.0", family: "BRK", layer: "S3", developmentN: 48, developmentSpf: 1.31622876544241, developmentAvg: 0.008453791923583 }),
  Object.freeze({ key: "NEAR|BRK168_H24_V1.2", symbol: "NEARUSDT", variant: "BRK168_H24_V1.2", family: "BRK", layer: "S3", developmentN: 27, developmentSpf: 1.48840221382932, developmentAvg: 0.0091330294375599 }),
  Object.freeze({ key: "NEAR|BRK48_H48_V1.2", symbol: "NEARUSDT", variant: "BRK48_H48_V1.2", family: "BRK", layer: "S3", developmentN: 38, developmentSpf: 1.31919794984148, developmentAvg: 0.0089832346064616 }),
  Object.freeze({ key: "RENDER|BRK168_H12_V1.2", symbol: "RENDERUSDT", variant: "BRK168_H12_V1.2", family: "BRK", layer: "S4", developmentN: 37, developmentSpf: 1.2461023118082, developmentAvg: 0.0043356885581458 }),
  Object.freeze({ key: "SOL|BRK24_H48_V1.2", symbol: "SOLUSDT", variant: "BRK24_H48_V1.2", family: "BRK", layer: "S3", developmentN: 37, developmentSpf: 1.78857139913644, developmentAvg: 0.0179361486336277 }),
  Object.freeze({ key: "SOL|BRK72_H48_V1.2", symbol: "SOLUSDT", variant: "BRK72_H48_V1.2", family: "BRK", layer: "S3", developmentN: 25, developmentSpf: 1.75061992691195, developmentAvg: 0.0171229061115549 }),
  Object.freeze({ key: "UNI|MR24_Z2.0_H24", symbol: "UNIUSDT", variant: "MR24_Z2.0_H24", family: "MR", layer: "S4", developmentN: 19, developmentSpf: 1.82181594946119, developmentAvg: 0.0177824545392012 }),
  Object.freeze({ key: "UNI|MR48_Z1.5_H24", symbol: "UNIUSDT", variant: "MR48_Z1.5_H24", family: "MR", layer: "S4", developmentN: 63, developmentSpf: 1.46705889766814, developmentAvg: 0.0097478033268243 }),
  Object.freeze({ key: "UNI|MR72_Z1.5_H24", symbol: "UNIUSDT", variant: "MR72_Z1.5_H24", family: "MR", layer: "S4", developmentN: 56, developmentSpf: 1.26613814311217, developmentAvg: 0.006291723493164 }),
]);

export const QUALITY102_CAUSAL_V4_S34_KEYS = Object.freeze(QUALITY102_CAUSAL_V4_S34_MODEL.map((row) => row.key));

export const QUALITY102_CAUSAL_V4_CAPABILITIES = Object.freeze({
  selectorImplemented: true,
  derivedHighVolGeneratorImplemented: true,
  s34GeneratorImplemented: true,
  s34ModelKeyCount: QUALITY102_CAUSAL_V4_S34_MODEL.length,
  fixedHistoricalTradeTimestamps: false,
  noLookaheadByConstruction: true,
  historicalSelectorParity: false,
});
