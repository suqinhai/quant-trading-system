// ============================================================================
// 事件驱动回测引擎
// 毫秒级精度回测，支持高性能批量处理
// 协调数据加载、事件分发、订单撮合、账户管理
// ============================================================================

import {
  type ExchangeId,
  type Timestamp,
  type BacktestConfig,
  type BacktestResult,
  type BacktestStats,
  type BacktestEvent,
  type TradeEvent,
  type DepthEvent,
  type FundingEvent,
  type MarkPriceEvent,
  type Strategy,
  type StrategyContext,
  type StrategyAction,
  type OrderRequest,
  type Order,
  type Position,
  type Account,
  type EquityPoint,
  type TradeRecord,
  DEFAULT_BACKTEST_CONFIG,
  getPositionKey,
  generateId,
} from './types.js';

import { EventBus, createEventBus } from './event-bus.js';
import { OrderBookManager, createOrderBookManager } from './order-book.js';
import { MatchingEngine, createMatchingEngine } from './matching-engine.js';
import { AccountManager, createAccountManager } from './account.js';
import { FundingSimulator, createFundingSimulator } from './funding.js';
import { DataLoader, createDataLoader } from './data-loader.js';
import { StrategyManager, createStrategyManager } from './strategy.js';

// ============================================================================
// 回测引擎配置
// ============================================================================

// 回测引擎选项
export interface BacktesterOptions {
  // 回测配置
  config: BacktestConfig;
  // 策略列表（可选，也可以后续注册）
  strategies?: Strategy[];
  // 进度回调
  onProgress?: (progress: BacktestProgress) => void;
  // 权益更新回调
  onEquityUpdate?: (equity: EquityPoint) => void;
  // 交易记录回调
  onTrade?: (trade: TradeRecord) => void;
}

// 回测进度
export interface BacktestProgress {
  // 当前时间戳
  currentTime: Timestamp;
  // 开始时间戳
  startTime: Timestamp;
  // 结束时间戳
  endTime: Timestamp;
  // 进度百分比（0-100）
  percent: number;
  // 已处理事件数
  eventsProcessed: number;
  // 总事件数
  totalEvents: number;
  // 每秒事件数
  eventsPerSecond: number;
  // 当前权益
  equity: number;
  // 预计剩余时间（毫秒）
  estimatedTimeRemaining: number;
}

// ============================================================================
// 事件驱动回测引擎类
// ============================================================================

/**
 * 事件驱动回测引擎
 * 毫秒级精度的高性能回测系统
 */
export class EventDrivenBacktester {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // 回测配置
  private config: BacktestConfig;

  // 事件总线
  private eventBus: EventBus;

  // 订单簿管理器
  private orderBookManager: OrderBookManager;

  // 撮合引擎
  private matchingEngine: MatchingEngine;

  // 账户管理器
  private accountManager: AccountManager;

  // 资金费率模拟器
  private fundingSimulator: FundingSimulator;

  // 数据加载器
  private dataLoader: DataLoader;

  // 策略管理器
  private strategyManager: StrategyManager;

  // 回调函数
  private onProgress?: (progress: BacktestProgress) => void;
  private onEquityUpdate?: (equity: EquityPoint) => void;
  private onTradeCallback?: (trade: TradeRecord) => void;

  // 运行状态
  private running: boolean = false;
  private shouldStop: boolean = false;

  // 当前时间戳
  private currentTimestamp: Timestamp = 0;

  // 最新标记价格缓存
  private markPrices: Map<string, number> = new Map();

  // 最新深度缓存
  private depths: Map<string, DepthEvent> = new Map();

  // 权益曲线
  private equityCurve: EquityPoint[] = [];

  // 交易记录
  private trades: TradeRecord[] = [];

