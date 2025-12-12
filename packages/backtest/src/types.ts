// ============================================================================
// 回测引擎类型定义
// 定义事件驱动回测系统的核心类型
// ============================================================================

import type Decimal from 'decimal.js';

import type { Order, OrderRequest, OrderSide, Symbol } from '@quant/exchange';
import type { Kline } from '@quant/marketdata';

// ============================================================================
// 回测事件类型
// ============================================================================

/**
 * 事件类型枚举
 * 定义回测引擎中所有可能的事件类型
 */
export enum EventType {
  // 市场数据事件
  MARKET_DATA = 'MARKET_DATA', // K 线数据更新
  TICK = 'TICK', // 逐笔成交

  // 信号事件
  SIGNAL = 'SIGNAL', // 策略产生的交易信号

  // 订单事件
  ORDER = 'ORDER', // 订单请求
  ORDER_FILLED = 'ORDER_FILLED', // 订单成交
  ORDER_CANCELLED = 'ORDER_CANCELLED', // 订单取消
  ORDER_REJECTED = 'ORDER_REJECTED', // 订单拒绝

  // 仓位事件
  POSITION_OPENED = 'POSITION_OPENED', // 开仓
  POSITION_CLOSED = 'POSITION_CLOSED', // 平仓
  POSITION_UPDATED = 'POSITION_UPDATED', // 仓位更新

  // 系统事件
  START = 'START', // 回测开始
  END = 'END', // 回测结束
  ERROR = 'ERROR', // 错误
}

/**
 * 基础事件接口
 * 所有事件都必须实现此接口
 */
export interface BaseEvent {
  // 事件类型
  readonly type: EventType;

  // 事件时间戳（毫秒）
  readonly timestamp: number;

  // 事件来源（策略名称、模块名称等）
  readonly source?: string;
}

/**
 * 市场数据事件
 * 当新的 K 线数据到达时触发
 */
export interface MarketDataEvent extends BaseEvent {
  readonly type: EventType.MARKET_DATA;

  // K 线数据
  readonly kline: Kline;

  // 交易对
  readonly symbol: Symbol;
}

/**
 * 信号方向
 */
export type SignalDirection = 'long' | 'short' | 'exit_long' | 'exit_short' | 'exit_all';

/**
 * 信号事件
 * 策略产生的交易信号
 */
export interface SignalEvent extends BaseEvent {
  readonly type: EventType.SIGNAL;

  // 交易对
  readonly symbol: Symbol;

  // 信号方向
  readonly direction: SignalDirection;

  // 信号强度（0-1，可选）
  readonly strength?: number;

  // 建议价格（可选）
  readonly price?: Decimal;

  // 建议数量（可选）
  readonly quantity?: Decimal;

  // 止损价格（可选）
  readonly stopLoss?: Decimal;

  // 止盈价格（可选）
  readonly takeProfit?: Decimal;

  // 信号元数据（策略自定义数据）
  readonly metadata?: Record<string, unknown>;
}

/**
 * 订单事件
 * 订单相关的事件
 */
export interface OrderEvent extends BaseEvent {
  readonly type: EventType.ORDER | EventType.ORDER_FILLED | EventType.ORDER_CANCELLED | EventType.ORDER_REJECTED;

  // 订单信息
  readonly order: Order;

  // 拒绝原因（仅 ORDER_REJECTED）
  readonly rejectReason?: string;
}

/**
 * 仓位事件
 */
export interface PositionEvent extends BaseEvent {
  readonly type: EventType.POSITION_OPENED | EventType.POSITION_CLOSED | EventType.POSITION_UPDATED;

  // 仓位信息
  readonly position: BacktestPosition;

  // 已实现盈亏（仅 POSITION_CLOSED）
  readonly realizedPnl?: Decimal;
}

/**
 * 联合事件类型
 */
export type BacktestEvent =
  | MarketDataEvent
  | SignalEvent
  | OrderEvent
  | PositionEvent
  | BaseEvent;

// ============================================================================
// 仓位和交易
// ============================================================================

