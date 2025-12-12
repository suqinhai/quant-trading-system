// ============================================================================
// 行情数据引擎
// 统一管理多交易所的实时行情数据订阅
// ============================================================================

import Decimal from 'decimal.js';
import EventEmitter from 'eventemitter3';
import pino from 'pino';
import WebSocket from 'ws';

import type { ExchangeId, Symbol } from '@quant/exchange';

import { KlineManager } from './kline';
import { OrderBookManager } from './orderbook';
import {
  getSubscriptionKey,
  type Kline,
  type KlineInterval,
  type MarketDataEvents,
  type MiniTicker,
  type OrderBook,
  type OrderBookUpdate,
  type PriceLevel,
  type Subscription,
  type Tick,
  type Ticker,
} from './types';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 交易所 WebSocket 配置
 */
interface ExchangeWsConfig {
  // 交易所标识
  exchangeId: ExchangeId;

  // WebSocket URL
  url: string;

  // 是否为沙盒环境
  sandbox?: boolean;
}

/**
 * 行情引擎配置
 */
export interface MarketDataEngineConfig {
  // 日志级别
  logLevel?: string;

  // 订单簿最大缓存数量
  maxOrderBooks?: number;

  // K 线最大缓存序列数
  maxKlineSeries?: number;

  // 每个序列最大 K 线数量
  maxKlinesPerSeries?: number;

  // 重连最大次数
  maxReconnectAttempts?: number;

  // 重连延迟基数（毫秒）
  reconnectDelayBase?: number;
}

// ============================================================================
// Binance WebSocket 消息类型
// ============================================================================

interface BinanceKlineMessage {
  e: 'kline';
  E: number;
  s: string;
  k: {
    t: number; // 开盘时间
    T: number; // 收盘时间
    s: string; // 交易对
    i: string; // K 线周期
    o: string; // 开盘价
    c: string; // 收盘价
    h: string; // 最高价
    l: string; // 最低价
    v: string; // 成交量
    n: number; // 成交笔数
    x: boolean; // 是否完成
    q: string; // 成交额
    V: string; // 主动买入成交量
    Q: string; // 主动买入成交额
  };
}

interface BinanceTradeMessage {
  e: 'trade';
  E: number;
  s: string;
  t: number; // 成交 ID
  p: string; // 价格
  q: string; // 数量
  T: number; // 成交时间
  m: boolean; // 买方是否为 maker
  M: boolean; // 是否为最优撮合
}

interface BinanceDepthMessage {
  e: 'depthUpdate';
  E: number;
  s: string;
  U: number; // 首个更新 ID
  u: number; // 最后更新 ID
  b: [string, string][]; // 买盘 [价格, 数量]
  a: [string, string][]; // 卖盘 [价格, 数量]
}

interface BinanceTickerMessage {
  e: '24hrTicker';
  E: number;
  s: string;
  p: string; // 价格变化
  P: string; // 价格变化百分比
  w: string; // 加权平均价
  c: string; // 最新价
  Q: string; // 最新成交量
  o: string; // 开盘价
  h: string; // 最高价
  l: string; // 最低价
  v: string; // 成交量
  q: string; // 成交额
  O: number; // 开盘时间
  C: number; // 收盘时间
  b: string; // 最优买价
  B: string; // 最优买量
  a: string; // 最优卖价
  A: string; // 最优卖量
}

// ============================================================================
// 行情引擎实现
// ============================================================================

/**
 * 行情数据引擎
 *
 * 核心功能：
 * - 统一管理多交易所的 WebSocket 连接
 * - 订阅和取消订阅行情数据
 * - 维护订单簿和 K 线状态
 * - 自动重连机制
 * - 事件驱动的数据分发
 */
export class MarketDataEngine extends EventEmitter<MarketDataEvents> {
  // 日志记录器
  private readonly logger: pino.Logger;

  // 订单簿管理器
  private readonly orderBookManager: OrderBookManager;

  // K 线管理器
  private readonly klineManager: KlineManager;

  // WebSocket 连接映射
  private readonly connections: Map<ExchangeId, WebSocket> = new Map();

  // 当前订阅
  private readonly subscriptions: Map<string, Subscription> = new Map();

  // 重连次数
  private readonly reconnectAttempts: Map<ExchangeId, number> = new Map();

  // 配置
  private readonly config: Required<MarketDataEngineConfig>;

  // 交易所 WebSocket URL 配置
  private readonly exchangeUrls: Map<ExchangeId, ExchangeWsConfig> = new Map([
    [
      'binance',
      {
        exchangeId: 'binance',
        url: 'wss://stream.binance.com:9443/ws',
      },
    ],
    // 可以添加更多交易所
  ]);

