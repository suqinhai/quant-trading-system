// ============================================================================
// 回测引擎核心
// 事件驱动的回测引擎主类
// ============================================================================

import Decimal from 'decimal.js';
import EventEmitter from 'eventemitter3';
import pino from 'pino';

import type { OrderRequest, Symbol } from '@quant/exchange';
import type { Kline } from '@quant/marketdata';

import { SimulatedBroker } from './broker';
import { EventQueue } from './event-queue';
import { StatsCalculator } from './stats';
import {
  EventType,
  type BacktestConfig,
  type BacktestContext,
  type BacktestEvent,
  type BacktestPosition,
  type BacktestResult,
  type ClosedTrade,
  type EquityPoint,
  type IBacktestStrategy,
  type MarketDataEvent,
  type OrderEvent,
  type PositionEvent,
  type SignalEvent,
} from './types';

// ============================================================================
// 引擎事件类型
// ============================================================================

/**
 * 引擎事件
 */
export interface BacktestEngineEvents {
  // 回测开始
  start: () => void;

  // 回测结束
  end: (result: BacktestResult) => void;

  // 进度更新
  progress: (percent: number, currentTime: number) => void;

  // K 线处理
  kline: (kline: Kline) => void;

  // 订单事件
  order: (event: OrderEvent) => void;

  // 交易完成
  trade: (trade: ClosedTrade) => void;

  // 错误
  error: (error: Error) => void;
}

// ============================================================================
// 回测引擎实现
// ============================================================================

/**
 * 回测引擎
 *
 * 核心功能：
 * - 事件驱动架构
 * - 支持多策略
 * - 精确的时间模拟
 * - 完整的统计分析
 */
export class BacktestEngine extends EventEmitter<BacktestEngineEvents> {
  // 日志记录器
  private readonly logger: pino.Logger;

  // 配置
  private readonly config: BacktestConfig;

  // 事件队列
  private readonly eventQueue: EventQueue;

  // 模拟经纪商
  private readonly broker: SimulatedBroker;

  // 策略列表
  private readonly strategies: IBacktestStrategy[] = [];

  // 历史 K 线数据
  private readonly historicalData: Map<Symbol, Kline[]> = new Map();

  // 权益曲线
  private equityCurve: EquityPoint[] = [];

  // 当前时间
  private currentTime: number = 0;

  // 运行状态
  private isRunning: boolean = false;

  // 进度回调间隔（毫秒）
  private progressInterval: number = 86400000; // 每天回调一次

  /**
   * 构造函数
   * @param config - 回测配置
   */
  public constructor(config: BacktestConfig) {
    super();

    this.config = config;
    this.eventQueue = new EventQueue();
    this.broker = new SimulatedBroker(config);

    // 初始化日志
    this.logger = pino({
      name: 'BacktestEngine',
      level: process.env['LOG_LEVEL'] ?? 'info',
    });

    this.logger.info({ config }, 'BacktestEngine initialized');
  }

  // ==========================================================================
  // 数据加载
  // ==========================================================================

  /**
   * 加载历史 K 线数据
   * @param symbol - 交易对
   * @param klines - K 线数据数组
   */
  public loadData(symbol: Symbol, klines: Kline[]): void {
    // 按时间排序
    const sorted = [...klines].sort((a, b) => a.openTime - b.openTime);

    // 过滤时间范围
    const filtered = sorted.filter(
      k => k.openTime >= this.config.startTime && k.openTime <= this.config.endTime
    );

    this.historicalData.set(symbol, filtered);

    this.logger.info(
      { symbol, count: filtered.length },
      'Historical data loaded'
    );
  }

  /**
   * 批量加载数据
   */
  public loadDataBatch(data: Map<Symbol, Kline[]>): void {
    for (const [symbol, klines] of data) {
      this.loadData(symbol, klines);
    }
  }

  // ==========================================================================
  // 策略管理
  // ==========================================================================

  /**
   * 添加策略
   */
  public addStrategy(strategy: IBacktestStrategy): void {
    this.strategies.push(strategy);
    this.logger.info({ strategyName: strategy.name }, 'Strategy added');
  }

  /**
   * 移除策略
   */
  public removeStrategy(strategyName: string): boolean {
    const index = this.strategies.findIndex(s => s.name === strategyName);
    if (index !== -1) {
      this.strategies.splice(index, 1);
      return true;
    }
    return false;
  }

  // ==========================================================================
  // 回测执行
  // ==========================================================================

