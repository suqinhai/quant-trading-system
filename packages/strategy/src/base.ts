// ============================================================================
// 策略基类
// 提供策略开发的基础框架和通用功能
// ============================================================================

import Decimal from 'decimal.js';
import pino from 'pino';

import type { OrderRequest, Symbol } from '@quant/exchange';
import type { Kline } from '@quant/marketdata';
import type {
  BacktestContext,
  IBacktestStrategy,
  MarketDataEvent,
  OrderEvent,
  PositionEvent,
  SignalDirection,
} from '@quant/backtest';

import { Indicators } from './indicators.js';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 策略参数接口
 * 所有策略参数都应该继承此接口
 */
export interface StrategyParams {
  // 交易对列表
  readonly symbols: Symbol[];

  // 仓位大小（占总资金比例，0-1）
  readonly positionSize?: number;

  // 止损百分比
  readonly stopLossPercent?: number;

  // 止盈百分比
  readonly takeProfitPercent?: number;

  // 是否允许做空
  readonly allowShort?: boolean;

  // 自定义参数
  [key: string]: unknown;
}

/**
 * 策略状态
 */
export interface StrategyState {
  // 是否已初始化
  initialized: boolean;

  // 当前持仓交易对
  activePositions: Set<Symbol>;

  // 策略特定状态
  [key: string]: unknown;
}

// ============================================================================
// 策略基类
// ============================================================================

/**
 * 策略抽象基类
 *
 * 提供：
 * - 参数管理
 * - 日志记录
 * - 技术指标访问
 * - 仓位管理辅助方法
 * - 信号生成辅助方法
 */
export abstract class BaseStrategy implements IBacktestStrategy {
  // 策略名称（子类必须实现）
  public abstract readonly name: string;

  // 策略描述
  public readonly description?: string;

  // 策略参数
  protected readonly params: StrategyParams;

  // 策略状态
  protected state: StrategyState;

  // 日志记录器
  protected readonly logger: pino.Logger;

  // 技术指标库引用
  protected readonly indicators = Indicators;

  // 上下文引用（在 initialize 中设置）
  protected context: BacktestContext | null = null;

  /**
   * 构造函数
   * @param params - 策略参数
   */
  protected constructor(params: StrategyParams) {
    this.params = {
      positionSize: 0.1, // 默认 10% 仓位
      stopLossPercent: 2, // 默认 2% 止损
      takeProfitPercent: 4, // 默认 4% 止盈
      allowShort: false, // 默认不允许做空
      ...params,
    };

    // 初始化状态
    this.state = {
      initialized: false,
      activePositions: new Set(),
    };

    // 初始化日志
    this.logger = pino({
      name: `Strategy:${this.name}`,
      level: process.env['LOG_LEVEL'] ?? 'info',
    });
  }

  // ==========================================================================
  // 生命周期方法
  // ==========================================================================

  /**
   * 初始化策略
   * 子类可以重写此方法进行自定义初始化
   */
  public async initialize(context: BacktestContext): Promise<void> {
    this.context = context;
    this.state.initialized = true;

    this.logger.info({ params: this.params }, 'Strategy initialized');

    // 调用子类的初始化钩子
    await this.onInitialize(context);
  }

  /**
   * 处理市场数据
   * 这是策略的核心方法
   */
  public async onMarketData(event: MarketDataEvent, context: BacktestContext): Promise<void> {
    // 检查是否已初始化
    if (!this.state.initialized) {
      this.logger.warn('Strategy not initialized');
      return;
    }

    // 检查交易对是否在监控列表中
    if (!this.params.symbols.includes(event.symbol)) {
      return;
    }

    // 更新上下文
    this.context = context;

    // 调用子类的处理方法
    await this.processBar(event.symbol, event.kline, context);
  }

  /**
   * 处理订单成交
   */
  public async onOrderFilled(event: OrderEvent, context: BacktestContext): Promise<void> {
    this.logger.debug(
      { orderId: event.order.id, symbol: event.order.symbol },
      'Order filled'
    );
  }

  /**
   * 处理仓位更新
   */
  public async onPositionUpdate(event: PositionEvent, context: BacktestContext): Promise<void> {
    // 更新活跃仓位集合
    if (event.type === 'POSITION_OPENED') {
      this.state.activePositions.add(event.position.symbol);
    } else if (event.type === 'POSITION_CLOSED') {
      this.state.activePositions.delete(event.position.symbol);
    }
  }

  /**
   * 清理策略
   */
  public async cleanup(context: BacktestContext): Promise<void> {
    this.logger.info('Strategy cleanup');
    await this.onCleanup(context);
  }

  // ==========================================================================
  // 子类钩子方法
  // ==========================================================================

  /**
   * 初始化钩子
   * 子类可以重写此方法进行自定义初始化
   */
  protected async onInitialize(_context: BacktestContext): Promise<void> {
    // 默认空实现
  }

  /**
   * 处理单根 K 线
   * 子类必须实现此方法
   */
  protected abstract processBar(
    symbol: Symbol,
    kline: Kline,
    context: BacktestContext
  ): Promise<void>;

  /**
   * 清理钩子
   */
  protected async onCleanup(_context: BacktestContext): Promise<void> {
    // 默认空实现
  }

