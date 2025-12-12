// ============================================================================
// 交易所抽象基类
// 定义所有交易所适配器必须实现的接口
// ============================================================================

import type Decimal from 'decimal.js';
import EventEmitter from 'eventemitter3';

import type {
  Account,
  ExchangeCapabilities,
  ExchangeConfig,
  ExchangeId,
  Market,
  MarketType,
  Order,
  OrderRequest,
  Position,
  Symbol,
  Trade,
} from './types.js';

// ============================================================================
// 事件类型定义
// ============================================================================

/**
 * 交易所事件类型
 */
export interface ExchangeEvents {
  // 连接成功
  connected: () => void;

  // 断开连接
  disconnected: (reason: string) => void;

  // 重连中
  reconnecting: (attempt: number) => void;

  // 错误
  error: (error: Error) => void;

  // 订单更新
  orderUpdate: (order: Order) => void;

  // 成交更新
  tradeUpdate: (trade: Trade) => void;

  // 余额更新
  balanceUpdate: (account: Account) => void;

  // 仓位更新
  positionUpdate: (position: Position) => void;
}

// ============================================================================
// 抽象基类
// ============================================================================

/**
 * 交易所抽象基类
 *
 * 所有具体交易所适配器都必须继承此类并实现抽象方法。
 * 这个设计遵循模板方法模式，提供了统一的接口和共享的基础功能。
 */
export abstract class BaseExchange extends EventEmitter<ExchangeEvents> {
  // 交易所标识（只读）
  public abstract readonly exchangeId: ExchangeId;

  // 交易所名称
  public abstract readonly name: string;

  // 交易所能力
  public abstract readonly capabilities: ExchangeCapabilities;

  // 交易所配置（受保护）
  protected readonly config: ExchangeConfig;

  // 是否已连接
  protected _connected: boolean = false;

  // 市场信息缓存
  protected markets: Map<Symbol, Market> = new Map();

  /**
   * 构造函数
   * @param config - 交易所配置
   */
  protected constructor(config: ExchangeConfig) {
    super();
    this.config = config;
  }

  // ==========================================================================
  // 连接管理
  // ==========================================================================

  /**
   * 检查是否已连接
   */
  public get connected(): boolean {
    return this._connected;
  }

  /**
   * 初始化连接
   * 加载市场信息、建立 WebSocket 连接等
   */
  public abstract connect(): Promise<void>;

  /**
   * 断开连接
   * 清理资源、关闭 WebSocket 等
   */
  public abstract disconnect(): Promise<void>;

  // ==========================================================================
  // 市场信息
  // ==========================================================================

  /**
   * 加载所有市场信息
   * @returns 市场信息映射
   */
  public abstract loadMarkets(): Promise<Map<Symbol, Market>>;

  /**
   * 获取指定交易对的市场信息
   * @param symbol - 交易对符号
   * @returns 市场信息，如果不存在则返回 undefined
   */
  public getMarket(symbol: Symbol): Market | undefined {
    return this.markets.get(symbol);
  }

  /**
   * 获取所有市场
   * @returns 所有市场信息
   */
  public getMarkets(): Map<Symbol, Market> {
    return new Map(this.markets);
  }

  // ==========================================================================
  // 账户操作
  // ==========================================================================

  /**
   * 获取账户信息
   * @param type - 账户类型（现货/期货等）
   * @returns 账户信息
   */
  public abstract fetchAccount(type?: MarketType): Promise<Account>;

  /**
   * 获取指定币种余额
   * @param currency - 币种
   * @returns 余额数量
   */
  public abstract fetchBalance(currency: string): Promise<Decimal>;

  // ==========================================================================
  // 订单操作
  // ==========================================================================

  /**
   * 创建订单
   * @param request - 订单请求
   * @returns 创建的订单
   */
  public abstract createOrder(request: OrderRequest): Promise<Order>;