/**
 * 回测仓位
 */
export interface BacktestPosition {
  // 交易对
  readonly symbol: Symbol;

  // 仓位方向
  readonly side: 'long' | 'short';

  // 持仓数量
  readonly quantity: Decimal;

  // 入场价格
  readonly entryPrice: Decimal;

  // 入场时间
  readonly entryTime: number;

  // 当前价格
  readonly currentPrice: Decimal;

  // 未实现盈亏
  readonly unrealizedPnl: Decimal;

  // 未实现盈亏百分比
  readonly unrealizedPnlPercent: Decimal;

  // 止损价格
  readonly stopLoss?: Decimal;

  // 止盈价格
  readonly takeProfit?: Decimal;
}

/**
 * 已完成交易
 */
export interface ClosedTrade {
  // 交易 ID
  readonly id: string;

  // 交易对
  readonly symbol: Symbol;

  // 交易方向
  readonly side: 'long' | 'short';

  // 入场价格
  readonly entryPrice: Decimal;

  // 出场价格
  readonly exitPrice: Decimal;

  // 交易数量
  readonly quantity: Decimal;

  // 入场时间
  readonly entryTime: number;

  // 出场时间
  readonly exitTime: number;

  // 持仓时间（毫秒）
  readonly holdingPeriod: number;

  // 已实现盈亏
  readonly pnl: Decimal;

  // 盈亏百分比
  readonly pnlPercent: Decimal;

  // 手续费
  readonly commission: Decimal;

  // 净盈亏
  readonly netPnl: Decimal;
}

// ============================================================================
// 回测配置
// ============================================================================

/**
 * 手续费配置
 */
export interface CommissionConfig {
  // 手续费类型：固定金额或百分比
  readonly type: 'fixed' | 'percent';

  // Maker 手续费
  readonly maker: Decimal;

  // Taker 手续费
  readonly taker: Decimal;
}

/**
 * 滑点配置
 */
export interface SlippageConfig {
  // 滑点类型：固定点数或百分比
  readonly type: 'fixed' | 'percent';

  // 滑点值
  readonly value: Decimal;
}

/**
 * 回测引擎配置
 */
export interface BacktestConfig {
  // 初始资金
  readonly initialCapital: Decimal;

  // 回测开始时间
  readonly startTime: number;

  // 回测结束时间
  readonly endTime: number;

  // 交易对列表
  readonly symbols: Symbol[];

  // K 线周期
  readonly interval: string;

  // 手续费配置
  readonly commission: CommissionConfig;

  // 滑点配置
  readonly slippage: SlippageConfig;

  // 是否允许做空
  readonly allowShort: boolean;

  // 单笔最大仓位（占总资金比例）
  readonly maxPositionSize: Decimal;

  // 最大同时持仓数量
  readonly maxOpenPositions: number;

  // 是否启用保证金交易
  readonly marginEnabled: boolean;

  // 杠杆倍数（保证金交易）
  readonly leverage: number;
}

// ============================================================================
// 回测结果和统计
// ============================================================================

/**
 * 权益曲线点
 */
export interface EquityPoint {
  // 时间戳
  readonly timestamp: number;

  // 总权益
  readonly equity: Decimal;

  // 现金余额
  readonly cash: Decimal;

  // 持仓市值
  readonly positionValue: Decimal;

  // 当日收益
  readonly dailyReturn?: Decimal;

  // 累计收益
  readonly cumulativeReturn: Decimal;

  // 最大回撤
  readonly drawdown: Decimal;
}

/**
 * 回测统计结果
 */
export interface BacktestStats {
  // === 基础指标 ===
  // 初始资金
  readonly initialCapital: Decimal;

  // 最终权益
  readonly finalEquity: Decimal;

  // 总收益
  readonly totalReturn: Decimal;

  // 总收益率（百分比）
  readonly totalReturnPercent: Decimal;

  // 年化收益率
  readonly annualizedReturn: Decimal;

  // === 风险指标 ===
  // 最大回撤
  readonly maxDrawdown: Decimal;

