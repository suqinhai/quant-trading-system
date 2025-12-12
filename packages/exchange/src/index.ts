// ============================================================================
// @quant/exchange 包入口文件
// 导出所有公共 API：类型定义、Zod Schemas、交易所适配器、工厂函数
// ============================================================================

// ============================================================================
// Zod Schemas 和类型导出
// ============================================================================

// 导出所有 Zod schemas（用于运行时验证）
export {
  // 基础枚举 schemas
  OrderSideSchema,
  OrderTypeSchema,
  OrderStatusSchema,
  PositionSideSchema,
  MarginModeSchema,
  TimeframeSchema,

  // 订单相关 schemas
  CreateOrderRequestSchema,
  OrderResultSchema,

  // 持仓和余额 schemas
  PositionSchema,
  BalanceItemSchema,
  BalanceSchema,

  // 资金费率 schema
  FundingRateSchema,

  // 市场数据 schemas
  KlineSchema,
  TickerSchema,
  OrderBookSchema,
  TradeSchema,
  MarketSchema,

  // WebSocket 消息 schemas
  WsMessageTypeSchema,
  WsMessageSchema,

  // 配置 schema
  ExchangeConfigSchema,

  // 错误相关 schemas
  ExchangeErrorTypeSchema,
  ExchangeErrorSchema,

  // 验证辅助函数
  validate,
  safeValidate,
} from './schemas';

// 导出所有类型（从 Zod schemas 推断）
export type {
  // 基础枚举类型
  OrderSide,
  OrderType,
  OrderStatus,
  PositionSide,
  MarginMode,
  Timeframe,

  // 订单相关类型
  CreateOrderRequest,
  OrderResult,

  // 持仓和余额类型
  Position,
  BalanceItem,
  Balance,

  // 资金费率类型
  FundingRate,

  // 市场数据类型
  Kline,
  Ticker,
  OrderBook,
  Trade,
  Market,

  // WebSocket 消息类型
  WsMessageType,
  WsMessage,

  // 配置类型
  ExchangeConfig,

  // 错误相关类型
  ExchangeErrorType,
  ExchangeError,
} from './schemas';

// ============================================================================
// 基类和异常导出
// ============================================================================

// 导出抽象基类（用于扩展自定义交易所）
export { BaseExchange, ExchangeException } from './base-exchange';

// 导出事件类型
export type { ExchangeEvents } from './base-exchange';

// ============================================================================
// 交易所适配器导出
// ============================================================================

// 导出所有交易所适配器类
export {
  // 币安期货适配器
  BinanceFutures,
  // Bybit V5 适配器
  BybitV5,
  // OKX 适配器
  OKX,
} from './exchanges/index';

// ============================================================================
// 工厂函数和辅助函数导出
// ============================================================================

// 导出工厂函数和辅助函数
export {
  // 创建交易所实例的工厂函数
  createExchange,
  // 检查交易所是否支持
  isExchangeSupported,
  // 获取交易所配置模板
  getExchangeConfigTemplate,
  // 获取交易所特性信息
  getExchangeFeatures,
  // 支持的交易所列表
  SUPPORTED_EXCHANGES,
} from './exchanges/index';

// 导出交易所名称类型
export type { ExchangeName } from './exchanges/index';

// ============================================================================
// 使用示例
// ============================================================================

/**
 * @example 创建交易所实例
 * ```typescript
 * import {
 *   createExchange,
 *   type ExchangeConfig,
 *   type OrderResult,
 * } from '@quant/exchange';
 *
 * // 创建币安期货实例
 * const binance = createExchange('binance_futures', {
 *   apiKey: 'your-api-key',
 *   apiSecret: 'your-api-secret',
 *   testnet: true,
 * });
 *
 * // 加载市场信息
 * await binance.loadMarkets();
 *
 * // 获取账户余额
 * const balance = await binance.getBalance();
 * console.log('Total Equity:', balance.totalEquity);
 *
 * // 获取持仓
 * const positions = await binance.getPositions();
 * for (const pos of positions) {
 *   console.log(`${pos.symbol}: ${pos.side} ${pos.amount}`);
 * }
 *
 * // 创建订单
 * const order: OrderResult = await binance.createOrder({
 *   symbol: 'BTC/USDT:USDT',
 *   side: 'buy',
 *   type: 'limit',
 *   amount: 0.001,
 *   price: 50000,
 * });
 *
 * // 订阅实时数据
 * binance.on('ticker', (ticker) => {
 *   console.log(`${ticker.symbol}: ${ticker.last}`);
 * });
 *
 * await binance.subscribeTicker('BTC/USDT:USDT');
 * ```
 *
 * @example 使用 OKX 交易所
 * ```typescript
 * import { createExchange } from '@quant/exchange';
 *
 * // OKX 需要 passphrase
 * const okx = createExchange('okx', {
 *   apiKey: 'your-api-key',
 *   apiSecret: 'your-api-secret',
 *   passphrase: 'your-passphrase',
 *   sandbox: true, // 使用模拟盘
 * });
 *
 * await okx.loadMarkets();
 * const fundingRate = await okx.getFundingRate('BTC/USDT:USDT');
 * console.log('Funding Rate:', fundingRate.fundingRate);
 * ```
 *
 * @example 使用 Zod 验证
 * ```typescript
 * import {
 *   CreateOrderRequestSchema,
 *   validate,
 *   safeValidate,
 * } from '@quant/exchange';
 *
 * // 严格验证（失败会抛出异常）
 * const request = validate(CreateOrderRequestSchema, {
 *   symbol: 'BTC/USDT:USDT',
 *   side: 'buy',
 *   type: 'market',
 *   amount: 0.001,
 * });
 *
 * // 安全验证（不抛出异常）
 * const result = safeValidate(CreateOrderRequestSchema, data);
 * if (result.success) {
 *   console.log('Valid:', result.data);
 * } else {
 *   console.error('Invalid:', result.error.issues);
 * }
 * ```
 */
