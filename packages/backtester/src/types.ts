// ============================================================================
// 事件驱动回测引擎类型定义
// 定义所有核心数据结构：事件、订单、持仓、账户、策略接口
// ============================================================================

// ============================================================================
// 基础类型
// ============================================================================

// 交易所 ID 类型（支持的交易所）
export type ExchangeId = 'binance' | 'bybit' | 'okx';

// 订单方向（买入/卖出）
export type OrderSide = 'buy' | 'sell';

// 订单类型（限价单/市价单）
export type OrderType = 'limit' | 'market';

// 订单状态（待处理/部分成交/完全成交/已取消/已拒绝）
export type OrderStatus = 'pending' | 'partial' | 'filled' | 'cancelled' | 'rejected';

// 持仓方向（多头/空头/无持仓）
export type PositionSide = 'long' | 'short' | 'none';

// 时间精度类型（毫秒级时间戳）
export type Timestamp = number;

// ============================================================================
// 事件类型定义
// ============================================================================

// 事件基础接口（所有事件继承此接口）
export interface BaseEvent {
  // 事件类型标识
  readonly type: string;
  // 事件时间戳（毫秒）
  readonly timestamp: Timestamp;
  // 交易所 ID
  readonly exchange: ExchangeId;
  // 交易对符号（如 BTC/USDT:USDT）
  readonly symbol: string;
}

// 逐笔成交事件（来自 ClickHouse aggTrade 数据）
export interface TradeEvent extends BaseEvent {
  // 事件类型固定为 trade
  readonly type: 'trade';
  // 成交 ID（交易所分配的唯一标识）
  readonly tradeId: string;
  // 成交价格
  readonly price: number;
  // 成交数量
  readonly quantity: number;
  // 是否为卖方主动成交（true = 卖单主动, false = 买单主动）
  readonly isSell: boolean;
}

// 深度快照事件（来自 ClickHouse depth 数据）
export interface DepthEvent extends BaseEvent {
  // 事件类型固定为 depth
  readonly type: 'depth';
  // 买单列表（价格从高到低排序）
  readonly bids: readonly PriceLevel[];
  // 卖单列表（价格从低到高排序）
  readonly asks: readonly PriceLevel[];
}

// 价格档位（用于深度数据）
export interface PriceLevel {
  // 价格
  readonly price: number;
  // 数量
  readonly quantity: number;
}

// 资金费率事件（来自 ClickHouse funding_rate 数据）
export interface FundingEvent extends BaseEvent {
  // 事件类型固定为 funding
  readonly type: 'funding';
  // 资金费率（正数多头付给空头，负数空头付给多头）
  readonly fundingRate: number;
  // 标记价格（用于计算资金费用）
  readonly markPrice: number;
  // 下次资金费率结算时间
  readonly nextFundingTime: Timestamp;
}

// 标记价格事件（用于强平计算）
export interface MarkPriceEvent extends BaseEvent {
  // 事件类型固定为 markPrice
  readonly type: 'markPrice';
  // 标记价格
  readonly markPrice: number;
  // 指数价格（现货价格加权平均）
  readonly indexPrice: number;
}

// K线事件（可选，用于策略分析）
export interface KlineEvent extends BaseEvent {
  // 事件类型固定为 kline
  readonly type: 'kline';
  // K线开盘时间
  readonly openTime: Timestamp;
  // 开盘价
  readonly open: number;
  // 最高价
  readonly high: number;
  // 最低价
  readonly low: number;
  // 收盘价
  readonly close: number;
  // 成交量
  readonly volume: number;
  // 成交额
  readonly quoteVolume: number;
  // 成交笔数
  readonly trades: number;
}