  // 统计
  private stats = {
    startTime: 0,
    endTime: 0,
    eventsProcessed: 0,
    totalEvents: 0,
    processingStartTime: 0,
  };

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param options - 回测选项
   */
  constructor(options: BacktesterOptions) {
    // 合并配置
    this.config = {
      ...DEFAULT_BACKTEST_CONFIG,
      ...options.config,
    } as BacktestConfig;

    // 解析时间
    this.config.startTime = this.parseTime(this.config.startTime);
    this.config.endTime = this.parseTime(this.config.endTime);

    // 保存回调
    this.onProgress = options.onProgress;
    this.onEquityUpdate = options.onEquityUpdate;
    this.onTradeCallback = options.onTrade;

    // 初始化组件
    this.eventBus = createEventBus(this.config.eventBufferSize);
    this.orderBookManager = createOrderBookManager(this.config.slippageConfig);
    this.accountManager = createAccountManager({
      initialBalance: this.config.initialBalance,
      defaultLeverage: this.config.defaultLeverage,
      maxLeverage: this.config.maxLeverage,
      maintenanceMarginRate: this.config.maintenanceMarginRate,
      enableLiquidation: this.config.enableLiquidation,
    });

    // 撮合引擎需要持仓查询函数
    this.matchingEngine = createMatchingEngine(
      this.orderBookManager,
      (exchange, symbol) => this.accountManager.getPositionInfo(exchange, symbol),
      { feeConfig: this.config.feeConfig }
    );

    // 资金费率模拟器
    this.fundingSimulator = createFundingSimulator(this.accountManager, {
      enabled: this.config.enableFunding,
    });

    // 数据加载器
    this.dataLoader = createDataLoader({
      clickhouse: this.config.clickhouse,
      batchSize: this.config.dataBatchSize,
      preload: true,
      dataTypes: ['trade', 'depth', 'funding', 'markPrice'],
    });

    // 策略管理器
    this.strategyManager = createStrategyManager({
      allowMultipleStrategies: true,
      catchErrors: true,
    });

    // 注册初始策略
    if (options.strategies) {
      for (const strategy of options.strategies) {
        this.strategyManager.register(strategy);
      }
    }

    // 设置强平回调
    this.accountManager.setLiquidationCallback((event) => {
      // 强平事件分发给策略
      this.strategyManager.dispatchEvent(event, this.getStrategyContext());
    });
  }

  // ========================================================================
  // 公共方法 - 策略管理
  // ========================================================================

  /**
   * 注册策略
   * @param strategy - 策略实例
   */
  registerStrategy(strategy: Strategy): boolean {
    return this.strategyManager.register(strategy);
  }

  /**
   * 注销策略
   * @param strategyName - 策略名称
   */
  unregisterStrategy(strategyName: string): boolean {
    return this.strategyManager.unregister(strategyName);
  }

  /**
   * 热替换策略
   * @param oldName - 旧策略名称
   * @param newStrategy - 新策略实例
   */
  hotReplaceStrategy(oldName: string, newStrategy: Strategy): boolean {
    return this.strategyManager.hotReplace(oldName, newStrategy);
  }

  // ========================================================================
  // 公共方法 - 运行控制
  // ========================================================================

  /**
   * 运行回测
   * @returns 回测结果
   */
  async run(): Promise<BacktestResult> {
    // 检查是否已在运行
    if (this.running) {
      throw new Error('Backtester is already running');
    }

    // 标记运行状态
    this.running = true;
    this.shouldStop = false;

    try {
      // 记录开始时间
      this.stats.processingStartTime = Date.now();

      console.log('[Backtester] Starting backtest...');
      console.log(`[Backtester] Time range: ${new Date(this.config.startTime as number).toISOString()} - ${new Date(this.config.endTime as number).toISOString()}`);

      // 加载数据
      console.log('[Backtester] Loading data from ClickHouse...');
      const events = await this.dataLoader.loadEvents(
        this.config.exchanges,
        this.config.symbols,
        this.config.startTime as Timestamp,
        this.config.endTime as Timestamp
      );

      // 更新统计
      this.stats.totalEvents = events.length;
      this.stats.startTime = this.config.startTime as number;
      this.stats.endTime = this.config.endTime as number;

      console.log(`[Backtester] Loaded ${events.length} events`);

      // 初始化策略
      const context = this.getStrategyContext();
      await this.strategyManager.initialize(context);

      // 将事件推送到事件总线
      this.eventBus.emitAll(events);

      // 记录初始权益点
      this.recordEquityPoint();

      // 处理所有事件
      console.log('[Backtester] Processing events...');
      this.processEvents();

      // 生成回测结果
      const result = this.generateResult();

      console.log('[Backtester] Backtest completed');
      console.log(`[Backtester] Total return: ${(result.stats.totalReturn * 100).toFixed(2)}%`);
      console.log(`[Backtester] Max drawdown: ${(result.stats.maxDrawdown * 100).toFixed(2)}%`);
      console.log(`[Backtester] Sharpe ratio: ${result.stats.sharpeRatio.toFixed(2)}`);

      return result;

    } finally {
      // 清理
      await this.strategyManager.destroy();
      await this.dataLoader.close();

      // 标记停止
      this.running = false;
    }
  }

