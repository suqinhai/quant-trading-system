// ============================================================================
// @quant/backtester 包入口文件
// 导出所有公共 API：类型定义、回测引擎、策略接口
// ============================================================================

// ============================================================================
// 类型导出
// ============================================================================

// 导出所有类型定义
export type {
  // 基础类型
  ExchangeId,
  OrderSide,
  OrderType,
  OrderStatus,
  PositionSide,
  Timestamp,

  // 事件类型
  BaseEvent,
  TradeEvent,
  DepthEvent,
  PriceLevel,
  FundingEvent,
  MarkPriceEvent,
  KlineEvent,
  OrderFilledEvent,
  LiquidationEvent,
  BacktestEvent,

  // 订单类型
  OrderRequest,
  Order,

  // 持仓类型
  Position,

  // 账户类型
  Account,

  // 配置类型
  FeeConfig,
  SlippageConfig,
  SlippageModelType,
  BacktestConfig,
  ClickHouseConfig,

  // 策略类型
  StrategyContext,
  StrategyAction,
  Strategy,

  // 结果类型
  TradeRecord,
  EquityPoint,
  BacktestStats,
  BacktestResult,
} from './types.js';

// 导出常量
export {
  DEFAULT_FEE_CONFIG,
  DEFAULT_SLIPPAGE_CONFIG,
  DEFAULT_BACKTEST_CONFIG,
} from './types.js';

// 导出工具函数
export {
  getPositionKey,
  parsePositionKey,
  generateId,
  timestampToString,
  stringToTimestamp,
} from './types.js';

// ============================================================================
// 事件总线导出
// ============================================================================

export {
  EventBus,
  EventPriorityQueue,
  createEventBus,
} from './event-bus.js';

// ============================================================================
// 订单簿导出
// ============================================================================

export type {
  SlippageResult,
  PriceLevelFill,
  OrderBookSnapshot,
} from './order-book.js';

export {
  OrderBook,
  OrderBookManager,
  createOrderBookManager,
} from './order-book.js';

// ============================================================================
// 撮合引擎导出
// ============================================================================

export type {
  MatchResult,
  ModifyOrderRequest,
  MatchingEngineConfig,
} from './matching-engine.js';

export {
  MatchingEngine,
  createMatchingEngine,
} from './matching-engine.js';

// ============================================================================
// 账户管理导出
// ============================================================================

export type {
  AccountConfig,
  OpenPositionResult,
  ClosePositionResult,
  LiquidationResult,
} from './account.js';

export {
  AccountManager,
  createAccountManager,
  DEFAULT_ACCOUNT_CONFIG,
} from './account.js';

// ============================================================================
// 资金费率导出
// ============================================================================

export type {
  FundingConfig,
  FundingRecord,
} from './funding.js';

export {
  FundingSimulator,
  createFundingSimulator,
  calculateFundingFee,
  getNextSettlementTime,
  DEFAULT_FUNDING_CONFIG,
} from './funding.js';

// ============================================================================
// 数据加载器导出
// ============================================================================

export type {
  DataLoaderConfig,
  LoadStats,
} from './data-loader.js';

export {
  DataLoader,
  createDataLoader,
  DEFAULT_DATA_LOADER_CONFIG,
} from './data-loader.js';

// ============================================================================
// 策略管理导出
// ============================================================================

export type {
  StrategyManagerConfig,
} from './strategy.js';

export {
  StrategyManager,
  createStrategyManager,
  BaseStrategy,
  ExampleGridStrategy,
} from './strategy.js';

// ============================================================================
// 回测引擎导出
// ============================================================================

export type {
  BacktesterOptions,
  BacktestProgress,
} from './backtester.js';

export {
  EventDrivenBacktester,
  createBacktester,
} from './backtester.js';

// ============================================================================
// 使用示例
// ============================================================================