// 订单成交事件（内部生成，通知策略订单状态变化）
export interface OrderFilledEvent extends BaseEvent {
  // 事件类型固定为 orderFilled
  readonly type: 'orderFilled';
  // 订单 ID
  readonly orderId: string;
  // 成交价格
  readonly fillPrice: number;
  // 成交数量
  readonly fillQuantity: number;
  // 手续费
  readonly fee: number;
  // 手续费币种
  readonly feeCurrency: string;
  // 是否为 maker 成交
  readonly isMaker: boolean;
}

// 强平事件（内部生成，通知策略仓位被强平）
export interface LiquidationEvent extends BaseEvent {
  // 事件类型固定为 liquidation
  readonly type: 'liquidation';
  // 强平价格
  readonly liquidationPrice: number;
  // 强平数量
  readonly quantity: number;
  // 强平方向（多头被强平还是空头被强平）
  readonly side: PositionSide;
  // 强平损失
  readonly loss: number;
}

// 联合事件类型（所有可能的事件）
export type BacktestEvent =
  | TradeEvent
  | DepthEvent
  | FundingEvent
  | MarkPriceEvent
  | KlineEvent
  | OrderFilledEvent
  | LiquidationEvent;

// ============================================================================
// 订单类型定义
// ============================================================================

// 订单请求（策略下单时提交的参数）
export interface OrderRequest {
  // 交易所 ID
  exchange: ExchangeId;
  // 交易对符号
  symbol: string;
  // 订单方向
  side: OrderSide;
  // 订单类型
  type: OrderType;
  // 订单数量（合约张数或币数量）
  quantity: number;
  // 限价单价格（市价单可不填）
  price?: number;
  // 是否为 Post-Only（只做 maker，如果会立即成交则拒绝）
  postOnly?: boolean;
  // 是否为 Reduce-Only（只减仓，不开新仓）
  reduceOnly?: boolean;
  // 客户端订单 ID（可选，用于策略追踪）
  clientOrderId?: string;
}

// 订单对象（系统内部订单表示）
export interface Order {
  // 订单 ID（系统生成的唯一标识）
  readonly id: string;
  // 客户端订单 ID
  readonly clientOrderId?: string;
  // 交易所 ID
  readonly exchange: ExchangeId;
  // 交易对符号
  readonly symbol: string;
  // 订单方向
  readonly side: OrderSide;
  // 订单类型
  readonly type: OrderType;
  // 订单数量
  readonly quantity: number;
  // 限价单价格
  readonly price?: number;
  // 是否为 Post-Only
  readonly postOnly: boolean;
  // 是否为 Reduce-Only
  readonly reduceOnly: boolean;
  // 订单状态
  status: OrderStatus;
  // 已成交数量
  filledQuantity: number;
  // 平均成交价格
  avgFillPrice: number;
  // 累计手续费
  totalFee: number;
  // 创建时间
  readonly createdAt: Timestamp;
  // 更新时间
  updatedAt: Timestamp;
  // 拒绝原因（如果被拒绝）
  rejectReason?: string;
}

// ============================================================================
// 持仓类型定义
// ============================================================================

// 持仓信息
export interface Position {
  // 交易所 ID
  readonly exchange: ExchangeId;
  // 交易对符号
  readonly symbol: string;
  // 持仓方向
  side: PositionSide;
  // 持仓数量（始终为正数）
  quantity: number;
  // 开仓均价
  entryPrice: number;
  // 未实现盈亏
  unrealizedPnl: number;
  // 已实现盈亏
  realizedPnl: number;
  // 杠杆倍数
  leverage: number;
  // 保证金模式（逐仓/全仓）
  marginMode: 'isolated' | 'cross';
  // 逐仓保证金（仅逐仓模式）
  isolatedMargin: number;
  // 强平价格
  liquidationPrice: number;
  // 累计资金费用（正数为支出，负数为收入）
  fundingFee: number;
  // 最后更新时间
  updatedAt: Timestamp;
}

// ============================================================================
// 账户类型定义
// ============================================================================