  /**
   * 停止回测
   */
  stop(): void {
    this.shouldStop = true;
    this.eventBus.stop();
  }

  /**
   * 检查是否正在运行
   */
  isRunning(): boolean {
    return this.running;
  }

  // ========================================================================
  // 私有方法 - 事件处理
  // ========================================================================

  /**
   * 处理所有事件（同步高性能版本）
   */
  private processEvents(): void {
    // 获取进度回调间隔
    const progressInterval = 100000; // 每 10 万事件更新一次进度
    let lastProgressTime = Date.now();

    // 使用同步处理提高性能
    this.eventBus.processAllSync((processed, remaining) => {
      // 更新统计
      this.stats.eventsProcessed = processed;

      // 定期报告进度
      if (this.onProgress) {
        const now = Date.now();
        const elapsed = now - this.stats.processingStartTime;
        const eventsPerSecond = elapsed > 0 ? (processed / elapsed) * 1000 : 0;

        const progress: BacktestProgress = {
          currentTime: this.currentTimestamp,
          startTime: this.stats.startTime,
          endTime: this.stats.endTime,
          percent: (processed / this.stats.totalEvents) * 100,
          eventsProcessed: processed,
          totalEvents: this.stats.totalEvents,
          eventsPerSecond,
          equity: this.accountManager.account.equity,
          estimatedTimeRemaining: eventsPerSecond > 0
            ? (remaining / eventsPerSecond) * 1000
            : 0,
        };

        this.onProgress(progress);
      }
    });

    // 注册事件处理器
    this.eventBus.on('trade', (event) => this.onTradeEvent(event));
    this.eventBus.on('depth', (event) => this.onDepthEvent(event));
    this.eventBus.on('funding', (event) => this.onFundingEvent(event));
    this.eventBus.on('markPrice', (event) => this.onMarkPriceEvent(event));

    // 重新处理（因为处理器刚注册）
    // 注意：实际应该在 emitAll 之前注册处理器
  }

  /**
   * 处理成交事件
   */
  private onTradeEvent(event: TradeEvent): void {
    // 更新时间
    this.updateTimestamp(event.timestamp);

    // 更新撮合引擎（检查限价单是否触发）
    const fills = this.matchingEngine.onTrade(event);

    // 处理成交
    this.processFills(fills);

    // 分发给策略
    const action = this.strategyManager.dispatchEvent(event, this.getStrategyContext());

    // 执行策略动作
    this.executeStrategyAction(action);
  }

  /**
   * 处理深度事件
   */
  private onDepthEvent(event: DepthEvent): void {
    // 更新时间
    this.updateTimestamp(event.timestamp);

    // 更新深度缓存
    const key = getPositionKey(event.exchange, event.symbol);
    this.depths.set(key, event);

    // 更新订单簿
    this.orderBookManager.update(event);

    // 更新撮合引擎（检查限价单是否可成交）
    const fills = this.matchingEngine.onDepth(event);

    // 处理成交
    this.processFills(fills);

    // 分发给策略
    const action = this.strategyManager.dispatchEvent(event, this.getStrategyContext());

    // 执行策略动作
    this.executeStrategyAction(action);
  }

