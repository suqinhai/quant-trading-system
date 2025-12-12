// ============================================================================
// Binance 交易所适配器
// 实现 Binance 现货和 U 本位合约的交易接口
// ============================================================================

import ccxt from 'ccxt';
import Decimal from 'decimal.js';
import pino from 'pino';
import WebSocket from 'ws';

import { BaseExchange } from '../base.js';
import {
  ExchangeError,
  ExchangeErrorCode,
  type Account,
  type Balance,
  type ExchangeCapabilities,
  type ExchangeConfig,
  type Market,
  type MarketType,
  type Order,
  type OrderRequest,
  type OrderStatus,
  type Position,
  type Symbol,
  type Trade,
} from '../types.js';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * Binance WebSocket 消息类型
 */
interface BinanceWsMessage {
  // 事件类型
  e: string;
  // 事件时间
  E: number;
  // 交易对
  s: string;
  // 其他字段根据事件类型不同而不同
  [key: string]: unknown;
}

/**
 * Binance 订单更新消息
 */
interface BinanceOrderUpdate extends BinanceWsMessage {
  e: 'executionReport'; // 事件类型
  s: string; // 交易对
  c: string; // 客户端订单 ID
  S: 'BUY' | 'SELL'; // 订单方向
  o: string; // 订单类型
  f: string; // 有效期类型
  q: string; // 订单数量
  p: string; // 订单价格
  X: string; // 订单状态
  i: number; // 订单 ID
  l: string; // 最新成交数量
  z: string; // 累计成交数量
  L: string; // 最新成交价格
  n: string; // 手续费
  N: string; // 手续费资产
  T: number; // 成交时间
}

// ============================================================================
// 适配器实现
// ============================================================================

/**
 * Binance 交易所适配器
 *
 * 支持功能：
 * - 现货交易
 * - U 本位永续合约交易
 * - WebSocket 实时订单推送
 * - WebSocket 余额更新推送
 */
export class BinanceExchange extends BaseExchange {
  // 交易所标识
  public readonly exchangeId = 'binance';

  // 交易所名称
  public readonly name = 'Binance';

  // 交易所能力
  public readonly capabilities: ExchangeCapabilities = {
    spot: true, // 支持现货
    futures: true, // 支持期货
    options: false, // 暂不支持期权
    margin: true, // 支持杠杆
    websocket: true, // 支持 WebSocket
    orderbook: true, // 支持订单簿推送
    trades: true, // 支持成交推送
    klines: true, // 支持 K 线推送
    userOrders: true, // 支持用户订单推送
    userBalance: true, // 支持余额推送
  };

  // CCXT 实例（用于 REST API）
  private ccxtExchange: ccxt.binance;

  // WebSocket 连接
  private wsConnection: WebSocket | null = null;

  // WebSocket 重连次数
  private reconnectAttempts: number = 0;

  // 最大重连次数
  private readonly maxReconnectAttempts: number = 10;

  // 重连延迟基数（毫秒）
  private readonly reconnectDelayBase: number = 1000;

  // Listen Key（用于用户数据流）
  private listenKey: string | null = null;

  // Listen Key 保活定时器
  private listenKeyKeepAliveTimer: NodeJS.Timeout | null = null;

  // 日志记录器
  private readonly logger: pino.Logger;

  /**
   * 构造函数
   * @param config - 交易所配置
   */
  public constructor(config: ExchangeConfig) {
    super(config);

    // 初始化日志记录器
    this.logger = pino({
      name: 'BinanceExchange',
      level: process.env['LOG_LEVEL'] ?? 'info',
    });

    // 初始化 CCXT 实例
    this.ccxtExchange = new ccxt.binance({
      apiKey: config.apiKey,
      secret: config.apiSecret,
      // 启用沙盒模式（测试网）
      sandbox: config.sandbox ?? false,
      // 启用速率限制
      enableRateLimit: true,
      // 超时设置
      timeout: config.timeout ?? 30000,
      // 代理设置
      ...(config.proxy ? { proxy: config.proxy } : {}),
      // 自定义选项
      options: {
        // 默认返回类型
        defaultType: 'spot',
        // 自动调整时间
        adjustForTimeDifference: true,
        // 时间戳精度
        recvWindow: 5000,
      },
    });
  }

  // ==========================================================================
  // 连接管理
  // ==========================================================================

