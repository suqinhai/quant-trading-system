// ============================================================================
// @quant/market-data 包入口文件
// 导出所有公共 API：类型定义、MarketDataEngine、工具函数
// ============================================================================

// ============================================================================
// 类型导出
// ============================================================================

// 导出所有类型定义
export type {
  // 交易所枚举类型
  ExchangeId,

  // 订阅频道类型
  ChannelType,

  // 统一时间戳接口
  UnifiedTimestamp,

  // 统一数据格式
  UnifiedTicker,
  UnifiedDepth,
  UnifiedTrade,
  UnifiedFundingRate,
  UnifiedMarketData,

  // 深度数据档位类型
  DepthLevel,

  // 订阅相关类型
  SubscriptionConfig,
  SubscriptionState,

  // WebSocket 连接类型
  WsConnectionState,
  WsConnectionInfo,

  // Redis 配置类型
  RedisConfig,
  TimeSeriesRetention,

  // 引擎配置类型
  MarketDataEngineConfig,
  MarketDataEngineEvents,

  // 统计类型
  EngineStats,
} from './types.js';

// 导出常量
export {
  // 支持的交易所列表
  SUPPORTED_EXCHANGES,
  // 默认配置
  DEFAULT_CONFIG,
} from './types.js';

// ============================================================================
// 主类导出
// ============================================================================

// 导出 MarketDataEngine 主类
export { MarketDataEngine } from './engine.js';

// 导出 WebSocket 连接管理器（高级用法）
export { WsConnectionManager } from './ws-manager.js';

// 导出 Redis 客户端（高级用法）
export { RedisClient } from './redis-client.js';

// ============================================================================
// 工具函数导出
// ============================================================================

// 导出数据标准化函数
export {
  // 符号转换
  normalizeSymbol,
  denormalizeSymbol,

  // 消息解析（按交易所）
  parseBinanceMessage,
  parseBybitMessage,
  parseOkxMessage,

  // 统一消息解析
  parseMessage,

  // Binance 解析器
  parseBinanceTicker,
  parseBinanceDepth,
  parseBinanceAggTrade,
  parseBinanceFundingRate,

  // Bybit 解析器
  parseBybitTicker,
  parseBybitDepth,
  parseBybitTrades,
  parseBybitFundingRate,

  // OKX 解析器
  parseOkxTicker,
  parseOkxDepth,
  parseOkxTrades,
  parseOkxFundingRate,
} from './normalizer.js';

// ============================================================================
// 使用示例
// ============================================================================

/**
 * @example 基础使用
 * ```typescript
 * import {
 *   MarketDataEngine,
 *   type MarketDataEngineConfig,
 *   type UnifiedTicker,
 * } from '@quant/market-data';
 *
 * // 创建配置
 * const config: MarketDataEngineConfig = {
 *   redis: {
 *     host: 'localhost',
 *     port: 6379,
 *   },
 *   enableTimeSeries: true,
 *   enablePubSub: true,
 * };
 *
 * // 创建引擎实例
 * const engine = new MarketDataEngine(config);
 *
 * // 监听 ticker 数据
 * engine.on('ticker', (ticker: UnifiedTicker) => {
 *   console.log(`[${ticker.exchange}] ${ticker.symbol}: ${ticker.last}`);
 * });
 *
 * // 启动引擎
 * await engine.start();
 *
 * // 订阅 Binance BTC 和 ETH 的 ticker 数据
 * engine.subscribeTicker('binance', ['BTC/USDT:USDT', 'ETH/USDT:USDT']);
 *
 * // 订阅 Bybit 深度数据
 * engine.subscribeDepth('bybit', ['BTC/USDT:USDT'], 5);
 *
 * // 订阅 OKX 成交数据
 * engine.subscribeTrades('okx', ['BTC/USDT:USDT']);
 *
 * // 获取统计信息
 * const stats = engine.getStats();
 * console.log('Messages per second:', stats.messages.perSecond);
 *
 * // 停止引擎
 * await engine.stop();
 * ```
 *
 * @example 订阅多个交易所
 * ```typescript
 * import { MarketDataEngine } from '@quant/market-data';
 *
 * const engine = new MarketDataEngine({
 *   redis: { host: 'localhost', port: 6379 },
 * });
 *
 * await engine.start();
 *
 * // 同时订阅三个交易所的 BTC ticker
 * const symbols = ['BTC/USDT:USDT'];
 *
 * engine.subscribeTicker('binance', symbols);
 * engine.subscribeTicker('bybit', symbols);
 * engine.subscribeTicker('okx', symbols);
 *
 * // 监听所有 ticker
 * engine.on('ticker', (ticker) => {
 *   console.log(`${ticker.exchange}: ${ticker.last}`);
 * });
 * ```
 *
 * @example 动态订阅/取消订阅
 * ```typescript
 * import { MarketDataEngine } from '@quant/market-data';
 *
 * const engine = new MarketDataEngine({
 *   redis: { host: 'localhost', port: 6379 },
 * });
 *
 * await engine.start();
 *
 * // 订阅
 * engine.subscribe({
 *   exchange: 'binance',
 *   symbols: ['BTC/USDT:USDT', 'ETH/USDT:USDT'],
 *   channels: ['ticker', 'depth5', 'aggTrade'],
 * });
 *
 * // 稍后取消订阅 ETH
 * setTimeout(() => {
 *   engine.unsubscribe({
 *     exchange: 'binance',
 *     symbols: ['ETH/USDT:USDT'],
 *     channels: ['ticker', 'depth5', 'aggTrade'],
 *   });
 * }, 60000);
 * ```
 *
 * @example 使用标准化函数
 * ```typescript
 * import {
 *   normalizeSymbol,
 *   denormalizeSymbol,
 *   parseMessage,
 * } from '@quant/market-data';
 *
 * // 符号转换
 * const unified = normalizeSymbol('binance', 'BTCUSDT');
 * console.log(unified); // 'BTC/USDT:USDT'
 *
 * const raw = denormalizeSymbol('okx', 'BTC/USDT:USDT');
 * console.log(raw); // 'BTC-USDT-SWAP'
 *
 * // 解析原始消息
 * const data = parseMessage('binance', rawJsonString);
 * for (const item of data) {
 *   console.log(item.type, item.symbol, item.timestamp);
 * }
 * ```
 *
 * @example 监听连接事件
 * ```typescript
 * import { MarketDataEngine } from '@quant/market-data';
 *
 * const engine = new MarketDataEngine({
 *   redis: { host: 'localhost', port: 6379 },
 * });
 *
 * // 连接成功
 * engine.on('connected', (exchange) => {
 *   console.log(`Connected to ${exchange}`);
 * });
 *
 * // 连接断开
 * engine.on('disconnected', (exchange, reason) => {
 *   console.log(`Disconnected from ${exchange}: ${reason}`);
 * });
 *
 * // 正在重连
 * engine.on('reconnecting', (exchange, attempt) => {
 *   console.log(`Reconnecting to ${exchange}, attempt ${attempt}`);
 * });
 *
 * // 错误
 * engine.on('error', (error, context) => {
 *   console.error(`Error: ${error.message}`, context);
 * });
 *
 * await engine.start();
 * ```
 */
