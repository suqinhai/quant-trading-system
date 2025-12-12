// ============================================================================
// Zod 类型定义
// 使用 Zod 进行运行时类型验证，确保所有 API 返回数据符合预期格式
// ============================================================================

import { z } from 'zod';

// ============================================================================
// 基础枚举类型
// ============================================================================

/**
 * 订单方向枚举
 * - buy: 买入（做多）
 * - sell: 卖出（做空/平仓）
 */
export const OrderSideSchema = z.enum(['buy', 'sell']);
export type OrderSide = z.infer<typeof OrderSideSchema>;

/**
 * 订单类型枚举
 * - market: 市价单，立即以当前市场价格成交
 * - limit: 限价单，指定价格挂单等待成交
 * - stop: 止损单，触发价格后执行市价单
 * - stop_limit: 止损限价单，触发价格后执行限价单
 * - take_profit: 止盈单，达到目标价格后执行
 * - take_profit_limit: 止盈限价单
 * - trailing_stop: 追踪止损单，随价格移动调整止损价
 */
export const OrderTypeSchema = z.enum([
  'market',           // 市价单
  'limit',            // 限价单
  'stop',             // 止损市价单
  'stop_limit',       // 止损限价单
  'take_profit',      // 止盈市价单
  'take_profit_limit', // 止盈限价单
  'trailing_stop',    // 追踪止损单
]);
export type OrderType = z.infer<typeof OrderTypeSchema>;

/**
 * 订单状态枚举
 * - pending: 待处理，订单已提交但尚未被交易所确认
 * - open: 已挂单，订单在订单簿中等待成交
 * - partially_filled: 部分成交，订单已部分完成
 * - filled: 完全成交，订单已全部完成
 * - canceled: 已取消，用户主动取消订单
 * - rejected: 已拒绝，交易所拒绝执行订单
 * - expired: 已过期，订单超时未成交被系统取消
 */
