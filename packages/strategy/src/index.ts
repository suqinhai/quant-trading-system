// ============================================================================
// @quant/strategy 包入口文件
// 导出所有公共 API：技术指标、策略基类、资金费率套利策略
// ============================================================================

// === 技术指标 ===
export { Indicators } from './indicators.js';
export type {
  IndicatorResult,
  MACDResult,
  BollingerBandsResult,
  RSIResult,
  ATRResult,
} from './indicators.js';

// === 策略基类 ===
export { BaseStrategy } from './base.js';
export type { StrategyParams, StrategyState as BaseStrategyState } from './base.js';

// === 示例策略 ===
export { DualMAStrategy, RSIStrategy } from './examples/index.js';
export type { DualMAParams, RSIParams } from './examples/index.js';

// ============================================================================
// 资金费率套利策略导出
// ============================================================================

// === 类型导出 ===
export type {
  // 基础类型
  ExchangeId,
  PositionSide,
  OrderSide,
  Timestamp,

  // 资金费率类型
  ExchangeFundingRate,
  FundingRateHistory,
  FundingRatePrediction,

  // 套利机会类型
  ArbitrageOpportunity,
  ArbitrageDirection,

  // 库存管理类型
  ExchangeInventory,
  TotalInventory,
  RebalanceAction,

  // 仓位管理类型
  PositionSizeParams,
  PositionSizeResult,
  RiskLimits,

  // 策略配置类型
  FundingArbitrageConfig,

  // 策略状态类型
  StrategyState as FundingStrategyState,
  StrategyMetrics,

  // 信号类型
  TradeSignal,
} from './types.js';

// === 常量导出 ===
export {
  SUPPORTED_EXCHANGES,
  DEFAULT_RISK_LIMITS,
  DEFAULT_FUNDING_ARBITRAGE_CONFIG,
} from './types.js';

// === 工具函数导出 ===
export {
  annualizeFundingRate,
  calculateFundingSpread,
  generateArbitrageId,
  generateId,
} from './types.js';

// === 资金费率计算器 ===
export {
  FundingCalculator,
  createFundingCalculator,
} from './funding-calculator.js';

// === 库存管理器 ===
export type {
  InventoryConfig,
} from './inventory-manager.js';

export {
  InventoryManager,
  createInventoryManager,
  DEFAULT_INVENTORY_CONFIG,
} from './inventory-manager.js';

// === 仓位计算器 ===
export type {
  PositionSizerConfig,
} from './position-sizer.js';

export {
  PositionSizer,
  createPositionSizer,
  DEFAULT_POSITION_SIZER_CONFIG,
} from './position-sizer.js';

// === 套利检测器 ===
export type {
  ArbitrageDetectorConfig,
  ArbitrageOpportunityDetails,
} from './arbitrage-detector.js';

export {
  ArbitrageDetector,
  createArbitrageDetector,
  DEFAULT_ARBITRAGE_DETECTOR_CONFIG,
} from './arbitrage-detector.js';

// === 资金费率套利策略 ===
export {
  FundingArbitrageStrategy,
  createFundingArbitrageStrategy,
} from './funding-arbitrage.js';

// ============================================================================
// 风险管理器导出
// ============================================================================

// === 风险管理器类型 ===
export type {
  RiskManagerConfig,
  PositionInfo,
  AccountInfo,
  LiquidationInfo,
  RiskEventType,
  RiskEvent,
  RiskState,
  Executor,
} from './risk-manager.js';

// === 风险管理器 ===
export {
  RiskManager,
  getRiskManager,
  resetRiskManager,
  DEFAULT_RISK_MANAGER_CONFIG,
} from './risk-manager.js';

// ============================================================================
// 订单执行器导出
// ============================================================================

// === 订单执行器类型 ===
export type {
  OrderType,
  OrderStatus,
  OrderRequest,
  OrderResult,
  PriceLevel,
  OrderBookSnapshot,
  AccountConfig,
  OrderExecutorConfig,
  ExchangeAdapter,
} from './order-executor.js';

// === 订单执行器 ===
export {
  OrderExecutor,
  createOrderExecutor,
  DEFAULT_EXECUTOR_CONFIG,
} from './order-executor.js';

// ============================================================================
// 使用示例
// ============================================================================