  /**
   * 初始化连接
   */
  public async connect(): Promise<void> {
    try {
      this.logger.info('Connecting to Binance...');

      // 加载市场信息
      await this.loadMarkets();

      // 标记为已连接
      this._connected = true;

      this.logger.info('Successfully connected to Binance');
      this.emit('connected');
    } catch (error) {
      this.logger.error({ error }, 'Failed to connect to Binance');
      throw this.wrapError(error);
    }
  }

  /**
   * 断开连接
   */
  public async disconnect(): Promise<void> {
    this.logger.info('Disconnecting from Binance...');

    // 停止 Listen Key 保活
    if (this.listenKeyKeepAliveTimer) {
      clearInterval(this.listenKeyKeepAliveTimer);
      this.listenKeyKeepAliveTimer = null;
    }

    // 关闭 WebSocket 连接
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = null;
    }

    this._connected = false;
    this.emit('disconnected', 'Manual disconnect');
    this.logger.info('Disconnected from Binance');
  }

  // ==========================================================================
  // 市场信息
  // ==========================================================================

  /**
   * 加载所有市场信息
   */
  public async loadMarkets(): Promise<Map<Symbol, Market>> {
    try {
      // 使用 CCXT 加载市场
      await this.ccxtExchange.loadMarkets();

      // 转换为统一格式
      for (const [symbol, market] of Object.entries(this.ccxtExchange.markets)) {
        // 只处理活跃的市场
        if (!market.active) {
          continue;
        }

        // 转换市场类型
        let marketType: MarketType = 'spot';
        if (market.swap) {
          marketType = 'swap';
        } else if (market.future) {
          marketType = 'futures';
        } else if (market.option) {
          marketType = 'option';
        }

        // 创建统一的市场信息对象
        const unifiedMarket: Market = {
          symbol: symbol,
          exchangeSymbol: market.id,
          exchangeId: this.exchangeId,
          type: marketType,
          base: market.base,
          quote: market.quote,
          active: market.active,
          pricePrecision: market.precision?.price ?? 8,
          amountPrecision: market.precision?.amount ?? 8,
          minAmount: new Decimal(market.limits?.amount?.min ?? 0),
          minNotional: new Decimal(market.limits?.cost?.min ?? 0),
          contractSize: market.contractSize ? new Decimal(market.contractSize) : undefined,
          settleCurrency: market.settle,
        };

        this.markets.set(symbol, unifiedMarket);
      }

      this.logger.info({ count: this.markets.size }, 'Loaded markets');
      return this.markets;
    } catch (error) {
      this.logger.error({ error }, 'Failed to load markets');
      throw this.wrapError(error);
    }
  }

  // ==========================================================================
  // 账户操作
  // ==========================================================================

  /**
   * 获取账户信息
   */
  public async fetchAccount(type: MarketType = 'spot'): Promise<Account> {
    try {
      // 设置账户类型
      this.ccxtExchange.options['defaultType'] = type === 'spot' ? 'spot' : 'future';

      // 获取余额
      const balance = await this.ccxtExchange.fetchBalance();

      // 转换为统一格式
      const balances = new Map<string, Balance>();

      for (const [currency, data] of Object.entries(balance)) {
        // 跳过非余额字段
        if (
          typeof data !== 'object' ||
          data === null ||
          !('free' in data) ||
          !('used' in data) ||
          !('total' in data)
        ) {
          continue;
        }

        const balanceData = data as { free: number; used: number; total: number };

        // 跳过零余额
        if (balanceData.total === 0) {
          continue;
        }

        balances.set(currency, {
          currency,
          free: new Decimal(balanceData.free),
          locked: new Decimal(balanceData.used),
          total: new Decimal(balanceData.total),
        });
      }

      return {
        exchangeId: this.exchangeId,
        type,
        balances,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.logger.error({ error, type }, 'Failed to fetch account');
      throw this.wrapError(error);
    }
  }

  /**
   * 获取指定币种余额
   */
  public async fetchBalance(currency: string): Promise<Decimal> {
    const account = await this.fetchAccount();
    const balance = account.balances.get(currency);
    return balance?.free ?? new Decimal(0);
  }

  // ==========================================================================
  // 订单操作
  // ==========================================================================

  /**
   * 创建订单
   */
  public async createOrder(request: OrderRequest): Promise<Order> {
    try {
      this.logger.debug({ request }, 'Creating order');

      // 将统一订单类型转换为 CCXT 格式
      const orderType = this.toOrderType(request.type);

      // 创建订单
      const order = await this.ccxtExchange.createOrder(
        request.symbol,
        orderType,
        request.side,
        request.amount.toNumber(),
        request.price?.toNumber(),
        {
          // 客户端订单 ID
          clientOrderId: request.clientOrderId,
          // 有效期类型
          timeInForce: request.timeInForce,
          // 止损触发价格
          stopPrice: request.triggerPrice?.toNumber(),
          // 仓位方向（期货）
          positionSide: request.positionSide?.toUpperCase(),
          // 只减仓
          reduceOnly: request.reduceOnly,
        }
      );

      // 转换为统一订单格式
      const unifiedOrder = this.toUnifiedOrder(order);

      this.logger.info({ orderId: unifiedOrder.id, symbol: request.symbol }, 'Order created');

      return unifiedOrder;
    } catch (error) {
      this.logger.error({ error, request }, 'Failed to create order');
      throw this.wrapError(error);
    }
  }

  /**
   * 批量创建订单
   */
  public async createOrders(requests: OrderRequest[]): Promise<Order[]> {
    // Binance 支持批量下单，但 CCXT 不直接支持
    // 使用 Promise.all 并行创建
    const orders = await Promise.all(requests.map(request => this.createOrder(request)));
    return orders;
  }

  /**
   * 取消订单
   */
  public async cancelOrder(orderId: string, symbol: Symbol): Promise<Order> {
    try {
      this.logger.debug({ orderId, symbol }, 'Canceling order');

      const order = await this.ccxtExchange.cancelOrder(orderId, symbol);
      const unifiedOrder = this.toUnifiedOrder(order);

      this.logger.info({ orderId, symbol }, 'Order canceled');

      return unifiedOrder;
    } catch (error) {
      this.logger.error({ error, orderId, symbol }, 'Failed to cancel order');
      throw this.wrapError(error);
    }
  }

  /**
   * 批量取消订单
   */
  public async cancelOrders(orderIds: string[], symbol: Symbol): Promise<Order[]> {
    const orders = await Promise.all(orderIds.map(orderId => this.cancelOrder(orderId, symbol)));
    return orders;
  }

  /**
   * 取消所有订单
   */
  public async cancelAllOrders(symbol: Symbol): Promise<Order[]> {
    try {
      this.logger.debug({ symbol }, 'Canceling all orders');

      const orders = await this.ccxtExchange.cancelAllOrders(symbol);
      const unifiedOrders = orders.map(order => this.toUnifiedOrder(order));

      this.logger.info({ symbol, count: unifiedOrders.length }, 'All orders canceled');

      return unifiedOrders;
    } catch (error) {
      this.logger.error({ error, symbol }, 'Failed to cancel all orders');
      throw this.wrapError(error);
    }
  }

  /**
   * 查询订单
   */
  public async fetchOrder(orderId: string, symbol: Symbol): Promise<Order> {
    try {
      const order = await this.ccxtExchange.fetchOrder(orderId, symbol);
      return this.toUnifiedOrder(order);
    } catch (error) {
      this.logger.error({ error, orderId, symbol }, 'Failed to fetch order');
      throw this.wrapError(error);
    }
  }

  /**
   * 查询未完成订单
   */
  public async fetchOpenOrders(symbol?: Symbol): Promise<Order[]> {
    try {
      const orders = await this.ccxtExchange.fetchOpenOrders(symbol);
      return orders.map(order => this.toUnifiedOrder(order));
    } catch (error) {
      this.logger.error({ error, symbol }, 'Failed to fetch open orders');
      throw this.wrapError(error);
    }
  }

  /**
   * 查询历史订单
   */
  public async fetchClosedOrders(
    symbol: Symbol,
    since?: number,
    limit?: number
  ): Promise<Order[]> {
    try {
      const orders = await this.ccxtExchange.fetchClosedOrders(symbol, since, limit);
      return orders.map(order => this.toUnifiedOrder(order));
    } catch (error) {
      this.logger.error({ error, symbol }, 'Failed to fetch closed orders');
      throw this.wrapError(error);
    }
  }

  // ==========================================================================
  // 成交记录
  // ==========================================================================

  /**
   * 查询成交记录
   */
  public async fetchMyTrades(symbol: Symbol, since?: number, limit?: number): Promise<Trade[]> {
    try {
      const trades = await this.ccxtExchange.fetchMyTrades(symbol, since, limit);

      return trades.map(trade => ({
        id: trade.id,
        orderId: trade.order ?? '',
        symbol: trade.symbol,
        side: trade.side as 'buy' | 'sell',
        price: new Decimal(trade.price),
        amount: new Decimal(trade.amount),
        cost: new Decimal(trade.cost ?? 0),
        fee: new Decimal(trade.fee?.cost ?? 0),
        feeCurrency: trade.fee?.currency ?? '',
        timestamp: trade.timestamp ?? Date.now(),
        isMaker: trade.takerOrMaker === 'maker',
      }));
    } catch (error) {
      this.logger.error({ error, symbol }, 'Failed to fetch trades');
      throw this.wrapError(error);
    }
  }

  // ==========================================================================
  // 仓位操作
  // ==========================================================================

  /**
   * 获取持仓信息
   */
  public async fetchPositions(symbol?: Symbol): Promise<Position[]> {
    try {
      // 切换到期货模式
      this.ccxtExchange.options['defaultType'] = 'future';

      const positions = await this.ccxtExchange.fetchPositions(symbol ? [symbol] : undefined);

      return positions
        .filter(pos => Math.abs(pos.contracts ?? 0) > 0)
        .map(pos => ({
          symbol: pos.symbol,
          side: pos.side as 'long' | 'short' | 'both',
          amount: new Decimal(pos.contracts ?? 0),
          entryPrice: new Decimal(pos.entryPrice ?? 0),
          markPrice: new Decimal(pos.markPrice ?? 0),
          unrealizedPnl: new Decimal(pos.unrealizedPnl ?? 0),
          realizedPnl: new Decimal(0), // CCXT 不直接提供
          leverage: pos.leverage ?? 1,
          margin: new Decimal(pos.initialMargin ?? 0),
          marginRatio: new Decimal(pos.marginRatio ?? 0),
          liquidationPrice: new Decimal(pos.liquidationPrice ?? 0),
          timestamp: Date.now(),
        }));
    } catch (error) {
      this.logger.error({ error, symbol }, 'Failed to fetch positions');
      throw this.wrapError(error);
    }
  }

  /**
   * 设置杠杆倍数
   */
  public async setLeverage(symbol: Symbol, leverage: number): Promise<void> {
    try {
      this.ccxtExchange.options['defaultType'] = 'future';
      await this.ccxtExchange.setLeverage(leverage, symbol);
      this.logger.info({ symbol, leverage }, 'Leverage set');
    } catch (error) {
      this.logger.error({ error, symbol, leverage }, 'Failed to set leverage');
      throw this.wrapError(error);
    }
  }

  // ==========================================================================
  // WebSocket 订阅
  // ==========================================================================

  /**
   * 订阅订单更新
   */
  public async subscribeOrderUpdates(): Promise<void> {
    await this.ensureUserDataStream();
    this.logger.info('Subscribed to order updates');
  }

  /**
   * 取消订阅订单更新
   */
  public async unsubscribeOrderUpdates(): Promise<void> {
    // 用户数据流包含多个订阅，这里仅标记
    this.logger.info('Unsubscribed from order updates');
  }

  /**
   * 订阅余额更新
   */
  public async subscribeBalanceUpdates(): Promise<void> {
    await this.ensureUserDataStream();
    this.logger.info('Subscribed to balance updates');
  }

  /**
   * 取消订阅余额更新
   */
  public async unsubscribeBalanceUpdates(): Promise<void> {
    this.logger.info('Unsubscribed from balance updates');
  }

  /**
   * 订阅仓位更新
   */
  public async subscribePositionUpdates(): Promise<void> {
    await this.ensureUserDataStream();
    this.logger.info('Subscribed to position updates');
  }

  /**
   * 取消订阅仓位更新
   */
  public async unsubscribePositionUpdates(): Promise<void> {
    this.logger.info('Unsubscribed from position updates');
  }

  // ==========================================================================
  // 私有方法 - WebSocket
  // ==========================================================================

  /**
   * 确保用户数据流已建立
   */
  private async ensureUserDataStream(): Promise<void> {
    if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
      return;
    }

    // 获取 Listen Key
    this.listenKey = await this.getListenKey();

    // 建立 WebSocket 连接
    const wsUrl = this.config.sandbox
      ? `wss://testnet.binance.vision/ws/${this.listenKey}`
      : `wss://stream.binance.com:9443/ws/${this.listenKey}`;

    await this.connectWebSocket(wsUrl);

    // 启动 Listen Key 保活（每 30 分钟）
    this.startListenKeyKeepAlive();
  }

  /**
   * 获取 Listen Key
   */
  private async getListenKey(): Promise<string> {
    const response = (await this.ccxtExchange.publicPostUserDataStream()) as { listenKey: string };
    return response.listenKey;
  }

  /**
   * 启动 Listen Key 保活
   */
  private startListenKeyKeepAlive(): void {
    // 每 30 分钟续期一次
    this.listenKeyKeepAliveTimer = setInterval(
      async () => {
        try {
          await this.ccxtExchange.publicPutUserDataStream({ listenKey: this.listenKey });
          this.logger.debug('Listen key renewed');
        } catch (error) {
          this.logger.error({ error }, 'Failed to renew listen key');
        }
      },
      30 * 60 * 1000
    );
  }

  /**
   * 建立 WebSocket 连接
   */
  private async connectWebSocket(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wsConnection = new WebSocket(url);

      // 连接成功
      this.wsConnection.on('open', () => {
        this.reconnectAttempts = 0;
        this.logger.info('WebSocket connected');
        resolve();
      });

      // 接收消息
      this.wsConnection.on('message', (data: WebSocket.Data) => {
        this.handleWsMessage(data);
      });

      // 连接错误
      this.wsConnection.on('error', error => {
        this.logger.error({ error }, 'WebSocket error');
        this.emit('error', error);
        reject(error);
      });

      // 连接关闭
      this.wsConnection.on('close', () => {
        this.logger.warn('WebSocket disconnected');
        this.handleWsReconnect();
      });
    });
  }

  /**
   * 处理 WebSocket 消息
   */
  private handleWsMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString()) as BinanceWsMessage;

      switch (message.e) {
        // 订单更新
        case 'executionReport':
          this.handleOrderUpdate(message as BinanceOrderUpdate);
          break;

        // 余额更新
        case 'outboundAccountPosition':
          this.handleBalanceUpdate(message);
          break;

        // 仓位更新（期货）
        case 'ACCOUNT_UPDATE':
          this.handleAccountUpdate(message);
          break;

        default:
          this.logger.debug({ event: message.e }, 'Unknown WebSocket event');
      }
    } catch (error) {
      this.logger.error({ error, data: data.toString() }, 'Failed to parse WebSocket message');
    }
  }

  /**
   * 处理订单更新
   */
  private handleOrderUpdate(message: BinanceOrderUpdate): void {
    const order: Order = {
      id: message.i.toString(),
      clientOrderId: message.c,
      symbol: this.fromExchangeSymbol(message.s),
      exchangeId: this.exchangeId,
      side: message.S.toLowerCase() as 'buy' | 'sell',
      type: this.fromOrderType(message.o),
      status: this.fromOrderStatus(message.X),
      price: new Decimal(message.p),
      amount: new Decimal(message.q),
      filled: new Decimal(message.z),
      remaining: new Decimal(message.q).minus(message.z),
      avgPrice: new Decimal(message.L),
      fee: new Decimal(message.n),
      feeCurrency: message.N,
      timestamp: message.T,
      lastUpdateTime: message.E,
    };

    this.emit('orderUpdate', order);
  }

  /**
   * 处理余额更新
   */
  private handleBalanceUpdate(message: BinanceWsMessage): void {
    // 简化处理，触发重新获取账户信息
    void this.fetchAccount().then(account => {
      this.emit('balanceUpdate', account);
    });
  }

  /**
   * 处理账户更新（期货）
   */
  private handleAccountUpdate(message: BinanceWsMessage): void {
    // 处理仓位更新
    void this.fetchPositions().then(positions => {
      for (const position of positions) {
        this.emit('positionUpdate', position);
      }
    });
  }

  /**
   * 处理 WebSocket 重连
   */
  private handleWsReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error('Max reconnect attempts reached');
      this.emit('disconnected', 'Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelayBase * Math.pow(2, this.reconnectAttempts - 1);

    this.logger.info({ attempt: this.reconnectAttempts, delay }, 'Reconnecting...');
    this.emit('reconnecting', this.reconnectAttempts);

    setTimeout(() => {
      void this.ensureUserDataStream();
    }, delay);
  }

  // ==========================================================================
  // 私有方法 - 工具函数
  // ==========================================================================

  /**
   * 转换为交易所符号
   */
  protected toExchangeSymbol(symbol: Symbol): string {
    return symbol.replace('/', '');
  }

  /**
   * 从交易所符号转换
   */
  protected fromExchangeSymbol(exchangeSymbol: string): Symbol {
    // 查找市场信息
    for (const [symbol, market] of this.markets) {
      if (market.exchangeSymbol === exchangeSymbol) {
        return symbol;
      }
    }
    return exchangeSymbol;
  }

  /**
   * 转换订单类型到 CCXT 格式
   */
  private toOrderType(type: OrderRequest['type']): string {
    const mapping: Record<string, string> = {
      limit: 'limit',
      market: 'market',
      stop_limit: 'stop_loss_limit',
      stop_market: 'stop_loss',
      take_profit_limit: 'take_profit_limit',
      take_profit_market: 'take_profit',
    };
    return mapping[type] ?? type;
  }

  /**
   * 从 CCXT 格式转换订单类型
   */
  private fromOrderType(type: string): Order['type'] {
    const mapping: Record<string, Order['type']> = {
      LIMIT: 'limit',
      MARKET: 'market',
      STOP_LOSS_LIMIT: 'stop_limit',
      STOP_LOSS: 'stop_market',
      TAKE_PROFIT_LIMIT: 'take_profit_limit',
      TAKE_PROFIT: 'take_profit_market',
    };
    return mapping[type.toUpperCase()] ?? 'limit';
  }

  /**
   * 从 Binance 状态转换订单状态
   */
  private fromOrderStatus(status: string): OrderStatus {
    const mapping: Record<string, OrderStatus> = {
      NEW: 'open',
      PARTIALLY_FILLED: 'partially_filled',
      FILLED: 'filled',
      CANCELED: 'canceled',
      REJECTED: 'rejected',
      EXPIRED: 'expired',
    };
    return mapping[status.toUpperCase()] ?? 'open';
  }

  /**
   * 转换为统一订单格式
   */
  private toUnifiedOrder(order: ccxt.Order): Order {
    return {
      id: order.id,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      exchangeId: this.exchangeId,
      side: order.side as 'buy' | 'sell',
      type: this.fromOrderType(order.type),
      status: order.status as OrderStatus,
      price: new Decimal(order.price ?? 0),
      amount: new Decimal(order.amount ?? 0),
      filled: new Decimal(order.filled ?? 0),
      remaining: new Decimal(order.remaining ?? 0),
      avgPrice: new Decimal(order.average ?? 0),
      fee: new Decimal(order.fee?.cost ?? 0),
      feeCurrency: order.fee?.currency ?? '',
      timestamp: order.timestamp ?? Date.now(),
      lastUpdateTime: order.lastUpdateTimestamp ?? Date.now(),
      raw: order,
    };
  }

  /**
   * 包装错误
   */
  private wrapError(error: unknown): ExchangeError {
    if (error instanceof ExchangeError) {
      return error;
    }

    let code = ExchangeErrorCode.UNKNOWN_ERROR;
    let message = 'Unknown error';

    if (error instanceof ccxt.AuthenticationError) {
      code = ExchangeErrorCode.AUTHENTICATION_ERROR;
      message = 'Authentication failed';
    } else if (error instanceof ccxt.InsufficientFunds) {
      code = ExchangeErrorCode.INSUFFICIENT_BALANCE;
      message = 'Insufficient balance';
    } else if (error instanceof ccxt.OrderNotFound) {
      code = ExchangeErrorCode.ORDER_NOT_FOUND;
      message = 'Order not found';
    } else if (error instanceof ccxt.RateLimitExceeded) {
      code = ExchangeErrorCode.RATE_LIMIT;
      message = 'Rate limit exceeded';
    } else if (error instanceof ccxt.NetworkError) {
      code = ExchangeErrorCode.NETWORK_ERROR;
      message = 'Network error';
    } else if (error instanceof Error) {
      message = error.message;
    }

    return new ExchangeError(code, message, this.exchangeId, error);
  }
}