// 账户状态
export interface Account {
  // 账户余额（USDT）
  balance: number;
  // 可用余额（扣除保证金后）
  availableBalance: number;
  // 已用保证金
  usedMargin: number;
  // 总未实现盈亏
  totalUnrealizedPnl: number;
  // 总已实现盈亏
  totalRealizedPnl: number;
  // 累计手续费
  totalFee: number;
  // 累计资金费用
  totalFundingFee: number;
  // 账户权益（余额 + 未实现盈亏）
  equity: number;
  // 保证金率（已用保证金 / 账户权益）
  marginRatio: number;
  // 最大杠杆
  maxLeverage: number;
  // 默认杠杆
  defaultLeverage: number;
  // 最后更新时间
  updatedAt: Timestamp;
}

// ============================================================================
// 交易费率配置
// ============================================================================

// 手续费配置
export interface FeeConfig {
  // Maker 手续费率（挂单成交）
  makerFee: number;
  // Taker 手续费率（吃单成交）
  takerFee: number;
}

// 各交易所默认费率配置
export const DEFAULT_FEE_CONFIG: Record<ExchangeId, FeeConfig> = {
  // Binance 合约费率（VIP0）
  binance: {
    makerFee: 0.0002,  // 0.02%
    takerFee: 0.0004,  // 0.04%
  },
  // Bybit 合约费率（VIP0）
  bybit: {
    makerFee: 0.0001,  // 0.01%
    takerFee: 0.0006,  // 0.06%
  },
  // OKX 合约费率（VIP0）
  okx: {
    makerFee: 0.0002,  // 0.02%
    takerFee: 0.0005,  // 0.05%
  },
};

// ============================================================================
// 滑点模型配置
// ============================================================================

// 滑点模型类型
export type SlippageModelType = 'fixed' | 'linear' | 'sqrt' | 'dynamic';

// 滑点模型配置
export interface SlippageConfig {
  // 滑点模型类型
  type: SlippageModelType;
  // 固定滑点（仅 fixed 模式，单位：基点 bps）
  fixedSlippage?: number;
  // 线性滑点系数（仅 linear 模式）
  linearCoefficient?: number;
  // 平方根滑点系数（仅 sqrt 模式）
  sqrtCoefficient?: number;
  // 最大滑点限制（百分比）
  maxSlippage?: number;
  // 是否启用深度模拟（dynamic 模式自动启用）
  useDepth?: boolean;
}

// 默认滑点配置（使用动态深度模型）
export const DEFAULT_SLIPPAGE_CONFIG: SlippageConfig = {
  // 使用动态滑点（基于深度）
  type: 'dynamic',
  // 最大滑点限制 1%
  maxSlippage: 0.01,
  // 启用深度模拟
  useDepth: true,
};

// ============================================================================
// 回测配置
// ============================================================================

// 回测配置
export interface BacktestConfig {
  // 交易所列表
  exchanges: ExchangeId[];
  // 交易对列表
  symbols: string[];
  // 回测开始时间（毫秒时间戳或日期字符串）
  startTime: Timestamp | string;
  // 回测结束时间（毫秒时间戳或日期字符串）
  endTime: Timestamp | string;
  // 初始资金（USDT）
  initialBalance: number;
  // 默认杠杆倍数
  defaultLeverage: number;
  // 最大杠杆倍数
  maxLeverage: number;
  // 手续费配置（可覆盖默认值）
  feeConfig?: Partial<Record<ExchangeId, FeeConfig>>;
  // 滑点配置
  slippageConfig?: SlippageConfig;
  // 是否启用资金费率模拟
  enableFunding: boolean;
  // 是否启用强平模拟
  enableLiquidation: boolean;
  // 维持保证金率（用于计算强平价格）
  maintenanceMarginRate: number;
  // 数据加载批次大小（用于性能优化）
  dataBatchSize: number;
  // 事件缓冲区大小
  eventBufferSize: number;
  // ClickHouse 配置
  clickhouse: ClickHouseConfig;
}