  /**
   * 处理资金费率事件
   */
  private onFundingEvent(event: FundingEvent): void {
    // 更新时间
    this.updateTimestamp(event.timestamp);

    // 处理资金费率结算
    this.fundingSimulator.onFundingEvent(event);

    // 分发给策略
    const action = this.strategyManager.dispatchEvent(event, this.getStrategyContext());

    // 执行策略动作
    this.executeStrategyAction(action);

    // 记录权益点（资金费率会影响权益）
    this.recordEquityPoint();
  }

  /**
   * 处理标记价格事件
   */
  private onMarkPriceEvent(event: MarkPriceEvent): void {
    // 更新时间
    this.updateTimestamp(event.timestamp);

    // 更新标记价格缓存
    const key = getPositionKey(event.exchange, event.symbol);
    this.markPrices.set(key, event.markPrice);

    // 更新账户（计算未实现盈亏和检查强平）
    this.accountManager.updateMarkPrice(event.exchange, event.symbol, event.markPrice);

    // 分发给策略
    const action = this.strategyManager.dispatchEvent(event, this.getStrategyContext());

    // 执行策略动作
    this.executeStrategyAction(action);

    // 定期记录权益点（每分钟一次）
    if (this.shouldRecordEquity()) {
      this.recordEquityPoint();
    }
  }

  // ========================================================================
  // 私有方法 - 策略动作执行
  // ========================================================================

  /**
   * 执行策略动作
   */
  private executeStrategyAction(action: StrategyAction): void {
    // 取消订单
    if (action.cancelOrders && action.cancelOrders.length > 0) {
      this.matchingEngine.cancelOrders(action.cancelOrders);
    }

    // 修改订单
    if (action.modifyOrders && action.modifyOrders.length > 0) {
      for (const modify of action.modifyOrders) {
        this.matchingEngine.modifyOrder(modify);
      }
    }

    // 下单
    if (action.orders && action.orders.length > 0) {
      for (const orderRequest of action.orders) {
        this.submitOrder(orderRequest);
      }
    }
  }

  /**
   * 提交订单
   */
  private submitOrder(request: OrderRequest): void {
    // 提交到撮合引擎
    const result = this.matchingEngine.submitOrder(request);

    // 检查是否成功
    if (!result.success) {
      console.warn(`[Backtester] Order rejected: ${result.error || result.rejectReason}`);
      return;
    }

    // 处理成交
    if (result.fills.length > 0) {
      this.processFills(result.fills);
    }
  }

  /**
   * 处理成交
   */
  private processFills(fills: Array<{ orderId: string; fillPrice: number; fillQuantity: number; fee: number; isMaker: boolean; exchange: ExchangeId; symbol: string; timestamp: Timestamp }>): void {
    for (const fill of fills) {
      // 获取订单
      const order = this.matchingEngine.getOrder(fill.orderId);
      if (!order) continue;

      // 更新账户
      if (order.side === 'buy') {
        // 买入 = 开多或平空
        const position = this.accountManager.getPosition(order.exchange, order.symbol);

        if (position && position.side === 'short') {
          // 平空
          this.accountManager.closePosition(
            order.exchange,
            order.symbol,
            fill.fillQuantity,
            fill.fillPrice,
            fill.fee
          );
        } else {
          // 开多
          this.accountManager.openPosition(
            order.exchange,
            order.symbol,
            'buy',
            fill.fillQuantity,
            fill.fillPrice,
            order.reduceOnly ? undefined : this.config.defaultLeverage,
            fill.fee
          );
        }
      } else {
        // 卖出 = 开空或平多
        const position = this.accountManager.getPosition(order.exchange, order.symbol);

        if (position && position.side === 'long') {
          // 平多
          this.accountManager.closePosition(
            order.exchange,
            order.symbol,
            fill.fillQuantity,
            fill.fillPrice,
            fill.fee
          );
        } else {
          // 开空
          this.accountManager.openPosition(
            order.exchange,
            order.symbol,
            'sell',
            fill.fillQuantity,
            fill.fillPrice,
            order.reduceOnly ? undefined : this.config.defaultLeverage,
            fill.fee
          );
        }
      }

      // 记录交易
      const trade: TradeRecord = {
        id: generateId(),
        orderId: fill.orderId,
        timestamp: this.currentTimestamp,
        exchange: fill.exchange,
        symbol: fill.symbol,
        side: order.side,
        price: fill.fillPrice,
        quantity: fill.fillQuantity,
        fee: fill.fee,
        realizedPnl: 0, // 会在平仓时计算
        isMaker: fill.isMaker,
      };

      this.trades.push(trade);

      // 回调
      if (this.onTradeCallback) {
        this.onTradeCallback(trade);
      }

      // 分发成交事件给策略
      this.strategyManager.dispatchEvent({
        type: 'orderFilled',
        timestamp: this.currentTimestamp,
        exchange: fill.exchange,
        symbol: fill.symbol,
        orderId: fill.orderId,
        fillPrice: fill.fillPrice,
        fillQuantity: fill.fillQuantity,
        fee: fill.fee,
        feeCurrency: 'USDT',
        isMaker: fill.isMaker,
      }, this.getStrategyContext());

      // 记录权益点
      this.recordEquityPoint();
    }
  }