  /**
   * 构造函数
   * @param config - 引擎配置
   */
  public constructor(config: MarketDataEngineConfig = {}) {
    super();

    // 合并默认配置
    this.config = {
      logLevel: config.logLevel ?? 'info',
      maxOrderBooks: config.maxOrderBooks ?? 1000,
      maxKlineSeries: config.maxKlineSeries ?? 500,
      maxKlinesPerSeries: config.maxKlinesPerSeries ?? 1000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      reconnectDelayBase: config.reconnectDelayBase ?? 1000,
    };

    // 初始化日志
    this.logger = pino({
      name: 'MarketDataEngine',
      level: this.config.logLevel,
    });

    // 初始化管理器
    this.orderBookManager = new OrderBookManager(this.config.maxOrderBooks);
    this.klineManager = new KlineManager(
      this.config.maxKlineSeries,
      this.config.maxKlinesPerSeries
    );

    this.logger.info('MarketDataEngine initialized');
  }

  // ==========================================================================
  // 连接管理
  // ==========================================================================

  /**
   * 连接到交易所
   */
  public async connect(exchangeId: ExchangeId): Promise<void> {
    // 如果已连接，跳过
    if (this.connections.has(exchangeId)) {
      this.logger.warn({ exchangeId }, 'Already connected');
      return;
    }

    const wsConfig = this.exchangeUrls.get(exchangeId);
    if (!wsConfig) {
      throw new Error(`Unsupported exchange: ${exchangeId}`);
    }

    return this.connectWebSocket(wsConfig);
  }

