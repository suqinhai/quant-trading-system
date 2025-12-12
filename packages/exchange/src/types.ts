// ============================================================================
// 交易所通用类型定义
// 定义所有交易所共享的数据结构
// ============================================================================

import type { Decimal } from 'decimal.js';

// ============================================================================
// 交易对和市场信息
// ============================================================================

/**
 * 交易对符号
 * 统一格式：BASE/QUOTE，如 BTC/USDT
 */
export type Symbol = string;

/**
 * 交易所标识符
 * 如：binance, okx, bybit, coinbase
 */
export type ExchangeId = string;

/**
 * 市场类型
 * - spot: 现货市场
 * - futures: 期货市场（永续合约）
 * - swap: 永续合约
 * - option: 期权市场
 */
export type MarketType = 'spot' | 'futures' | 'swap' | 'option';

/**
 * 市场信息接口
 * 描述一个交易市场的基本信息
 */
export interface Market {
  // 交易对符号（统一格式）
  readonly symbol: Symbol;

  // 交易所原始符号
  readonly exchangeSymbol: string;

  // 交易所标识
  readonly exchangeId: ExchangeId;

  // 市场类型
  readonly type: MarketType;

  // 基础货币（如 BTC）
  readonly base: string;

  // 报价货币（如 USDT）
  readonly quote: string;

  // 是否激活可交易
  readonly active: boolean;

  // 价格精度（小数位数）
  readonly pricePrecision: number;

  // 数量精度（小数位数）
  readonly amountPrecision: number;

  // 最小下单数量
  readonly minAmount: Decimal;

  // 最小下单金额
  readonly minNotional: Decimal;

  // 合约乘数（仅期货/期权）
  readonly contractSize?: Decimal;

  // 结算货币（仅期货/期权）
  readonly settleCurrency?: string;
}

// ============================================================================
// 订单相关类型
// ============================================================================

/**
 * 订单方向
 */
export type OrderSide = 'buy' | 'sell';

/**
 * 订单类型
 * - limit: 限价单
 * - market: 市价单
 * - stop_limit: 止损限价单
 * - stop_market: 止损市价单
 * - take_profit_limit: 止盈限价单
 * - take_profit_market: 止盈市价单
 */
export type OrderType =
  | 'limit'
  | 'market'
  | 'stop_limit'
  | 'stop_market'
  | 'take_profit_limit'
  | 'take_profit_market';

/**
 * 订单状态
 * - pending: 待提交
 * - open: 已挂单，等待成交
 * - partially_filled: 部分成交
 * - filled: 完全成交
 * - canceled: 已取消
 * - rejected: 被拒绝
 * - expired: 已过期
 */
export type OrderStatus =
  | 'pending'
  | 'open'
  | 'partially_filled'
  | 'filled'
  | 'canceled'
  | 'rejected'
  | 'expired';

/**
 * 有效期类型
 * - GTC: Good Till Cancel，直到取消
 * - IOC: Immediate Or Cancel，立即成交或取消
 * - FOK: Fill Or Kill，全部成交或取消
 * - GTD: Good Till Date，直到指定日期
 */
export type TimeInForce = 'GTC' | 'IOC' | 'FOK' | 'GTD';

/**
 * 仓位方向（仅期货）
 */
export type PositionSide = 'long' | 'short' | 'both';

/**
 * 订单请求接口
 * 用于创建新订单
 */
export interface OrderRequest {
  // 交易对
  readonly symbol: Symbol;

  // 订单方向
  readonly side: OrderSide;

  // 订单类型
  readonly type: OrderType;

  // 下单数量
  readonly amount: Decimal;

  // 限价单价格（市价单可选）
  readonly price?: Decimal;

  // 止损/止盈触发价格
  readonly triggerPrice?: Decimal;

  // 有效期类型
  readonly timeInForce?: TimeInForce;

  // 仓位方向（期货）
  readonly positionSide?: PositionSide;

  // 是否只减仓
  readonly reduceOnly?: boolean;

  // 客户端订单 ID（用于幂等性）
  readonly clientOrderId?: string;
}

/**
 * 订单接口
 * 交易所返回的订单信息
 */
export interface Order {
  // 交易所订单 ID
  readonly id: string;

  // 客户端订单 ID
  readonly clientOrderId?: string;

  // 交易对
  readonly symbol: Symbol;

  // 交易所标识
  readonly exchangeId: ExchangeId;

  // 订单方向
  readonly side: OrderSide;

  // 订单类型
  readonly type: OrderType;

  // 订单状态
  readonly status: OrderStatus;

  // 下单价格
  readonly price: Decimal;

  // 下单数量
  readonly amount: Decimal;

  // 已成交数量
  readonly filled: Decimal;

  // 剩余数量
  readonly remaining: Decimal;

  // 平均成交价格
  readonly avgPrice: Decimal;

  // 手续费
  readonly fee: Decimal;

  // 手续费币种
  readonly feeCurrency: string;

  // 创建时间（毫秒时间戳）
  readonly timestamp: number;