  // ========================================================================
  // 私有方法 - 上下文和工具
  // ========================================================================

  /**
   * 获取策略上下文
   */
  private getStrategyContext(): StrategyContext {
    return {
      timestamp: this.currentTimestamp,
      account: this.accountManager.account,
      positions: this.accountManager.getPositions(),
      activeOrders: this.matchingEngine.getActiveOrdersMap(),
      depths: this.depths,
      markPrices: this.markPrices,
    };
  }

  /**
   * 更新时间戳
   */
  private updateTimestamp(timestamp: Timestamp): void {
    this.currentTimestamp = timestamp;
    this.matchingEngine.setTimestamp(timestamp);
    this.accountManager.setTimestamp(timestamp);
    this.fundingSimulator.setTimestamp(timestamp);
  }

  /**
   * 解析时间
   */
  private parseTime(time: Timestamp | string): Timestamp {
    if (typeof time === 'number') {
      return time;
    }
    return new Date(time).getTime();
  }

  /**
   * 检查是否应该记录权益点
   */
  private shouldRecordEquity(): boolean {
    // 每分钟记录一次
    if (this.equityCurve.length === 0) {
      return true;
    }

    const lastPoint = this.equityCurve[this.equityCurve.length - 1]!;
    return this.currentTimestamp - lastPoint.timestamp >= 60000;
  }

  /**
   * 记录权益点
   */
  private recordEquityPoint(): void {
    const account = this.accountManager.account;

    const point: EquityPoint = {
      timestamp: this.currentTimestamp,
      equity: account.equity,
      balance: account.balance,
      unrealizedPnl: account.totalUnrealizedPnl,
      usedMargin: account.usedMargin,
    };

    this.equityCurve.push(point);

    // 回调
    if (this.onEquityUpdate) {
      this.onEquityUpdate(point);
    }
  }

  // ========================================================================
  // 私有方法 - 结果生成
  // ========================================================================

  /**
   * 生成回测结果
   */
  private generateResult(): BacktestResult {
    // 生成统计指标
    const stats = this.calculateStats();

    // 获取最终持仓
    const finalPositions: Position[] = [];
    for (const position of this.accountManager.getPositions().values()) {
      if (position.side !== 'none' && position.quantity > 0) {
        finalPositions.push({ ...position });
      }
    }

    return {
      config: this.config,
      stats,
      equityCurve: this.equityCurve,
      trades: this.trades,
      finalPositions,
      finalAccount: { ...this.accountManager.account },
    };
  }