// ClickHouse 配置
export interface ClickHouseConfig {
  // 主机地址
  host: string;
  // 端口号
  port: number;
  // 数据库名
  database: string;
  // 用户名
  username?: string;
  // 密码
  password?: string;
}

// 默认回测配置
export const DEFAULT_BACKTEST_CONFIG: Partial<BacktestConfig> = {
  // 默认初始资金 10000 USDT
  initialBalance: 10000,
  // 默认杠杆 10 倍
  defaultLeverage: 10,
  // 最大杠杆 100 倍
  maxLeverage: 100,
  // 启用资金费率模拟
  enableFunding: true,
  // 启用强平模拟
  enableLiquidation: true,
  // 维持保证金率 0.5%
  maintenanceMarginRate: 0.005,
  // 数据加载批次 100000 条
  dataBatchSize: 100000,
  // 事件缓冲区 10000 条
  eventBufferSize: 10000,
};

// ============================================================================
// 策略接口定义
// ============================================================================

// 策略上下文（传递给策略的环境信息）
export interface StrategyContext {
  // 当前时间戳
  readonly timestamp: Timestamp;
  // 账户状态
  readonly account: Readonly<Account>;
  // 所有持仓（按 exchange:symbol 索引）
  readonly positions: ReadonlyMap<string, Readonly<Position>>;
  // 所有活跃订单（按订单 ID 索引）
  readonly activeOrders: ReadonlyMap<string, Readonly<Order>>;
  // 最新深度数据（按 exchange:symbol 索引）
  readonly depths: ReadonlyMap<string, Readonly<DepthEvent>>;
  // 最新标记价格（按 exchange:symbol 索引）
  readonly markPrices: ReadonlyMap<string, number>;
}

// 策略动作（策略返回的操作指令）
export interface StrategyAction {
  // 下单请求列表
  orders?: OrderRequest[];
  // 取消订单 ID 列表
  cancelOrders?: string[];
  // 修改订单列表
  modifyOrders?: {
    orderId: string;
    newPrice?: number;
    newQuantity?: number;
  }[];
}

// 策略接口（所有策略必须实现此接口）
export interface Strategy {
  // 策略名称（唯一标识）
  readonly name: string;
  // 策略版本
  readonly version: string;
  // 策略描述
  readonly description?: string;

  // 初始化回调（回测开始前调用）
  onInit?(context: StrategyContext): void | Promise<void>;

  // 逐笔成交回调
  onTrade?(event: TradeEvent, context: StrategyContext): StrategyAction | void;

  // 深度更新回调
  onDepth?(event: DepthEvent, context: StrategyContext): StrategyAction | void;

  // 资金费率回调
  onFunding?(event: FundingEvent, context: StrategyContext): StrategyAction | void;

  // 标记价格回调
  onMarkPrice?(event: MarkPriceEvent, context: StrategyContext): StrategyAction | void;

  // K线回调
  onKline?(event: KlineEvent, context: StrategyContext): StrategyAction | void;

  // 订单成交回调
  onOrderFilled?(event: OrderFilledEvent, context: StrategyContext): StrategyAction | void;

  // 强平回调
  onLiquidation?(event: LiquidationEvent, context: StrategyContext): void;

  // 清理回调（回测结束后调用）
  onDestroy?(): void | Promise<void>;
}

// ============================================================================
// 回测结果类型定义
// ============================================================================

// 交易记录
export interface TradeRecord {
  // 交易 ID
  readonly id: string;
  // 订单 ID
  readonly orderId: string;
  // 交易时间
  readonly timestamp: Timestamp;
  // 交易所
  readonly exchange: ExchangeId;
  // 交易对
  readonly symbol: string;
  // 方向
  readonly side: OrderSide;
  // 成交价格
  readonly price: number;
  // 成交数量
  readonly quantity: number;
  // 手续费
  readonly fee: number;
  // 实现盈亏（平仓时计算）
  readonly realizedPnl: number;
  // 是否为 maker 成交
  readonly isMaker: boolean;
}