  // 最后更新时间
  readonly lastUpdateTime: number;

  // 交易所原始数据
  readonly raw?: unknown;
}

// ============================================================================
// 成交记录
// ============================================================================

/**
 * 成交记录接口
 */
export interface Trade {
  // 成交 ID
  readonly id: string;

  // 订单 ID
  readonly orderId: string;

  // 交易对
  readonly symbol: Symbol;

  // 成交方向
  readonly side: OrderSide;

  // 成交价格
  readonly price: Decimal;

  // 成交数量
  readonly amount: Decimal;

  // 成交金额
  readonly cost: Decimal;

  // 手续费
  readonly fee: Decimal;

  // 手续费币种
  readonly feeCurrency: string;

  // 成交时间（毫秒时间戳）
  readonly timestamp: number;

  // 是否为 maker 成交
  readonly isMaker: boolean;
}

// ============================================================================
// 账户和余额
// ============================================================================

/**
 * 单币种余额
 */
export interface Balance {
  // 币种
  readonly currency: string;

  // 可用余额
  readonly free: Decimal;

  // 冻结余额
  readonly locked: Decimal;

  // 总余额
  readonly total: Decimal;
}

/**
 * 账户信息
 */
export interface Account {
  // 交易所标识
  readonly exchangeId: ExchangeId;

  // 账户类型（现货/期货等）
  readonly type: MarketType;

  // 各币种余额
  readonly balances: Map<string, Balance>;

  // 更新时间
  readonly timestamp: number;
}

// ============================================================================
// 仓位（期货）
// ============================================================================

/**
 * 期货仓位
 */
export interface Position {
  // 交易对
  readonly symbol: Symbol;

  // 仓位方向
  readonly side: PositionSide;

  // 仓位数量
  readonly amount: Decimal;

  // 入场价格
  readonly entryPrice: Decimal;

  // 标记价格
  readonly markPrice: Decimal;

  // 未实现盈亏
  readonly unrealizedPnl: Decimal;

  // 已实现盈亏
  readonly realizedPnl: Decimal;

  // 杠杆倍数
  readonly leverage: number;

  // 保证金
  readonly margin: Decimal;

  // 保证金率
  readonly marginRatio: Decimal;

  // 强平价格
  readonly liquidationPrice: Decimal;

  // 更新时间
  readonly timestamp: number;
}

// ============================================================================
// 交易所能力和配置
// ============================================================================

/**
 * 交易所能力
 * 描述交易所支持的功能
 */
export interface ExchangeCapabilities {
  // 是否支持现货交易
  readonly spot: boolean;

  // 是否支持期货交易
  readonly futures: boolean;

  // 是否支持期权交易
  readonly options: boolean;

  // 是否支持杠杆交易
  readonly margin: boolean;

  // 是否支持 WebSocket
  readonly websocket: boolean;

  // 是否支持订单簿订阅
  readonly orderbook: boolean;

  // 是否支持成交流订阅
  readonly trades: boolean;

  // 是否支持 K 线订阅
  readonly klines: boolean;

  // 是否支持用户订单推送
  readonly userOrders: boolean;

  // 是否支持用户余额推送
  readonly userBalance: boolean;
}

/**
 * 交易所配置
 */
export interface ExchangeConfig {
  // 交易所标识
  readonly exchangeId: ExchangeId;

  // API Key
  readonly apiKey: string;

  // API Secret
  readonly apiSecret: string;

  // API 密码（部分交易所需要）
  readonly passphrase?: string;

  // 是否使用沙盒/测试网
  readonly sandbox?: boolean;

  // 代理配置
  readonly proxy?: string;

  // 超时时间（毫秒）
  readonly timeout?: number;

  // 速率限制（每秒请求数）
  readonly rateLimit?: number;

  // 自定义 API 端点
  readonly urls?: {
    readonly api?: string;
    readonly ws?: string;
  };
}

// ============================================================================
// 错误类型
// ============================================================================

/**
 * 交易所错误代码
 */
export enum ExchangeErrorCode {
  // 网络错误
  NETWORK_ERROR = 'NETWORK_ERROR',

  // 认证错误
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',

  // 权限不足
  PERMISSION_DENIED = 'PERMISSION_DENIED',

  // 余额不足
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',

  // 订单不存在
  ORDER_NOT_FOUND = 'ORDER_NOT_FOUND',

  // 无效的订单参数
  INVALID_ORDER = 'INVALID_ORDER',

  // 最小下单量限制
  MIN_NOTIONAL = 'MIN_NOTIONAL',

  // 频率限制
  RATE_LIMIT = 'RATE_LIMIT',

  // 交易所维护中
  EXCHANGE_MAINTENANCE = 'EXCHANGE_MAINTENANCE',

  // 未知错误
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * 交易所错误
 */
export class ExchangeError extends Error {
  public constructor(
    // 错误代码
    public readonly code: ExchangeErrorCode,
    // 错误消息
    message: string,
    // 交易所标识
    public readonly exchangeId?: ExchangeId,
    // 原始错误
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ExchangeError';
  }
}