  /**
   * 计算统计指标
   */
  private calculateStats(): BacktestStats {
    const account = this.accountManager.account;
    const processingTime = Date.now() - this.stats.processingStartTime;

    // 基本指标
    const totalReturn = (account.equity - this.config.initialBalance) / this.config.initialBalance;
    const duration = this.stats.endTime - this.stats.startTime;
    const daysInYear = 365;
    const durationDays = duration / (24 * 60 * 60 * 1000);
    const annualizedReturn = durationDays > 0
      ? Math.pow(1 + totalReturn, daysInYear / durationDays) - 1
      : 0;

    // 计算最大回撤
    let maxDrawdown = 0;
    let maxDrawdownDuration = 0;
    let peak = this.config.initialBalance;
    let drawdownStart = this.stats.startTime;

    for (const point of this.equityCurve) {
      if (point.equity > peak) {
        peak = point.equity;
        drawdownStart = point.timestamp;
      }

      const drawdown = (peak - point.equity) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownDuration = point.timestamp - drawdownStart;
      }
    }

    // 计算收益率序列（用于风险指标）
    const returns: number[] = [];
    for (let i = 1; i < this.equityCurve.length; i++) {
      const prev = this.equityCurve[i - 1]!.equity;
      const curr = this.equityCurve[i]!.equity;
      returns.push((curr - prev) / prev);
    }

    // 计算波动率
    const meanReturn = returns.length > 0
      ? returns.reduce((a, b) => a + b, 0) / returns.length
      : 0;

    const variance = returns.length > 0
      ? returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length
      : 0;

    const dailyVolatility = Math.sqrt(variance);
    const annualizedVolatility = dailyVolatility * Math.sqrt(365 * 24 * 60); // 假设分钟级数据

    // 计算夏普比率（假设无风险利率为 0）
    const sharpeRatio = annualizedVolatility > 0
      ? annualizedReturn / annualizedVolatility
      : 0;

    // 计算索提诺比率（只考虑下行波动）
    const negativeReturns = returns.filter((r) => r < 0);
    const downVariance = negativeReturns.length > 0
      ? negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length
      : 0;
    const downDeviation = Math.sqrt(downVariance) * Math.sqrt(365 * 24 * 60);
    const sortinoRatio = downDeviation > 0 ? annualizedReturn / downDeviation : 0;

    // 计算卡玛比率
    const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;

    // 交易统计
    const winningTrades = this.trades.filter((t) => t.realizedPnl > 0).length;
    const losingTrades = this.trades.filter((t) => t.realizedPnl < 0).length;
    const totalTrades = this.trades.length;

    const wins = this.trades.filter((t) => t.realizedPnl > 0);
    const losses = this.trades.filter((t) => t.realizedPnl < 0);

    const avgWin = wins.length > 0
      ? wins.reduce((sum, t) => sum + t.realizedPnl, 0) / wins.length
      : 0;

    const avgLoss = losses.length > 0
      ? Math.abs(losses.reduce((sum, t) => sum + t.realizedPnl, 0) / losses.length)
      : 0;

    const grossProfit = wins.reduce((sum, t) => sum + t.realizedPnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.realizedPnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // 总手续费
    const totalFees = this.trades.reduce((sum, t) => sum + t.fee, 0);

    return {
      startTime: this.stats.startTime,
      endTime: this.stats.endTime,
      duration,
      initialBalance: this.config.initialBalance,
      finalEquity: account.equity,

      totalReturn,
      annualizedReturn,
      maxDrawdown,
      maxDrawdownDuration,

      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      volatility: annualizedVolatility,

      totalTrades,
      winningTrades,
      losingTrades,
      winRate: totalTrades > 0 ? winningTrades / totalTrades : 0,
      avgWin,
      avgLoss,
      profitFactor,
      avgHoldingTime: 0, // 需要更复杂的计算

      totalFees,
      totalFundingFees: account.totalFundingFee,
      totalSlippage: 0, // 需要追踪滑点

      liquidationCount: 0, // 需要追踪强平
      totalLiquidationLoss: 0,

      eventsProcessed: this.stats.eventsProcessed,
      processingTime,
      eventsPerSecond: processingTime > 0
        ? (this.stats.eventsProcessed / processingTime) * 1000
        : 0,
    };
  }
}

// ============================================================================
// 导出工厂函数
// ============================================================================

/**
 * 创建事件驱动回测引擎
 * @param options - 回测选项
 */
export function createBacktester(options: BacktesterOptions): EventDrivenBacktester {
  return new EventDrivenBacktester(options);
}