/**
 * @example 基础使用 - 运行回测
 * ```typescript
 * import {
 *   createBacktester,
 *   BaseStrategy,
 *   type StrategyContext,
 *   type TradeEvent,
 *   type StrategyAction,
 * } from '@quant/backtester';
 *
 * // 定义策略
 * class MyStrategy extends BaseStrategy {
 *   readonly name = 'my-strategy';
 *   readonly version = '1.0.0';
 *
 *   onTrade(event: TradeEvent, context: StrategyContext): StrategyAction | void {
 *     // 简单的趋势跟踪策略
 *     const position = context.positions.get(`${event.exchange}:${event.symbol}`);
 *
 *     if (!position || position.side === 'none') {
 *       // 没有持仓，开仓
 *       return {
 *         orders: [{
 *           exchange: event.exchange,
 *           symbol: event.symbol,
 *           side: 'buy',
 *           type: 'market',
 *           quantity: 0.01,
 *         }],
 *       };
 *     }
 *   }
 * }
 *
 * // 创建回测器
 * const backtester = createBacktester({
 *   config: {
 *     exchanges: ['binance'],
 *     symbols: ['BTC/USDT:USDT'],
 *     startTime: '2024-01-01',
 *     endTime: '2024-01-31',
 *     initialBalance: 10000,
 *     defaultLeverage: 10,
 *     clickhouse: {
 *       host: 'localhost',
 *       port: 8123,
 *       database: 'quant',
 *     },
 *   },
 *   strategies: [new MyStrategy()],
 *   onProgress: (progress) => {
 *     console.log(`Progress: ${progress.percent.toFixed(1)}%`);
 *   },
 * });
 *
 * // 运行回测
 * const result = await backtester.run();
 *
 * // 输出结果
 * console.log(`Total return: ${(result.stats.totalReturn * 100).toFixed(2)}%`);
 * console.log(`Max drawdown: ${(result.stats.maxDrawdown * 100).toFixed(2)}%`);
 * console.log(`Sharpe ratio: ${result.stats.sharpeRatio.toFixed(2)}`);
 * ```
 *
 * @example 高级使用 - 策略热插拔
 * ```typescript
 * import { createBacktester, BaseStrategy } from '@quant/backtester';
 *
 * // 创建回测器（不传入策略）
 * const backtester = createBacktester({
 *   config: { ... },
 * });
 *
 * // 运行时注册策略
 * backtester.registerStrategy(new StrategyA());
 * backtester.registerStrategy(new StrategyB());
 *
 * // 运行回测
 * const result1 = await backtester.run();
 *
 * // 热替换策略
 * backtester.hotReplaceStrategy('strategy-a', new StrategyA_v2());
 *
 * // 再次运行
 * const result2 = await backtester.run();
 * ```
 *
 * @example 使用各种订单类型
 * ```typescript
 * import { BaseStrategy, type StrategyAction } from '@quant/backtester';
 *
 * class OrderTypesDemo extends BaseStrategy {
 *   readonly name = 'order-types-demo';
 *
 *   onDepth(event, context): StrategyAction {
 *     return {
 *       orders: [
 *         // 限价单
 *         {
 *           exchange: event.exchange,
 *           symbol: event.symbol,
 *           side: 'buy',
 *           type: 'limit',
 *           price: event.bids[0].price,
 *           quantity: 0.01,
 *         },
 *         // Post-Only 订单（只做 maker）
 *         {
 *           exchange: event.exchange,
 *           symbol: event.symbol,
 *           side: 'buy',
 *           type: 'limit',
 *           price: event.bids[0].price * 0.99,
 *           quantity: 0.01,
 *           postOnly: true,
 *         },
 *         // Reduce-Only 订单（只减仓）
 *         {
 *           exchange: event.exchange,
 *           symbol: event.symbol,
 *           side: 'sell',
 *           type: 'market',
 *           quantity: 0.005,
 *           reduceOnly: true,
 *         },
 *       ],
 *     };
 *   }
 * }
 * ```
 *
 * @example 自定义滑点模型
 * ```typescript
 * import { createBacktester } from '@quant/backtester';
 *
 * const backtester = createBacktester({
 *   config: {
 *     // ... 其他配置
 *     slippageConfig: {
 *       // 使用动态深度滑点
 *       type: 'dynamic',
 *       // 最大滑点限制 1%
 *       maxSlippage: 0.01,
 *       // 启用深度模拟
 *       useDepth: true,
 *     },
 *   },
 * });
 * ```
 *
 * @example 监控回测进度和权益
 * ```typescript
 * const backtester = createBacktester({
 *   config: { ... },
 *   onProgress: (progress) => {
 *     console.log(`
 *       Progress: ${progress.percent.toFixed(1)}%
 *       Events: ${progress.eventsProcessed}/${progress.totalEvents}
 *       Speed: ${progress.eventsPerSecond.toFixed(0)} events/s
 *       Equity: $${progress.equity.toFixed(2)}
 *       ETA: ${(progress.estimatedTimeRemaining / 1000).toFixed(0)}s
 *     `);
 *   },
 *   onEquityUpdate: (equity) => {
 *     // 实时权益更新
 *     updateChart(equity);
 *   },
 *   onTrade: (trade) => {
 *     // 交易记录
 *     logTrade(trade);
 *   },
 * });
 * ```
 */