export const OrderStatusSchema = z.enum([
  'pending',          // 待处理
  'open',             // 已挂单
  'partially_filled', // 部分成交
  'filled',           // 完全成交
  'canceled',         // 已取消
  'rejected',         // 已拒绝
  'expired',          // 已过期
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

/**
 * 持仓方向枚举
 * - long: 多头持仓，买入开仓
 * - short: 空头持仓，卖出开仓
 */
export const PositionSideSchema = z.enum(['long', 'short']);
export type PositionSide = z.infer<typeof PositionSideSchema>;

/**
 * 保证金模式枚举
 * - cross: 全仓模式，所有仓位共享保证金
 * - isolated: 逐仓模式，每个仓位独立保证金
 */
export const MarginModeSchema = z.enum(['cross', 'isolated']);
export type MarginMode = z.infer<typeof MarginModeSchema>;

/**
 * 时间周期枚举（K线周期）
 */
export const TimeframeSchema = z.enum([
  '1m', '3m', '5m', '15m', '30m',  // 分钟级别
  '1h', '2h', '4h', '6h', '12h',   // 小时级别
  '1d', '3d', '1w', '1M',          // 日/周/月级别
]);
export type Timeframe = z.infer<typeof TimeframeSchema>;

// ============================================================================
// 订单相关类型
// ============================================================================

/**
 * 创建订单请求参数
 * 包含创建订单所需的所有信息
 */
export const CreateOrderRequestSchema = z.object({
  // 交易对符号，如 "BTC/USDT:USDT"
  symbol: z.string().min(1, '交易对符号不能为空'),

  // 订单方向：买入或卖出
  side: OrderSideSchema,

  // 订单类型：市价单、限价单等
  type: OrderTypeSchema,

  // 订单数量（合约张数或币数量）
  amount: z.number().positive('订单数量必须大于0'),

  // 限价单价格（市价单时可选）
  price: z.number().positive().optional(),

  // 触发价格（止损/止盈单使用）
  triggerPrice: z.number().positive().optional(),

  // 止损价格
  stopLoss: z.number().positive().optional(),

  // 止盈价格
  takeProfit: z.number().positive().optional(),

  // 是否只做 Maker（只挂单，不吃单）
  postOnly: z.boolean().optional().default(false),

  // 是否为减仓订单（只能减少仓位，不能开新仓）
  reduceOnly: z.boolean().optional().default(false),

  // 杠杆倍数（某些交易所需要在订单中指定）
  leverage: z.number().int().min(1).max(125).optional(),

  // 客户端自定义订单 ID（用于追踪订单）
  clientOrderId: z.string().optional(),

  // 持仓方向（双向持仓模式时使用）
  positionSide: PositionSideSchema.optional(),
});
export type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;

/**
 * 订单结果（统一格式）
 * 无论哪个交易所，返回的订单信息都遵循此格式
 */
export const OrderResultSchema = z.object({
  // 交易所订单 ID（唯一标识）
  id: z.string(),

  // 客户端订单 ID（如果有）
  clientOrderId: z.string().optional(),

  // 交易对符号
  symbol: z.string(),

  // 订单方向
  side: OrderSideSchema,

  // 订单类型
  type: OrderTypeSchema,

  // 订单状态
  status: OrderStatusSchema,

  // 订单价格（限价单的挂单价格）
  price: z.number().nullable(),

  // 订单数量
  amount: z.number(),

  // 已成交数量
  filled: z.number(),

  // 剩余未成交数量
  remaining: z.number(),

  // 平均成交价格
  average: z.number().nullable(),

  // 成交金额（已成交数量 * 平均成交价格）
  cost: z.number(),

  // 手续费信息
  fee: z.object({
    // 手续费金额
    cost: z.number(),
    // 手续费币种
    currency: z.string(),
  }).nullable(),

  // 订单创建时间戳（毫秒）
  timestamp: z.number(),

  // 订单创建时间（ISO 8601 格式字符串）
  datetime: z.string(),

  // 最后更新时间戳（毫秒）
  lastUpdateTimestamp: z.number().optional(),

  // 触发价格（止损/止盈单）
  triggerPrice: z.number().nullable().optional(),

  // 止损价格
  stopLoss: z.number().nullable().optional(),

  // 止盈价格
  takeProfit: z.number().nullable().optional(),

  // 是否为减仓订单
  reduceOnly: z.boolean().optional(),

  // 是否为只做 Maker
  postOnly: z.boolean().optional(),

  // 原始交易所返回数据（用于调试）
  info: z.record(z.unknown()).optional(),
});
export type OrderResult = z.infer<typeof OrderResultSchema>;

// ============================================================================
// 持仓相关类型
// ============================================================================

/**
 * 持仓信息
 * 描述当前持有的合约仓位详情
 */
export const PositionSchema = z.object({
  // 交易对符号
  symbol: z.string(),

  // 持仓方向
  side: PositionSideSchema,

  // 持仓数量（正数表示多头，负数表示空头）
  // 注意：统一使用绝对值，方向由 side 字段表示
  amount: z.number(),

  // 合约张数（某些交易所使用合约数而非币数量）
  contracts: z.number(),

  // 开仓均价
  entryPrice: z.number(),

  // 当前标记价格
  markPrice: z.number(),

  // 强平价格（达到此价格会被强制平仓）
  liquidationPrice: z.number().nullable(),

  // 未实现盈亏（浮动盈亏）
  unrealizedPnl: z.number(),

  // 已实现盈亏
  realizedPnl: z.number(),

  // 持仓盈亏百分比
  percentage: z.number(),

  // 保证金模式
  marginMode: MarginModeSchema,

  // 杠杆倍数
  leverage: z.number(),

  // 持仓保证金
  margin: z.number(),

  // 维持保证金
  maintenanceMargin: z.number().optional(),

  // 初始保证金
  initialMargin: z.number().optional(),

  // 名义价值（持仓数量 * 标记价格）
  notional: z.number(),

  // 最后更新时间戳
  timestamp: z.number(),

  // 原始交易所返回数据
  info: z.record(z.unknown()).optional(),
});
export type Position = z.infer<typeof PositionSchema>;

// ============================================================================
// 账户余额相关类型
// ============================================================================

/**
 * 单个币种余额信息
 */
export const BalanceItemSchema = z.object({
  // 币种符号，如 "USDT"
  currency: z.string(),

  // 可用余额（可用于交易）
  free: z.number(),

  // 已用余额（被订单或仓位占用）
  used: z.number(),

  // 总余额（free + used）
  total: z.number(),
});
export type BalanceItem = z.infer<typeof BalanceItemSchema>;

/**
 * 账户余额信息
 */
export const BalanceSchema = z.object({
  // 各币种余额映射
  currencies: z.record(z.string(), BalanceItemSchema),

  // 账户总权益（以 USDT 计价）
  totalEquity: z.number(),

  // 可用保证金
  availableMargin: z.number(),

  // 已用保证金
  usedMargin: z.number(),

  // 保证金率（已用/总额）
  marginRatio: z.number().optional(),

  // 未实现盈亏总计
  unrealizedPnl: z.number(),

  // 更新时间戳
  timestamp: z.number(),

  // 原始交易所返回数据
  info: z.record(z.unknown()).optional(),
});
export type Balance = z.infer<typeof BalanceSchema>;

// ============================================================================
// 资金费率相关类型
// ============================================================================

/**
 * 资金费率信息
 * 永续合约特有的资金费率机制
 */
export const FundingRateSchema = z.object({
  // 交易对符号
  symbol: z.string(),

  // 当前资金费率（正数表示多头付给空头）
  fundingRate: z.number(),

  // 预测下一期资金费率
  nextFundingRate: z.number().nullable(),

  // 当前结算时间戳
  fundingTimestamp: z.number(),

  // 下次结算时间戳
  nextFundingTimestamp: z.number().nullable(),

  // 结算间隔（毫秒）
  interval: z.number(),

  // 标记价格
  markPrice: z.number(),

  // 指数价格
  indexPrice: z.number(),

  // 原始交易所返回数据
  info: z.record(z.unknown()).optional(),
});
export type FundingRate = z.infer<typeof FundingRateSchema>;

// ============================================================================
// K线数据类型
// ============================================================================

/**
 * K线（OHLCV）数据
 */
export const KlineSchema = z.object({
  // 开盘时间戳（毫秒）
  timestamp: z.number(),

  // 开盘价
  open: z.number(),

  // 最高价
  high: z.number(),

  // 最低价
  low: z.number(),

  // 收盘价
  close: z.number(),

  // 成交量
  volume: z.number(),
});
export type Kline = z.infer<typeof KlineSchema>;

// ============================================================================
// 行情数据类型
// ============================================================================

/**
 * Ticker 行情信息
 * 24小时滚动窗口的市场统计数据
 */
export const TickerSchema = z.object({
  // 交易对符号
  symbol: z.string(),

  // 最新成交价
  last: z.number(),

  // 最优买价（买一价）
  bid: z.number(),

  // 最优买量
  bidVolume: z.number().optional(),

  // 最优卖价（卖一价）
  ask: z.number(),

  // 最优卖量
  askVolume: z.number().optional(),

  // 24小时开盘价
  open: z.number(),

  // 24小时最高价
  high: z.number(),

  // 24小时最低价
  low: z.number(),

  // 24小时收盘价（当前价）
  close: z.number(),

  // 24小时价格变化
  change: z.number(),

  // 24小时价格变化百分比
  percentage: z.number(),

  // 24小时成交量（基础货币）
  baseVolume: z.number(),

  // 24小时成交额（计价货币）
  quoteVolume: z.number(),

  // 时间戳
  timestamp: z.number(),

  // 原始交易所返回数据
  info: z.record(z.unknown()).optional(),
});
export type Ticker = z.infer<typeof TickerSchema>;

/**
 * 订单簿深度数据
 */
export const OrderBookSchema = z.object({
  // 交易对符号
  symbol: z.string(),

  // 买单列表 [价格, 数量][]
  bids: z.array(z.tuple([z.number(), z.number()])),

  // 卖单列表 [价格, 数量][]
  asks: z.array(z.tuple([z.number(), z.number()])),

  // 时间戳
  timestamp: z.number(),

  // Nonce（用于增量更新）
  nonce: z.number().optional(),
});
export type OrderBook = z.infer<typeof OrderBookSchema>;

// ============================================================================
// 交易相关类型
// ============================================================================

/**
 * 成交记录
 */
export const TradeSchema = z.object({
  // 成交 ID
  id: z.string(),

  // 订单 ID
  orderId: z.string(),

  // 交易对符号
  symbol: z.string(),

  // 成交方向
  side: OrderSideSchema,

  // 成交价格
  price: z.number(),

  // 成交数量
  amount: z.number(),

  // 成交金额
  cost: z.number(),

  // 手续费
  fee: z.object({
    cost: z.number(),
    currency: z.string(),
  }).nullable(),

  // 是否为 Maker 成交
  maker: z.boolean(),

  // 成交时间戳
  timestamp: z.number(),

  // 原始交易所返回数据
  info: z.record(z.unknown()).optional(),
});
export type Trade = z.infer<typeof TradeSchema>;

// ============================================================================
// 市场信息类型
// ============================================================================

/**
 * 市场/交易对信息
 */
export const MarketSchema = z.object({
  // 交易对 ID
  id: z.string(),

  // 统一交易对符号
  symbol: z.string(),

  // 基础货币，如 "BTC"
  base: z.string(),

  // 计价货币，如 "USDT"
  quote: z.string(),

  // 结算货币
  settle: z.string().optional(),

  // 是否为永续合约
  swap: z.boolean(),

  // 是否为交割合约
  future: z.boolean(),

  // 是否为期权
  option: z.boolean(),

  // 是否为现货
  spot: z.boolean(),

  // 是否活跃（可交易）
  active: z.boolean(),

  // 合约面值
  contractSize: z.number().optional(),

  // 价格精度（小数位数）
  pricePrecision: z.number(),

  // 数量精度（小数位数）
  amountPrecision: z.number(),

  // 最小价格变动单位
  tickSize: z.number(),

  // 最小数量变动单位
  lotSize: z.number(),

  // 最小订单数量
  minAmount: z.number(),

  // 最大订单数量
  maxAmount: z.number().optional(),

  // 最小订单金额
  minCost: z.number().optional(),

  // Maker 手续费率
  makerFee: z.number().optional(),

  // Taker 手续费率
  takerFee: z.number().optional(),

  // 原始交易所返回数据
  info: z.record(z.unknown()).optional(),
});
export type Market = z.infer<typeof MarketSchema>;

// ============================================================================
// WebSocket 消息类型
// ============================================================================

/**
 * WebSocket 消息类型枚举
 */
export const WsMessageTypeSchema = z.enum([
  'ticker',       // 行情更新
  'orderbook',    // 订单簿更新
  'trade',        // 成交更新
  'kline',        // K线更新
  'order',        // 订单更新
  'position',     // 持仓更新
  'balance',      // 余额更新
  'error',        // 错误消息
  'connected',    // 连接成功
  'disconnected', // 断开连接
  'subscribed',   // 订阅成功
  'unsubscribed', // 取消订阅
]);
export type WsMessageType = z.infer<typeof WsMessageTypeSchema>;

/**
 * WebSocket 消息
 */
export const WsMessageSchema = z.object({
  // 消息类型
  type: WsMessageTypeSchema,

  // 交易对符号（如适用）
  symbol: z.string().optional(),

  // 消息数据
  data: z.unknown(),

  // 时间戳
  timestamp: z.number(),
});
export type WsMessage = z.infer<typeof WsMessageSchema>;

// ============================================================================
// 配置相关类型
// ============================================================================

/**
 * 交易所连接配置
 */
export const ExchangeConfigSchema = z.object({
  // API Key（公钥）
  apiKey: z.string().min(1, 'API Key 不能为空'),

  // API Secret（私钥）
  apiSecret: z.string().min(1, 'API Secret 不能为空'),

  // API 密码（部分交易所需要，如 OKX）
  passphrase: z.string().optional(),

  // 是否使用测试网
  testnet: z.boolean().optional().default(false),

  // 是否为沙盒/模拟环境
  sandbox: z.boolean().optional().default(false),

  // REST API 请求超时时间（毫秒）
  timeout: z.number().positive().optional().default(30000),

  // 是否启用自动限速
  enableRateLimit: z.boolean().optional().default(true),

  // WebSocket 自动重连
  wsAutoReconnect: z.boolean().optional().default(true),

  // WebSocket 重连最大尝试次数
  wsReconnectMaxRetries: z.number().int().positive().optional().default(10),

  // WebSocket 重连基础延迟（毫秒）
  wsReconnectBaseDelay: z.number().positive().optional().default(1000),

  // WebSocket 重连最大延迟（毫秒）
  wsReconnectMaxDelay: z.number().positive().optional().default(30000),

  // 代理配置（用于某些网络环境）
  proxy: z.string().optional(),

  // 自定义请求头
  headers: z.record(z.string()).optional(),
});
export type ExchangeConfig = z.infer<typeof ExchangeConfigSchema>;

// ============================================================================
// 错误相关类型
// ============================================================================

/**
 * 交易所错误类型枚举
 */
export const ExchangeErrorTypeSchema = z.enum([
  'AUTHENTICATION_ERROR',     // 认证失败
  'INSUFFICIENT_FUNDS',       // 余额不足
  'INVALID_ORDER',            // 无效订单
  'ORDER_NOT_FOUND',          // 订单不存在
  'RATE_LIMIT_EXCEEDED',      // 超过频率限制
  'NETWORK_ERROR',            // 网络错误
  'EXCHANGE_ERROR',           // 交易所返回错误
  'INVALID_SYMBOL',           // 无效交易对
  'POSITION_NOT_FOUND',       // 持仓不存在
  'MARGIN_INSUFFICIENT',      // 保证金不足
  'LEVERAGE_ERROR',           // 杠杆设置错误
  'WEBSOCKET_ERROR',          // WebSocket 错误
  'PARSE_ERROR',              // 数据解析错误
  'UNKNOWN_ERROR',            // 未知错误
]);
export type ExchangeErrorType = z.infer<typeof ExchangeErrorTypeSchema>;

/**
 * 交易所错误信息
 */
export const ExchangeErrorSchema = z.object({
  // 错误类型
  type: ExchangeErrorTypeSchema,

  // 错误消息
  message: z.string(),

  // 交易所原始错误码
  code: z.string().optional(),

  // 交易所原始错误消息
  originalMessage: z.string().optional(),

  // 相关交易对
  symbol: z.string().optional(),

  // 相关订单 ID
  orderId: z.string().optional(),

  // 是否可重试
  retryable: z.boolean().optional(),

  // 建议等待时间（毫秒）
  retryAfter: z.number().optional(),
});
export type ExchangeError = z.infer<typeof ExchangeErrorSchema>;

// ============================================================================
// 验证辅助函数
// ============================================================================

/**
 * 验证数据并返回类型安全的结果
 * @param schema - Zod schema
 * @param data - 待验证数据
 * @returns 验证后的数据
 * @throws 验证失败时抛出 ZodError
 */
export function validate<T>(schema: z.ZodType<T>, data: unknown): T {
  // 使用 parse 方法进行严格验证
  // 验证失败会抛出 ZodError，包含详细的错误信息
  return schema.parse(data);
}

/**
 * 安全验证数据，不抛出异常
 * @param schema - Zod schema
 * @param data - 待验证数据
 * @returns 验证结果对象，包含 success 和 data/error
 */
export function safeValidate<T>(
  schema: z.ZodType<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: z.ZodError } {
  // 使用 safeParse 方法进行安全验证
  const result = schema.safeParse(data);

  // 返回格式化的结果
  if (result.success) {
    return { success: true, data: result.data };
  } else {
    return { success: false, error: result.error };
  }
}