  /**
   * 批量创建订单
   * @param requests - 订单请求数组
   * @returns 创建的订单数组
   */
  public abstract createOrders(requests: OrderRequest[]): Promise<Order[]>;

  /**
   * 取消订单
   * @param orderId - 订单 ID
   * @param symbol - 交易对
   * @returns 取消后的订单
   */
  public abstract cancelOrder(orderId: string, symbol: Symbol): Promise<Order>;

  /**
   * 批量取消订单
   * @param orderIds - 订单 ID 数组
   * @param symbol - 交易对
   * @returns 取消的订单数组
   */
  public abstract cancelOrders(orderIds: string[], symbol: Symbol): Promise<Order[]>;

  /**
   * 取消指定交易对的所有订单
   * @param symbol - 交易对
   * @returns 取消的订单数组
   */
  public abstract cancelAllOrders(symbol: Symbol): Promise<Order[]>;

  /**
   * 查询订单
   * @param orderId - 订单 ID
   * @param symbol - 交易对
   * @returns 订单信息
   */
  public abstract fetchOrder(orderId: string, symbol: Symbol): Promise<Order>;

  /**
   * 查询未完成订单
   * @param symbol - 交易对（可选，不指定则查询所有）
   * @returns 未完成订单数组
   */
  public abstract fetchOpenOrders(symbol?: Symbol): Promise<Order[]>;

  /**
   * 查询历史订单
   * @param symbol - 交易对
   * @param since - 起始时间戳（毫秒）
   * @param limit - 返回数量限制
   * @returns 历史订单数组
   */
  public abstract fetchClosedOrders(
    symbol: Symbol,
    since?: number,
    limit?: number
  ): Promise<Order[]>;

  // ==========================================================================
  // 成交记录
  // ==========================================================================

  /**
   * 查询成交记录
   * @param symbol - 交易对
   * @param since - 起始时间戳（毫秒）
   * @param limit - 返回数量限制
   * @returns 成交记录数组
   */
  public abstract fetchMyTrades(symbol: Symbol, since?: number, limit?: number): Promise<Trade[]>;

  // ==========================================================================
  // 仓位操作（期货）
  // ==========================================================================

  /**
   * 获取持仓信息
   * @param symbol - 交易对（可选）
   * @returns 持仓数组
   */
  public abstract fetchPositions(symbol?: Symbol): Promise<Position[]>;

  /**
   * 设置杠杆倍数
   * @param symbol - 交易对
   * @param leverage - 杠杆倍数
   */
  public abstract setLeverage(symbol: Symbol, leverage: number): Promise<void>;

  // ==========================================================================
  // WebSocket 订阅（用于私有数据）
  // ==========================================================================

  /**
   * 订阅订单更新
   */
  public abstract subscribeOrderUpdates(): Promise<void>;

  /**
   * 取消订阅订单更新
   */
  public abstract unsubscribeOrderUpdates(): Promise<void>;

  /**
   * 订阅余额更新
   */
  public abstract subscribeBalanceUpdates(): Promise<void>;

  /**
   * 取消订阅余额更新
   */
  public abstract unsubscribeBalanceUpdates(): Promise<void>;

  /**
   * 订阅仓位更新
   */
  public abstract subscribePositionUpdates(): Promise<void>;

  /**
   * 取消订阅仓位更新
   */
  public abstract unsubscribePositionUpdates(): Promise<void>;

  // ==========================================================================
  // 工具方法
  // ==========================================================================

  /**
   * 将统一符号转换为交易所格式
   * @param symbol - 统一格式的交易对符号（如 BTC/USDT）
   * @returns 交易所格式的符号
   */
  protected abstract toExchangeSymbol(symbol: Symbol): string;

  /**
   * 将交易所格式转换为统一符号
   * @param exchangeSymbol - 交易所格式的符号
   * @returns 统一格式的交易对符号
   */
  protected abstract fromExchangeSymbol(exchangeSymbol: string): Symbol;
}