  /**
   * 建立 WebSocket 连接
   */
  private async connectWebSocket(config: ExchangeWsConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(config.url);

      ws.on('open', () => {
        this.logger.info({ exchangeId: config.exchangeId }, 'WebSocket connected');
        this.connections.set(config.exchangeId, ws);
        this.reconnectAttempts.set(config.exchangeId, 0);
        this.emit('connected', config.exchangeId);

        // 重新订阅之前的订阅
        void this.resubscribe(config.exchangeId);

        resolve();
      });

      ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(config.exchangeId, data);
      });

      ws.on('error', error => {
        this.logger.error({ exchangeId: config.exchangeId, error }, 'WebSocket error');
        this.emit('error', error);
        reject(error);
      });

      ws.on('close', () => {
        this.logger.warn({ exchangeId: config.exchangeId }, 'WebSocket disconnected');
        this.connections.delete(config.exchangeId);
        this.emit('disconnected', config.exchangeId, 'Connection closed');

        // 尝试重连
        void this.handleReconnect(config);
      });
    });
  }

  /**
   * 处理重连
   */
  private async handleReconnect(config: ExchangeWsConfig): Promise<void> {
    const attempts = (this.reconnectAttempts.get(config.exchangeId) ?? 0) + 1;

    if (attempts > this.config.maxReconnectAttempts) {
      this.logger.error(
        { exchangeId: config.exchangeId },
        'Max reconnect attempts reached'
      );
      return;
    }

    this.reconnectAttempts.set(config.exchangeId, attempts);

    // 指数退避延迟
    const delay = this.config.reconnectDelayBase * Math.pow(2, attempts - 1);

    this.logger.info(
      { exchangeId: config.exchangeId, attempt: attempts, delay },
      'Reconnecting...'
    );
    this.emit('reconnecting', config.exchangeId, attempts);

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      await this.connectWebSocket(config);
    } catch (error) {
      this.logger.error(
        { exchangeId: config.exchangeId, error },
        'Reconnect failed'
      );
    }
  }

  /**
   * 断开交易所连接
   */
  public disconnect(exchangeId: ExchangeId): void {
    const ws = this.connections.get(exchangeId);
    if (ws) {
      ws.close();
      this.connections.delete(exchangeId);
    }
  }

  /**
   * 断开所有连接
   */
  public disconnectAll(): void {
    for (const [exchangeId] of this.connections) {
      this.disconnect(exchangeId);
    }
  }

  // ==========================================================================
  // 订阅管理
  // ==========================================================================

  /**
   * 订阅行情
   */
  public async subscribe(subscription: Subscription): Promise<void> {
    const key = getSubscriptionKey(subscription);

    // 如果已订阅，跳过
    if (this.subscriptions.has(key)) {
      this.logger.debug({ subscription }, 'Already subscribed');
      return;
    }

    // 确保已连接
    if (!this.connections.has(subscription.exchangeId)) {
      await this.connect(subscription.exchangeId);
    }

    // 发送订阅请求
    await this.sendSubscribeRequest(subscription);

    // 记录订阅
    this.subscriptions.set(key, subscription);

    this.logger.info({ subscription }, 'Subscribed');
  }

  /**
   * 批量订阅
   */
  public async subscribeBatch(subscriptions: Subscription[]): Promise<void> {
    await Promise.all(subscriptions.map(sub => this.subscribe(sub)));
  }

  /**
   * 取消订阅
   */
  public async unsubscribe(subscription: Subscription): Promise<void> {
    const key = getSubscriptionKey(subscription);

    if (!this.subscriptions.has(key)) {
      return;
    }

    // 发送取消订阅请求
    await this.sendUnsubscribeRequest(subscription);

    // 移除订阅记录
    this.subscriptions.delete(key);

    this.logger.info({ subscription }, 'Unsubscribed');
  }

  /**
   * 重新订阅（重连后调用）
   */
  private async resubscribe(exchangeId: ExchangeId): Promise<void> {
    const toResubscribe = [...this.subscriptions.values()].filter(
      sub => sub.exchangeId === exchangeId
    );

    for (const sub of toResubscribe) {
      await this.sendSubscribeRequest(sub);
    }

    this.logger.info(
      { exchangeId, count: toResubscribe.length },
      'Resubscribed'
    );
  }

  /**
   * 发送订阅请求（Binance 格式）
   */
  private async sendSubscribeRequest(subscription: Subscription): Promise<void> {
    const ws = this.connections.get(subscription.exchangeId);
    if (!ws) {
      throw new Error(`Not connected to ${subscription.exchangeId}`);
    }

    // 构建 Binance 订阅消息
    const stream = this.buildBinanceStream(subscription);
    const message = {
      method: 'SUBSCRIBE',
      params: [stream],
      id: Date.now(),
    };

    ws.send(JSON.stringify(message));
  }

  /**
   * 发送取消订阅请求
   */
  private async sendUnsubscribeRequest(subscription: Subscription): Promise<void> {
    const ws = this.connections.get(subscription.exchangeId);
    if (!ws) {
      return;
    }

    const stream = this.buildBinanceStream(subscription);
    const message = {
      method: 'UNSUBSCRIBE',
      params: [stream],
      id: Date.now(),
    };

    ws.send(JSON.stringify(message));
  }

  /**
   * 构建 Binance 流名称
   */
  private buildBinanceStream(subscription: Subscription): string {
    // 将符号转换为小写并去除斜杠
    const symbol = subscription.symbol.replace('/', '').toLowerCase();

    switch (subscription.type) {
      case 'kline':
        return `${symbol}@kline_${subscription.interval ?? '1m'}`;
      case 'orderbook':
        return `${symbol}@depth${subscription.depth ?? 20}@100ms`;
      case 'trade':
        return `${symbol}@trade`;
      case 'ticker':
        return `${symbol}@ticker`;
      case 'miniTicker':
        return `${symbol}@miniTicker`;
      default:
        throw new Error(`Unsupported subscription type: ${subscription.type}`);
    }
  }

  // ==========================================================================
  // 消息处理
  // ==========================================================================

  /**
   * 处理 WebSocket 消息
   */
  private handleMessage(exchangeId: ExchangeId, data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());

      // 忽略订阅响应
      if (message.result === null || message.id) {
        return;
      }

      // 根据事件类型处理
      const eventType = message.e as string;

      switch (eventType) {
        case 'kline':
          this.handleKlineMessage(exchangeId, message as BinanceKlineMessage);
          break;
        case 'trade':
          this.handleTradeMessage(exchangeId, message as BinanceTradeMessage);
          break;
        case 'depthUpdate':
          this.handleDepthMessage(exchangeId, message as BinanceDepthMessage);
          break;
        case '24hrTicker':
          this.handleTickerMessage(exchangeId, message as BinanceTickerMessage);
          break;
        default:
          this.logger.debug({ eventType }, 'Unknown event type');
      }
    } catch (error) {
      this.logger.error({ error, data: data.toString() }, 'Failed to parse message');
    }
  }

  /**
   * 处理 K 线消息
   */
  private handleKlineMessage(exchangeId: ExchangeId, message: BinanceKlineMessage): void {
    const k = message.k;
    const symbol = this.formatSymbol(message.s);

    const kline: Kline = {
      symbol,
      exchangeId,
      interval: k.i as KlineInterval,
      openTime: k.t,
      closeTime: k.T,
      open: new Decimal(k.o),
      high: new Decimal(k.h),
      low: new Decimal(k.l),
      close: new Decimal(k.c),
      volume: new Decimal(k.v),
      quoteVolume: new Decimal(k.q),
      trades: k.n,
      takerBuyVolume: new Decimal(k.V),
      takerBuyQuoteVolume: new Decimal(k.Q),
      isFinal: k.x,
    };

    // 更新 K 线管理器
    this.klineManager.update(kline);

    // 发出事件
    this.emit('kline', kline);
  }

  /**
   * 处理成交消息
   */
  private handleTradeMessage(exchangeId: ExchangeId, message: BinanceTradeMessage): void {
    const symbol = this.formatSymbol(message.s);
    const price = new Decimal(message.p);
    const amount = new Decimal(message.q);

    const trade: Tick = {
      symbol,
      exchangeId,
      id: message.t.toString(),
      price,
      amount,
      cost: price.times(amount),
      timestamp: message.T,
      isBuyerMaker: message.m,
      isBestMatch: message.M,
    };

    this.emit('trade', trade);
  }

  /**
   * 处理订单簿消息
   */
  private handleDepthMessage(exchangeId: ExchangeId, message: BinanceDepthMessage): void {
    const symbol = this.formatSymbol(message.s);

    const update: OrderBookUpdate = {
      symbol,
      exchangeId,
      type: 'delta',
      bids: message.b.map(
        ([price, amount]): PriceLevel => ({
          price: new Decimal(price),
          amount: new Decimal(amount),
        })
      ),
      asks: message.a.map(
        ([price, amount]): PriceLevel => ({
          price: new Decimal(price),
          amount: new Decimal(amount),
        })
      ),
      timestamp: message.E,
      firstUpdateId: message.U,
      lastUpdateId: message.u,
    };

    // 更新订单簿管理器
    const orderBook = this.orderBookManager.handleUpdate(update);

    // 发出事件
    this.emit('orderbookUpdate', update);
    this.emit('orderbook', orderBook);
  }

  /**
   * 处理 Ticker 消息
   */
  private handleTickerMessage(exchangeId: ExchangeId, message: BinanceTickerMessage): void {
    const symbol = this.formatSymbol(message.s);

    const ticker: Ticker = {
      symbol,
      exchangeId,
      last: new Decimal(message.c),
      high: new Decimal(message.h),
      low: new Decimal(message.l),
      open: new Decimal(message.o),
      close: new Decimal(message.c),
      volume: new Decimal(message.v),
      quoteVolume: new Decimal(message.q),
      change: new Decimal(message.p),
      changePercent: new Decimal(message.P),
      vwap: new Decimal(message.w),
      bid: new Decimal(message.b),
      bidVolume: new Decimal(message.B),
      ask: new Decimal(message.a),
      askVolume: new Decimal(message.A),
      timestamp: message.E,
    };

    this.emit('ticker', ticker);
  }

  /**
   * 格式化交易对符号
   * 将 BTCUSDT 转换为 BTC/USDT
   */
  private formatSymbol(rawSymbol: string): Symbol {
    // 常见的报价货币
    const quoteAssets = ['USDT', 'BUSD', 'BTC', 'ETH', 'BNB', 'USDC'];

    for (const quote of quoteAssets) {
      if (rawSymbol.endsWith(quote)) {
        const base = rawSymbol.slice(0, -quote.length);
        return `${base}/${quote}`;
      }
    }

    return rawSymbol;
  }

  // ==========================================================================
  // 数据访问
  // ==========================================================================

  /**
   * 获取订单簿
   */
  public getOrderBook(symbol: Symbol, exchangeId: ExchangeId): OrderBook | undefined {
    return this.orderBookManager.get(symbol, exchangeId);
  }

  /**
   * 获取最新 K 线
   */
  public getLatestKline(
    symbol: Symbol,
    exchangeId: ExchangeId,
    interval: KlineInterval
  ): Kline | null {
    return this.klineManager.getLatest(symbol, exchangeId, interval);
  }

  /**
   * 获取最近 N 根 K 线
   */
  public getKlines(
    symbol: Symbol,
    exchangeId: ExchangeId,
    interval: KlineInterval,
    count: number
  ): Kline[] {
    return this.klineManager.getLast(symbol, exchangeId, interval, count);
  }

  /**
   * 获取订单簿管理器（用于高级操作）
   */
  public getOrderBookManager(): OrderBookManager {
    return this.orderBookManager;
  }

  /**
   * 获取 K 线管理器（用于高级操作）
   */
  public getKlineManager(): KlineManager {
    return this.klineManager;
  }
}