  // ==========================================================================
  // 辅助方法
  // ==========================================================================

  /**
   * 发出做多信号
   */
  protected long(
    symbol: Symbol,
    options: {
      price?: Decimal;
      quantity?: Decimal;
      stopLoss?: Decimal;
      takeProfit?: Decimal;
      strength?: number;
    } = {}
  ): void {
    if (!this.context) {
      return;
    }

    this.context.emitSignal({
      symbol,
      direction: 'long' as SignalDirection,
      source: this.name,
      ...options,
    });

    this.logger.info({ symbol, ...options }, 'Long signal emitted');
  }

  /**
   * 发出做空信号
   */
  protected short(
    symbol: Symbol,
    options: {
      price?: Decimal;
      quantity?: Decimal;
      stopLoss?: Decimal;
      takeProfit?: Decimal;
      strength?: number;
    } = {}
  ): void {
    if (!this.context || !this.params.allowShort) {
      return;
    }

    this.context.emitSignal({
      symbol,
      direction: 'short' as SignalDirection,
      source: this.name,
      ...options,
    });

    this.logger.info({ symbol, ...options }, 'Short signal emitted');
  }

  /**
   * 平多仓
   */
  protected exitLong(symbol: Symbol): void {
    if (!this.context) {
      return;
    }

    this.context.emitSignal({
      symbol,
      direction: 'exit_long' as SignalDirection,
      source: this.name,
    });

    this.logger.info({ symbol }, 'Exit long signal emitted');
  }

  /**
   * 平空仓
   */
  protected exitShort(symbol: Symbol): void {
    if (!this.context) {
      return;
    }

    this.context.emitSignal({
      symbol,
      direction: 'exit_short' as SignalDirection,
      source: this.name,
    });

    this.logger.info({ symbol }, 'Exit short signal emitted');
  }

  /**
   * 平所有仓位
   */
  protected exitAll(symbol: Symbol): void {
    if (!this.context) {
      return;
    }

    this.context.emitSignal({
      symbol,
      direction: 'exit_all' as SignalDirection,
      source: this.name,
    });

    this.logger.info({ symbol }, 'Exit all signal emitted');
  }

  /**
   * 检查是否有持仓
   */
  protected hasPosition(symbol: Symbol): boolean {
    return this.context?.positions.has(symbol) ?? false;
  }

  /**
   * 获取当前持仓
   */
  protected getPosition(symbol: Symbol) {
    return this.context?.positions.get(symbol);
  }

  /**
   * 获取历史 K 线
   */
  protected getKlines(symbol: Symbol, count: number): Kline[] {
    return this.context?.getKlines(symbol, count) ?? [];
  }

  /**
   * 获取收盘价序列
   */
  protected getCloses(symbol: Symbol, count: number): Decimal[] {
    const klines = this.getKlines(symbol, count);
    return klines.map(k => k.close);
  }

  /**
   * 获取最高价序列
   */
  protected getHighs(symbol: Symbol, count: number): Decimal[] {
    const klines = this.getKlines(symbol, count);
    return klines.map(k => k.high);
  }

  /**
   * 获取最低价序列
   */
  protected getLows(symbol: Symbol, count: number): Decimal[] {
    const klines = this.getKlines(symbol, count);
    return klines.map(k => k.low);
  }

  /**
   * 获取成交量序列
   */
  protected getVolumes(symbol: Symbol, count: number): Decimal[] {
    const klines = this.getKlines(symbol, count);
    return klines.map(k => k.volume);
  }

  /**
   * 计算建议仓位大小
   */
  protected calculatePositionSize(symbol: Symbol): Decimal {
    if (!this.context) {
      return new Decimal(0);
    }

    const equity = this.context.equity;
    const positionRatio = new Decimal(this.params.positionSize ?? 0.1);
    const price = this.context.getCurrentPrice(symbol);

    if (!price || price.isZero()) {
      return new Decimal(0);
    }

    // 仓位价值 = 权益 * 仓位比例
    const positionValue = equity.times(positionRatio);

    // 数量 = 仓位价值 / 价格
    return positionValue.dividedBy(price);
  }

  /**
   * 计算止损价格
   */
  protected calculateStopLoss(entryPrice: Decimal, side: 'long' | 'short'): Decimal {
    const stopLossPercent = new Decimal(this.params.stopLossPercent ?? 2).dividedBy(100);

    if (side === 'long') {
      return entryPrice.times(new Decimal(1).minus(stopLossPercent));
    } else {
      return entryPrice.times(new Decimal(1).plus(stopLossPercent));
    }
  }

  /**
   * 计算止盈价格
   */
  protected calculateTakeProfit(entryPrice: Decimal, side: 'long' | 'short'): Decimal {
    const takeProfitPercent = new Decimal(this.params.takeProfitPercent ?? 4).dividedBy(100);

    if (side === 'long') {
      return entryPrice.times(new Decimal(1).plus(takeProfitPercent));
    } else {
      return entryPrice.times(new Decimal(1).minus(takeProfitPercent));
    }
  }

  /**
   * 记录日志
   */
  protected log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    data?: Record<string, unknown>
  ): void {
    this.logger[level](data, message);
    this.context?.log(level, message, data);
  }
}