/**
 * @example 资金费率套利策略 - 基础使用
 * ```typescript
 * import {
 *   createFundingArbitrageStrategy,
 *   type ExchangeId,
 * } from '@quant/strategy';
 *
 * // 创建策略
 * const strategy = createFundingArbitrageStrategy({
 *   symbols: ['BTC/USDT:USDT', 'ETH/USDT:USDT'],
 *   minSpreadToOpen: 0.15,    // 年化利差 > 15% 开仓
 *   minSpreadToHold: 0.05,    // 年化利差 > 5% 维持
 *   targetSharpeRatio: 4.0,   // 目标夏普 > 4.0
 *   targetMaxDrawdown: 0.08,  // 目标回撤 < 8%
 * });
 *
 * // 启动策略
 * strategy.start(10000);
 *
 * // 更新资金费率
 * strategy.updateFundingRate(
 *   'binance', 'BTC/USDT:USDT',
 *   0.0001, 0.00012, 42000, 41990, Date.now() + 8 * 60 * 60 * 1000
 * );
 *
 * // 生成交易信号
 * const signals = strategy.tick();
 *
 * // 获取策略指标
 * const metrics = strategy.getMetrics();
 * console.log(`夏普比率: ${metrics.sharpeRatio.toFixed(2)}`);
 * ```
 *
 * @example 资金费率计算器 - 单独使用
 * ```typescript
 * import { createFundingCalculator } from '@quant/strategy';
 *
 * const calculator = createFundingCalculator();
 *
 * // 更新费率
 * calculator.updateRate('binance', 'BTC/USDT:USDT', 0.0001, 0.0001, 42000, 41990, Date.now());
 * calculator.updateRate('bybit', 'BTC/USDT:USDT', 0.0003, 0.0003, 42000, 41990, Date.now());
 *
 * // 获取最大利差
 * const maxSpread = calculator.getMaxSpread('BTC/USDT:USDT');
 * console.log(`利差: ${(maxSpread?.spread * 100).toFixed(2)}%`);
 * ```
 *
 * @example 库存管理器 - 单独使用
 * ```typescript
 * import { createInventoryManager } from '@quant/strategy';
 *
 * const inventory = createInventoryManager({
 *   rebalanceThreshold: 0.20,
 *   maxInventoryRatio: 0.30,
 * });
 *
 * inventory.setEquity(10000);
 * inventory.updatePosition('binance', 'BTC/USDT:USDT', 'long', 0.1, 42000, 3);
 *
 * // 检查再平衡
 * if (inventory.needsRebalance('BTC/USDT:USDT')) {
 *   const actions = inventory.generateRebalanceActions('BTC/USDT:USDT');
 * }
 * ```
 *
 * @example 风险管理器 - 单例使用
 * ```typescript
 * import {
 *   getRiskManager,
 *   type Executor,
 *   type RiskEvent,
 * } from '@quant/strategy';
 *
 * // 创建执行器（需要实现 Executor 接口）
 * const executor: Executor = {
 *   async emergencyCloseAll() { ... },
 *   async reducePosition(exchange, symbol, ratio) { ... },
 *   pauseAllStrategies(reason) { ... },
 *   resumeAllStrategies() { ... },
 * };
 *
 * // 获取风险管理器单例
 * const riskManager = getRiskManager({
 *   minMarginRatio: 0.35,      // 保证金率 < 35% 全平
 *   maxPositionRatio: 0.12,    // 单币种 > 12% 报警
 *   btcCrashThreshold: 0.06,   // BTC 10分钟跌幅 > 6%
 *   maxDailyDrawdown: 0.07,    // 当日回撤 > 7% 暂停
 * });
 *
 * // 启动风控
 * riskManager.start(executor, 10000);
 *
 * // 监听风控事件
 * riskManager.onRiskEvent((event: RiskEvent) => {
 *   console.log(`风控事件: ${event.type} - ${event.message}`);
 * });
 *
 * // 更新账户信息
 * riskManager.updateAccount({
 *   exchange: 'binance',
 *   totalEquity: 10000,
 *   availableBalance: 5000,
 *   totalMargin: 5000,
 *   totalNotional: 15000,
 *   marginRatio: 0.67,
 *   unrealizedPnl: 100,
 *   updatedAt: Date.now(),
 * });
 *
 * // 更新 BTC 价格（用于崩盘检测）
 * riskManager.updateBtcPrice(42000);
 *
 * // 获取强平价信息
 * const liquidations = riskManager.getLiquidationInfos();
 * ```
 *
 * @example 订单执行器 - 高可靠下单
 * ```typescript
 * import {
 *   createOrderExecutor,
 *   type ExchangeAdapter,
 *   type OrderRequest,
 * } from '@quant/strategy';
 *
 * // 创建交易所适配器（需要实现 ExchangeAdapter 接口）
 * const adapter: ExchangeAdapter = {
 *   async submitOrder(accountId, request, nonce) { ... },
 *   async cancelOrder(accountId, exchange, symbol, orderId) { ... },
 *   async getOrderStatus(accountId, exchange, symbol, orderId) { ... },
 *   async getOrderBook(exchange, symbol, depth) { ... },
 * };
 *
 * // 创建订单执行器
 * const executor = createOrderExecutor(adapter, {
 *   defaultTimeout: 300,         // 300ms 超时
 *   defaultMaxRetries: 3,        // 最多重试 3 次
 *   enableSelfTradeProtection: true,  // 启用自成交防护
 * });
 *
 * // 添加账户
 * executor.addAccount({
 *   accountId: 'account1',
 *   exchange: 'binance',
 *   apiKey: 'xxx',
 *   apiSecret: 'yyy',
 *   enabled: true,
 *   weight: 1,
 *   maxConcurrent: 5,
 *   currentNonce: Date.now(),
 * });
 *
 * // 启动执行器
 * executor.start();
 *
 * // 执行 post-only 订单
 * const result = await executor.executePostOnly({
 *   exchange: 'binance',
 *   symbol: 'BTC/USDT:USDT',
 *   side: 'buy',
 *   type: 'post_only',
 *   quantity: 0.01,
 *   price: 42000,
 * });
 *
 * // 批量执行订单（并行）
 * const results = await executor.executeOrders([
 *   { exchange: 'binance', symbol: 'BTC/USDT:USDT', side: 'buy', type: 'market', quantity: 0.01 },
 *   { exchange: 'bybit', symbol: 'BTC/USDT:USDT', side: 'sell', type: 'market', quantity: 0.01 },
 * ]);
 *
 * // 紧急全平
 * await executor.emergencyCloseAll();
 * ```
 */