  /**
   * 运行回测
   */
  public async run(): Promise<BacktestResult> {
    const startExecutionTime = Date.now();

    try {
      this.isRunning = true;
      this.emit('start');

      this.logger.info('Starting backtest...');

      // 初始化
      await this.initialize();

      // 生成市场数据事件
      this.generateMarketDataEvents();

      // 事件循环
      await this.eventLoop();

      // 计算结果
      const result = this.calculateResult(startExecutionTime);

      this.emit('end', result);
      this.logger.info({ stats: result.stats }, 'Backtest completed');

      return result;
    } catch (error) {
      this.logger.error({ error }, 'Backtest failed');
      this.emit('error', error as Error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 初始化
   */
  private async initialize(): Promise<void> {
    // 重置状态
    this.eventQueue.clear();
    this.equityCurve = [];
    this.currentTime = this.config.startTime;
    this.broker.reset();

    // 创建上下文
    const context = this.createContext();

    // 初始化所有策略
    for (const strategy of this.strategies) {
      await strategy.initialize(context);
    }

    // 记录初始权益点
    this.recordEquityPoint();
  }

  /**
   * 生成市场数据事件
   */
  private generateMarketDataEvents(): void {
    // 遍历所有交易对的数据
    for (const [symbol, klines] of this.historicalData) {
      for (const kline of klines) {
        const event: MarketDataEvent = {
          type: EventType.MARKET_DATA,
          timestamp: kline.openTime,
          symbol,
          kline,
        };

        this.eventQueue.push(event);
      }
    }

    this.logger.info({ eventCount: this.eventQueue.size() }, 'Market data events generated');
  }

  /**
   * 事件循环
   */
  private async eventLoop(): Promise<void> {
    let lastProgressTime = this.config.startTime;
    const totalTime = this.config.endTime - this.config.startTime;

    while (!this.eventQueue.isEmpty()) {
      const event = this.eventQueue.pop()!;

      // 更新当前时间
      this.currentTime = event.timestamp;
      this.broker.setCurrentTime(this.currentTime);

      // 处理事件
      await this.processEvent(event);

      // 检查限价单
      const orderEvents = this.broker.checkPendingOrders();
      for (const orderEvent of orderEvents) {
        this.eventQueue.push(orderEvent);
      }

      // 进度回调
      if (this.currentTime - lastProgressTime >= this.progressInterval) {
        const progress = ((this.currentTime - this.config.startTime) / totalTime) * 100;
        this.emit('progress', progress, this.currentTime);
        lastProgressTime = this.currentTime;

        // 记录权益点
        this.recordEquityPoint();
      }
    }

    // 清理策略
    const context = this.createContext();
    for (const strategy of this.strategies) {
      if (strategy.cleanup) {
        await strategy.cleanup(context);
      }
    }
  }

  /**
   * 处理单个事件
   */
  private async processEvent(event: BacktestEvent): Promise<void> {
    const context = this.createContext();

    switch (event.type) {
      case EventType.MARKET_DATA:
        await this.handleMarketData(event as MarketDataEvent, context);
        break;

      case EventType.SIGNAL:
        await this.handleSignal(event as SignalEvent, context);
        break;

      case EventType.ORDER_FILLED:
        await this.handleOrderFilled(event as OrderEvent, context);
        break;

      case EventType.POSITION_OPENED:
      case EventType.POSITION_CLOSED:
      case EventType.POSITION_UPDATED:
        await this.handlePositionUpdate(event as PositionEvent, context);
        break;

      default:
        // 其他事件类型
        break;
    }
  }

  /**
   * 处理市场数据事件
   */
  private async handleMarketData(event: MarketDataEvent, context: BacktestContext): Promise<void> {
    // 更新价格
    this.broker.updatePrice(event.symbol, event.kline.close);

    // 通知策略
    for (const strategy of this.strategies) {
      await strategy.onMarketData(event, context);
    }

    // 发出事件
    this.emit('kline', event.kline);
  }

  /**
   * 处理信号事件
   */
  private async handleSignal(event: SignalEvent, context: BacktestContext): Promise<void> {
    // 将信号转换为订单请求
    const orderRequest = this.signalToOrder(event);
    if (orderRequest) {
      const orderEvents = this.broker.submitOrder(orderRequest);

      // 将订单事件加入队列
      for (const orderEvent of orderEvents) {
        this.eventQueue.push(orderEvent);
      }
    }
  }

  /**
   * 处理订单成交事件
   */
  private async handleOrderFilled(event: OrderEvent, context: BacktestContext): Promise<void> {
    // 通知策略
    for (const strategy of this.strategies) {
      if (strategy.onOrderFilled) {
        await strategy.onOrderFilled(event, context);
      }
    }

    // 发出事件
    this.emit('order', event);
  }

  /**
   * 处理仓位更新事件
   */
  private async handlePositionUpdate(
    event: PositionEvent,
    context: BacktestContext
  ): Promise<void> {
    // 通知策略
    for (const strategy of this.strategies) {
      if (strategy.onPositionUpdate) {
        await strategy.onPositionUpdate(event, context);
      }
    }

    // 如果是平仓事件，记录交易
    if (event.type === EventType.POSITION_CLOSED) {
      const trades = this.broker.closedTrades;
      const lastTrade = trades[trades.length - 1];
      if (lastTrade) {
        this.emit('trade', lastTrade);
      }
    }
  }

  /**
   * 将信号转换为订单
   */
  private signalToOrder(signal: SignalEvent): OrderRequest | null {
    const currentPrice = signal.price;
    if (!currentPrice) {
      return null;
    }

    // 确定订单方向
    let side: 'buy' | 'sell';
    switch (signal.direction) {
      case 'long':
        side = 'buy';
        break;
      case 'short':
        side = 'sell';
        break;
      case 'exit_long':
      case 'exit_short':
      case 'exit_all':
        // 检查当前仓位
        const position = this.broker.positions.get(signal.symbol);
        if (!position) {
          return null;
        }
        side = position.side === 'long' ? 'sell' : 'buy';
        break;
      default:
        return null;
    }

    // 计算数量
    let quantity = signal.quantity;
    if (!quantity) {
      // 默认使用最大仓位的一半
      const availableCash = this.broker.cash;
      const maxPosition = availableCash.times(this.config.maxPositionSize);
      quantity = maxPosition.dividedBy(currentPrice).dividedBy(2);
    }

    return {
      symbol: signal.symbol,
      side,
      type: 'market',
      amount: quantity,
      price: currentPrice,
    };
  }

  /**
   * 记录权益点
   */
  private recordEquityPoint(): void {
    const equity = this.broker.equity;
    const cash = this.broker.cash;
    const positionValue = equity.minus(cash);

    // 计算累计收益
    const cumulativeReturn = equity
      .minus(this.config.initialCapital)
      .dividedBy(this.config.initialCapital)
      .times(100);

    // 计算回撤
    let drawdown = new Decimal(0);
    if (this.equityCurve.length > 0) {
      const peakEquity = this.equityCurve.reduce(
        (max, point) => (point.equity.greaterThan(max) ? point.equity : max),
        this.equityCurve[0]!.equity
      );

      if (equity.lessThan(peakEquity)) {
        drawdown = peakEquity.minus(equity).dividedBy(peakEquity).times(100);
      }
    }

    // 计算日收益
    let dailyReturn: Decimal | undefined;
    if (this.equityCurve.length > 0) {
      const prevEquity = this.equityCurve[this.equityCurve.length - 1]!.equity;
      if (!prevEquity.isZero()) {
        dailyReturn = equity.minus(prevEquity).dividedBy(prevEquity).times(100);
      }
    }

    this.equityCurve.push({
      timestamp: this.currentTime,
      equity,
      cash,
      positionValue,
      dailyReturn,
      cumulativeReturn,
      drawdown,
    });
  }

  /**
   * 创建回测上下文
   */
  private createContext(): BacktestContext {
    const self = this;

    return {
      get currentTime() {
        return self.currentTime;
      },

      get cash() {
        return self.broker.cash;
      },

      get equity() {
        return self.broker.equity;
      },

      get positions() {
        return self.broker.positions;
      },

      get trades() {
        return self.broker.closedTrades;
      },

      getKlines(symbol: Symbol, count: number): Kline[] {
        const allKlines = self.historicalData.get(symbol) ?? [];

        // 找到当前时间之前的 K 线
        const pastKlines = allKlines.filter(k => k.openTime < self.currentTime);

        // 返回最后 N 根
        return pastKlines.slice(-count);
      },

      getCurrentPrice(symbol: Symbol): Decimal | undefined {
        const klines = self.historicalData.get(symbol);
        if (!klines) {
          return undefined;
        }

        // 找到当前或最近的 K 线
        for (let i = klines.length - 1; i >= 0; i--) {
          if (klines[i]!.openTime <= self.currentTime) {
            return klines[i]!.close;
          }
        }

        return undefined;
      },

      submitOrder(request: OrderRequest): void {
        const events = self.broker.submitOrder(request);
        for (const event of events) {
          self.eventQueue.push(event);
        }
      },

      cancelOrder(orderId: string): void {
        const event = self.broker.cancelOrder(orderId);
        if (event) {
          self.eventQueue.push(event);
        }
      },

      emitSignal(signal: Omit<SignalEvent, 'type' | 'timestamp'>): void {
        const fullSignal: SignalEvent = {
          ...signal,
          type: EventType.SIGNAL,
          timestamp: self.currentTime,
        };
        self.eventQueue.push(fullSignal);
      },

      log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void {
        self.logger[level]({ ...data, time: self.currentTime }, message);
      },
    };
  }

  /**
   * 计算回测结果
   */
  private calculateResult(startExecutionTime: number): BacktestResult {
    // 记录最终权益点
    this.recordEquityPoint();

    // 计算统计指标
    const stats = StatsCalculator.calculate(
      this.config,
      this.equityCurve,
      this.broker.closedTrades
    );

    return {
      config: this.config,
      stats,
      equityCurve: this.equityCurve,
      trades: this.broker.closedTrades,
      executionTime: Date.now() - startExecutionTime,
    };
  }

  // ==========================================================================
  // 辅助方法
  // ==========================================================================

  /**
   * 设置进度回调间隔
   * @param interval - 间隔（毫秒）
   */
  public setProgressInterval(interval: number): void {
    this.progressInterval = interval;
  }

  /**
   * 获取当前状态
   */
  public getStatus(): {
    isRunning: boolean;
    currentTime: number;
    equity: Decimal;
    positions: Map<Symbol, BacktestPosition>;
    trades: number;
  } {
    return {
      isRunning: this.isRunning,
      currentTime: this.currentTime,
      equity: this.broker.equity,
      positions: this.broker.positions,
      trades: this.broker.closedTrades.length,
    };
  }
}