  // 最大回撤持续时间（天）
  readonly maxDrawdownDuration: number;

  // 波动率（年化）
  readonly volatility: Decimal;

  // 夏普比率
  readonly sharpeRatio: Decimal;

  // 索提诺比率
  readonly sortinoRatio: Decimal;

  // 卡尔玛比率
  readonly calmarRatio: Decimal;

  // === 交易统计 ===
  // 总交易次数
  readonly totalTrades: number;

  // 盈利交易次数
  readonly winningTrades: number;

  // 亏损交易次数
  readonly losingTrades: number;

  // 胜率
  readonly winRate: Decimal;

  // 平均盈利
  readonly avgWin: Decimal;

  // 平均亏损
  readonly avgLoss: Decimal;

  // 盈亏比
  readonly profitFactor: Decimal;

  // 平均持仓时间
  readonly avgHoldingPeriod: number;

  // 最大连续盈利次数
  readonly maxConsecutiveWins: number;

  // 最大连续亏损次数
  readonly maxConsecutiveLosses: number;

  // === 其他指标 ===
  // 总手续费
  readonly totalCommission: Decimal;

  // 总滑点成本
  readonly totalSlippage: Decimal;

  // 回测时间范围
  readonly startTime: number;
  readonly endTime: number;

  // 交易天数
  readonly tradingDays: number;
}

/**
 * 完整回测结果
 */
export interface BacktestResult {
  // 配置
  readonly config: BacktestConfig;

  // 统计指标
  readonly stats: BacktestStats;

  // 权益曲线
  readonly equityCurve: EquityPoint[];

  // 所有已完成交易
  readonly trades: ClosedTrade[];

  // 运行时间（毫秒）
  readonly executionTime: number;
}

// ============================================================================
// 事件队列接口
// ============================================================================

/**
 * 事件队列接口
 * 定义事件队列必须实现的方法
 */
export interface IEventQueue {
  // 添加事件
  push(event: BacktestEvent): void;

  // 获取下一个事件
  pop(): BacktestEvent | undefined;

  // 查看下一个事件（不移除）
  peek(): BacktestEvent | undefined;

  // 队列是否为空
  isEmpty(): boolean;

  // 队列大小
  size(): number;

  // 清空队列
  clear(): void;
}

// ============================================================================
// 策略接口
// ============================================================================

/**
 * 回测策略接口
 * 所有回测策略都必须实现此接口
 */
export interface IBacktestStrategy {
  // 策略名称
  readonly name: string;

  // 策略描述
  readonly description?: string;

  // 初始化策略
  initialize(context: BacktestContext): void | Promise<void>;

  // 处理市场数据
  onMarketData(event: MarketDataEvent, context: BacktestContext): void | Promise<void>;

  // 处理订单成交
  onOrderFilled?(event: OrderEvent, context: BacktestContext): void | Promise<void>;

  // 处理仓位更新
  onPositionUpdate?(event: PositionEvent, context: BacktestContext): void | Promise<void>;

  // 回测结束清理
  cleanup?(context: BacktestContext): void | Promise<void>;
}

/**
 * 回测上下文
 * 提供给策略的运行时环境
 */
export interface BacktestContext {
  // 当前时间
  readonly currentTime: number;

  // 当前资金
  readonly cash: Decimal;

  // 当前总权益
  readonly equity: Decimal;

  // 当前持仓
  readonly positions: Map<Symbol, BacktestPosition>;

  // 历史交易
  readonly trades: ClosedTrade[];

  // 获取历史 K 线
  getKlines(symbol: Symbol, count: number): Kline[];

  // 获取当前价格
  getCurrentPrice(symbol: Symbol): Decimal | undefined;

  // 下单
  submitOrder(request: OrderRequest): void;

  // 取消订单
  cancelOrder(orderId: string): void;

  // 发出信号
  emitSignal(signal: Omit<SignalEvent, 'type' | 'timestamp'>): void;

  // 记录日志
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void;
}
