// ============================================================================
// @quant/marketdata 包入口文件
// 导出所有公共 API
// ============================================================================

// === 类型导出 ===
export type {
  // K 线相关
  KlineInterval,
  Kline,

  // 订单簿相关
  PriceLevel,
  OrderBook,
  OrderBookUpdate,

  // 成交相关
  Tick,
  AggTrade,

  // Ticker 相关
  Ticker,
  MiniTicker,

  // 资金费率
  FundingRate,

  // 订阅相关
  SubscriptionType,
  Subscription,

  // 事件
  MarketDataEvents,
} from './types.js';

// 导出工具函数
export { getSubscriptionKey } from './types.js';

// === 管理器导出 ===
export { OrderBookManager } from './orderbook.js';
export { KlineManager } from './kline.js';

// === 引擎导出 ===
export { MarketDataEngine } from './engine.js';
export type { MarketDataEngineConfig } from './engine.js';