// 权益曲线点
export interface EquityPoint {
  // 时间戳
  readonly timestamp: Timestamp;
  // 账户权益
  readonly equity: number;
  // 可用余额
  readonly balance: number;
  // 未实现盈亏
  readonly unrealizedPnl: number;
  // 已用保证金
  readonly usedMargin: number;
}

// 回测统计指标
export interface BacktestStats {
  // 基本信息
  readonly startTime: Timestamp;        // 回测开始时间
  readonly endTime: Timestamp;          // 回测结束时间
  readonly duration: number;            // 回测时长（毫秒）
  readonly initialBalance: number;      // 初始资金
  readonly finalEquity: number;         // 最终权益

  // 收益指标
  readonly totalReturn: number;         // 总收益率
  readonly annualizedReturn: number;    // 年化收益率
  readonly maxDrawdown: number;         // 最大回撤
  readonly maxDrawdownDuration: number; // 最大回撤持续时间（毫秒）

  // 风险指标
  readonly sharpeRatio: number;         // 夏普比率（假设无风险利率 0）
  readonly sortinoRatio: number;        // 索提诺比率
  readonly calmarRatio: number;         // 卡玛比率
  readonly volatility: number;          // 波动率（年化）

  // 交易统计
  readonly totalTrades: number;         // 总交易次数
  readonly winningTrades: number;       // 盈利交易次数
  readonly losingTrades: number;        // 亏损交易次数
  readonly winRate: number;             // 胜率
  readonly avgWin: number;              // 平均盈利
  readonly avgLoss: number;             // 平均亏损
  readonly profitFactor: number;        // 盈亏比
  readonly avgHoldingTime: number;      // 平均持仓时间（毫秒）

  // 成本统计
  readonly totalFees: number;           // 总手续费
  readonly totalFundingFees: number;    // 总资金费用
  readonly totalSlippage: number;       // 总滑点成本

  // 强平统计
  readonly liquidationCount: number;    // 强平次数
  readonly totalLiquidationLoss: number;// 强平总损失

  // 性能指标
  readonly eventsProcessed: number;     // 处理的事件总数
  readonly processingTime: number;      // 处理耗时（毫秒）
  readonly eventsPerSecond: number;     // 每秒处理事件数
}

// 回测结果
export interface BacktestResult {
  // 配置信息
  readonly config: BacktestConfig;
  // 统计指标
  readonly stats: BacktestStats;
  // 权益曲线
  readonly equityCurve: EquityPoint[];
  // 交易记录
  readonly trades: TradeRecord[];
  // 最终持仓
  readonly finalPositions: Position[];
  // 最终账户状态
  readonly finalAccount: Account;
}

// ============================================================================
// 工具类型
// ============================================================================

// 生成仓位键（用于 Map 索引）
export function getPositionKey(exchange: ExchangeId, symbol: string): string {
  // 使用冒号连接交易所和交易对
  return `${exchange}:${symbol}`;
}

// 解析仓位键
export function parsePositionKey(key: string): { exchange: ExchangeId; symbol: string } {
  // 按冒号分割
  const [exchange, symbol] = key.split(':') as [ExchangeId, string];
  // 返回解析结果
  return { exchange, symbol };
}

// 生成唯一 ID（用于订单和交易）
export function generateId(): string {
  // 使用时间戳 + 随机数生成
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

// 时间戳转日期字符串
export function timestampToString(timestamp: Timestamp): string {
  // 转换为 ISO 字符串
  return new Date(timestamp).toISOString();
}

// 日期字符串转时间戳
export function stringToTimestamp(dateStr: string): Timestamp {
  // 解析日期字符串
  return new Date(dateStr).getTime();
}
