// ============================================================================
// BaseExchange 抽象基类
// 提供统一的交易所接口，封装 REST API 和 WebSocket 连接
// 包含自动签名、限频控制、指数退避重连等功能
// ============================================================================

import ccxt from 'ccxt';
import type { Exchange as CCXTExchange } from 'ccxt';
import { EventEmitter } from 'eventemitter3';
import WebSocket from 'ws';

import {
  // 类型导入
  type ExchangeConfig,
  type CreateOrderRequest,
  type OrderResult,
  type Position,
  type Balance,
  type FundingRate,
  type Kline,
  type Ticker,
  type OrderBook,
  type Trade,
  type Market,
  type WsMessage,
  type WsMessageType,
  type Timeframe,
  type ExchangeError,
  type ExchangeErrorType,
  // Schema 导入用于验证
  ExchangeConfigSchema,
  OrderResultSchema,
  PositionSchema,
  BalanceSchema,
  FundingRateSchema,
  KlineSchema,
  TickerSchema,
  OrderBookSchema,
  TradeSchema,
  MarketSchema,
  validate,
} from './schemas.js';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 交易所事件类型
 * 用于 EventEmitter 的类型安全
 */
export interface ExchangeEvents {
  // 连接相关事件
  connected: () => void;                              // WebSocket 连接成功
  disconnected: (reason: string) => void;             // WebSocket 断开连接
  reconnecting: (attempt: number) => void;            // 正在重连
  reconnected: () => void;                            // 重连成功

  // 市场数据事件
  ticker: (ticker: Ticker) => void;                   // 行情更新
  orderbook: (orderbook: OrderBook) => void;          // 订单簿更新
  trade: (trade: Trade) => void;                      // 成交更新
  kline: (kline: Kline & { symbol: string }) => void; // K线更新

  // 账户事件（私有）
  order: (order: OrderResult) => void;                // 订单更新
  position: (position: Position) => void;             // 持仓更新
  balance: (balance: Balance) => void;                // 余额更新

  // 错误事件
  error: (error: ExchangeError) => void;              // 错误发生
}

/**
 * 限频器配置
 */
interface RateLimiterConfig {
  // 每个时间窗口内允许的最大请求数
  maxRequests: number;
  // 时间窗口长度（毫秒）
  windowMs: number;
  // 429 错误后的基础等待时间（毫秒）
  retryBaseDelay: number;
  // 最大重试次数
  maxRetries: number;
}

/**
 * WebSocket 订阅信息
 */
interface WsSubscription {
  // 订阅频道名
  channel: string;
  // 交易对（如适用）
  symbol?: string;
  // 订阅参数
  params?: Record<string, unknown>;
  // 是否为私有频道
  isPrivate: boolean;
}

// ============================================================================
// 自定义错误类
// ============================================================================

/**
 * 交易所错误类
 * 封装所有交易所相关错误，提供统一的错误处理
 */
export class ExchangeException extends Error {
  // 错误类型
  public readonly type: ExchangeErrorType;

  // 交易所原始错误码
  public readonly code?: string;

  // 交易所原始错误消息
  public readonly originalMessage?: string;

  // 相关交易对
  public readonly symbol?: string;

  // 相关订单 ID
  public readonly orderId?: string;

  // 是否可重试
  public readonly retryable: boolean;

  // 建议等待时间（毫秒）
  public readonly retryAfter?: number;

  /**
   * 构造函数
   * @param type - 错误类型
   * @param message - 错误消息
   * @param options - 附加选项
   */
  constructor(
    type: ExchangeErrorType,
    message: string,
    options: {
      code?: string;
      originalMessage?: string;
      symbol?: string;
      orderId?: string;
      retryable?: boolean;
      retryAfter?: number;
    } = {}
  ) {
    // 调用父类构造函数
    super(message);

    // 设置错误名称为类名
    this.name = 'ExchangeException';

    // 设置错误属性
    this.type = type;
    this.code = options.code;
    this.originalMessage = options.originalMessage;
    this.symbol = options.symbol;
    this.orderId = options.orderId;
    this.retryable = options.retryable ?? false;
    this.retryAfter = options.retryAfter;

    // 确保正确的原型链（TypeScript 需要）
    Object.setPrototypeOf(this, ExchangeException.prototype);
  }

  /**
   * 转换为 ExchangeError 对象
   */
  toError(): ExchangeError {
    return {
      type: this.type,
      message: this.message,
      code: this.code,
      originalMessage: this.originalMessage,
      symbol: this.symbol,
      orderId: this.orderId,
      retryable: this.retryable,
      retryAfter: this.retryAfter,
    };
  }
}

// ============================================================================
// 限频器类
// ============================================================================

/**
 * 限频器
 * 实现令牌桶算法，控制 API 请求频率
 * 处理 429 错误并实现指数退避重试
 */
class RateLimiter {
  // 配置
  private readonly config: RateLimiterConfig;

  // 当前窗口内的请求数
  private requestCount: number = 0;

  // 当前窗口开始时间
  private windowStart: number = Date.now();

  // 请求队列
  private queue: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];

  // 是否正在处理队列
  private processing: boolean = false;

  // 当前退避等待时间
  private backoffDelay: number = 0;

  // 连续 429 错误次数
  private consecutive429Count: number = 0;

  /**
   * 构造函数
   * @param config - 限频器配置
   */
  constructor(config: Partial<RateLimiterConfig> = {}) {
    // 合并默认配置
    this.config = {
      maxRequests: 10,        // 每窗口最大 10 个请求
      windowMs: 1000,         // 1 秒窗口
      retryBaseDelay: 1000,   // 基础重试延迟 1 秒
      maxRetries: 5,          // 最大重试 5 次
      ...config,
    };
  }

  /**
   * 获取发送请求的许可
   * 如果超过限制，会等待直到有可用配额
   */
  async acquire(): Promise<void> {
    // 如果正在退避等待，直接加入队列
    if (this.backoffDelay > 0) {
      return this.enqueue();
    }

    // 检查当前窗口
    const now = Date.now();

    // 如果当前窗口已过期，重置计数
    if (now - this.windowStart >= this.config.windowMs) {
      this.windowStart = now;
      this.requestCount = 0;
    }

    // 如果还有配额，直接通过
    if (this.requestCount < this.config.maxRequests) {
      this.requestCount++;
      return;
    }

    // 配额已满，加入队列等待
    return this.enqueue();
  }

  /**
   * 将请求加入等待队列
   */
  private enqueue(): Promise<void> {
    return new Promise((resolve, reject) => {
      // 加入队列
      this.queue.push({ resolve, reject });

      // 启动队列处理
      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  /**
   * 处理等待队列
   */
  private async processQueue(): Promise<void> {
    // 标记正在处理
    this.processing = true;

    // 循环处理队列直到为空
    while (this.queue.length > 0) {
      // 如果有退避延迟，先等待
      if (this.backoffDelay > 0) {
        await this.sleep(this.backoffDelay);
        this.backoffDelay = 0;
      }

      // 检查当前窗口
      const now = Date.now();

      // 如果窗口已过期，重置
      if (now - this.windowStart >= this.config.windowMs) {
        this.windowStart = now;
        this.requestCount = 0;
      }

      // 如果有配额，处理队列中的请求
      while (this.requestCount < this.config.maxRequests && this.queue.length > 0) {
        const request = this.queue.shift();
        if (request) {
          this.requestCount++;
          request.resolve();
        }
      }

      // 如果队列还有请求但没有配额，等待到下一个窗口
      if (this.queue.length > 0) {
        const waitTime = this.config.windowMs - (Date.now() - this.windowStart);
        if (waitTime > 0) {
          await this.sleep(waitTime);
        }
      }
    }

    // 标记处理完成
    this.processing = false;
  }

  /**
   * 报告 429 错误，触发指数退避
   */
  report429(): void {
    // 增加连续 429 计数
    this.consecutive429Count++;

    // 计算指数退避时间
    // 公式：baseDelay * 2^(retryCount - 1) + 随机抖动
    const exponentialDelay =
      this.config.retryBaseDelay * Math.pow(2, this.consecutive429Count - 1);

    // 添加随机抖动（0-500ms）避免雷群效应
    const jitter = Math.random() * 500;

    // 设置退避延迟，但不超过 60 秒
    this.backoffDelay = Math.min(exponentialDelay + jitter, 60000);
  }

  /**
   * 报告请求成功，重置 429 计数
   */
  reportSuccess(): void {
    // 重置连续 429 计数
    this.consecutive429Count = 0;
  }

  /**
   * 检查是否超过最大重试次数
   */
  isMaxRetriesExceeded(): boolean {
    return this.consecutive429Count >= this.config.maxRetries;
  }

  /**
   * 获取当前退避延迟
   */
  getBackoffDelay(): number {
    return this.backoffDelay;
  }

  /**
   * 睡眠指定时间
   * @param ms - 毫秒数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// BaseExchange 抽象基类
// ============================================================================

/**
 * 交易所抽象基类
 *
 * 功能：
 * - 自动签名 + REST API 统一封装
 * - WebSocket 实时数据订阅
 * - 自动重连 + 429 限频处理 + 指数退避
 * - 所有方法返回 Zod 验证过的类型
 *
 * 子类需要实现：
 * - 各交易所特定的数据格式转换
 * - WebSocket 消息解析
 * - 特定 API 端点调用
 */
export abstract class BaseExchange extends EventEmitter<ExchangeEvents> {
  // ========================================================================
  // 属性定义
  // ========================================================================

  // 交易所名称（子类必须设置）
  protected abstract readonly exchangeName: string;

  // CCXT 交易所实例（用于 REST API）
  protected ccxt: CCXTExchange | null = null;

  // 配置
  protected readonly config: ExchangeConfig;

  // 限频器
  protected readonly rateLimiter: RateLimiter;

  // 市场信息缓存
  protected markets: Map<string, Market> = new Map();

  // 市场信息加载状态
  protected marketsLoaded: boolean = false;

  // ========================================================================
  // WebSocket 相关属性
  // ========================================================================

  // 公共 WebSocket 连接
  protected wsPublic: WebSocket | null = null;

  // 私有 WebSocket 连接
  protected wsPrivate: WebSocket | null = null;

  // WebSocket 连接状态
  protected wsConnected: boolean = false;

  // 当前订阅列表
  protected subscriptions: Map<string, WsSubscription> = new Map();

  // 重连尝试次数
  protected reconnectAttempts: number = 0;

  // 重连定时器
  protected reconnectTimer: NodeJS.Timeout | null = null;

  // 心跳定时器
  protected pingTimer: NodeJS.Timeout | null = null;

  // 最后收到消息的时间
  protected lastMessageTime: number = 0;

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param config - 交易所配置
   */
  constructor(config: ExchangeConfig) {
    // 初始化 EventEmitter
    super();

    // 验证配置
    this.config = validate(ExchangeConfigSchema, config);

    // 初始化限频器
    this.rateLimiter = new RateLimiter({
      maxRequests: 10,
      windowMs: 1000,
      retryBaseDelay: 1000,
      maxRetries: 5,
    });
  }

  // ========================================================================
  // 抽象方法（子类必须实现）
  // ========================================================================

  /**
   * 获取公共 WebSocket URL
   */
  protected abstract getPublicWsUrl(): string;

  /**
   * 获取私有 WebSocket URL
   */
  protected abstract getPrivateWsUrl(): string;

  /**
   * 生成 WebSocket 认证消息
   * 用于私有频道的身份验证
   */
  protected abstract generateWsAuthMessage(): Record<string, unknown>;

  /**
   * 生成订阅消息
   * @param subscription - 订阅信息
   */
  protected abstract generateSubscribeMessage(
    subscription: WsSubscription
  ): Record<string, unknown>;

  /**
   * 生成取消订阅消息
   * @param subscription - 订阅信息
   */
  protected abstract generateUnsubscribeMessage(
    subscription: WsSubscription
  ): Record<string, unknown>;

  /**
   * 解析 WebSocket 消息
   * @param data - 原始消息数据
   * @returns 解析后的消息，如果消息无效则返回 null
   */
  protected abstract parseWsMessage(data: string): WsMessage | null;

  /**
   * 转换订单结果为统一格式
   * @param rawOrder - 交易所原始订单数据
   */
  protected abstract transformOrder(rawOrder: unknown): OrderResult;

  /**
   * 转换持仓信息为统一格式
   * @param rawPosition - 交易所原始持仓数据
   */
  protected abstract transformPosition(rawPosition: unknown): Position;

  /**
   * 转换余额信息为统一格式
   * @param rawBalance - 交易所原始余额数据
   */
  protected abstract transformBalance(rawBalance: unknown): Balance;

  /**
   * 转换资金费率为统一格式
   * @param rawFundingRate - 交易所原始资金费率数据
   */
  protected abstract transformFundingRate(rawFundingRate: unknown): FundingRate;

  // ========================================================================
  // 初始化和连接方法
  // ========================================================================

  /**
   * 初始化 CCXT 交易所实例
   * 由子类调用，传入正确的交易所类
   * @param ExchangeClass - CCXT 交易所类
   */
  protected initializeCcxt(
    ExchangeClass: new (config: ccxt.ExchangeConfig) => CCXTExchange
  ): void {
    // 创建 CCXT 实例，配置自动签名和限速
    this.ccxt = new ExchangeClass({
      // API 密钥配置
      apiKey: this.config.apiKey,
      secret: this.config.apiSecret,
      password: this.config.passphrase, // OKX 需要

      // 启用自动限速
      enableRateLimit: this.config.enableRateLimit,

      // 请求超时设置
      timeout: this.config.timeout,

      // 代理设置（如需要）
      // proxy: this.config.proxy,

      // 测试网/沙盒设置
      sandbox: this.config.testnet || this.config.sandbox,

      // 自定义请求头
      headers: this.config.headers,

      // 通用选项
      options: {
        // 永续合约类型
        defaultType: 'swap',
        // 调整时间戳（解决时钟不同步问题）
        adjustForTimeDifference: true,
        // 收到无效 nonce 时自动重试
        recvWindow: 60000,
      },
    });
  }

  /**
   * 加载市场信息
   * 获取所有交易对的详细信息
   */
  async loadMarkets(): Promise<void> {
    // 确保 CCXT 已初始化
    if (!this.ccxt) {
      throw new ExchangeException(
        'UNKNOWN_ERROR',
        'Exchange not initialized'
      );
    }

    // 获取请求许可（限频）
    await this.rateLimiter.acquire();

    try {
      // 调用 CCXT 加载市场
      const markets = await this.ccxt.loadMarkets();

      // 转换并缓存市场信息
      for (const [symbol, market] of Object.entries(markets)) {
        try {
          // 转换为统一格式
          const transformedMarket = this.transformMarket(market);

          // 验证并缓存
          const validatedMarket = validate(MarketSchema, transformedMarket);
          this.markets.set(symbol, validatedMarket);
        } catch {
          // 跳过无法解析的市场
          console.warn(`Failed to parse market: ${symbol}`);
        }
      }

      // 标记加载完成
      this.marketsLoaded = true;

      // 报告成功（重置 429 计数）
      this.rateLimiter.reportSuccess();
    } catch (error) {
      // 处理错误
      this.handleApiError(error);
    }
  }

  /**
   * 转换市场信息为统一格式
   * @param market - CCXT 市场对象
   */
  protected transformMarket(market: ccxt.Market): Market {
    return {
      id: market.id,
      symbol: market.symbol,
      base: market.base,
      quote: market.quote,
      settle: market.settle,
      swap: market.swap ?? false,
      future: market.future ?? false,
      option: market.option ?? false,
      spot: market.spot ?? false,
      active: market.active ?? true,
      contractSize: market.contractSize,
      pricePrecision: market.precision?.price ?? 8,
      amountPrecision: market.precision?.amount ?? 8,
      tickSize: market.precision?.price
        ? Math.pow(10, -market.precision.price)
        : 0.01,
      lotSize: market.precision?.amount
        ? Math.pow(10, -market.precision.amount)
        : 0.001,
      minAmount: market.limits?.amount?.min ?? 0,
      maxAmount: market.limits?.amount?.max,
      minCost: market.limits?.cost?.min,
      makerFee: market.maker,
      takerFee: market.taker,
      info: market.info,
    };
  }

  // ========================================================================
  // WebSocket 连接管理
  // ========================================================================

  /**
   * 连接公共 WebSocket
   * 用于订阅公共市场数据（行情、订单簿等）
   */
  async connectPublicWs(): Promise<void> {
    // 获取 WebSocket URL
    const url = this.getPublicWsUrl();

    // 创建连接
    this.wsPublic = new WebSocket(url);

    // 设置事件处理器
    this.setupWsEventHandlers(this.wsPublic, false);

    // 等待连接成功
    await this.waitForWsConnection(this.wsPublic);
  }

  /**
   * 连接私有 WebSocket
   * 用于订阅私有账户数据（订单、持仓、余额）
   */
  async connectPrivateWs(): Promise<void> {
    // 获取 WebSocket URL
    const url = this.getPrivateWsUrl();

    // 创建连接
    this.wsPrivate = new WebSocket(url);

    // 设置事件处理器
    this.setupWsEventHandlers(this.wsPrivate, true);

    // 等待连接成功
    await this.waitForWsConnection(this.wsPrivate);

    // 发送认证消息
    const authMessage = this.generateWsAuthMessage();
    this.sendWsMessage(this.wsPrivate, authMessage);
  }

  /**
   * 设置 WebSocket 事件处理器
   * @param ws - WebSocket 实例
   * @param isPrivate - 是否为私有连接
   */
  protected setupWsEventHandlers(ws: WebSocket, isPrivate: boolean): void {
    // 连接成功事件
    ws.on('open', () => {
      // 更新连接状态
      this.wsConnected = true;
      this.reconnectAttempts = 0;

      // 发出连接成功事件
      this.emit('connected');

      // 启动心跳
      this.startPingInterval(ws);

      // 如果是重连，重新订阅
      if (this.subscriptions.size > 0) {
        this.resubscribeAll();
      }
    });

    // 收到消息事件
    ws.on('message', (data: Buffer | string) => {
      // 更新最后消息时间
      this.lastMessageTime = Date.now();

      // 解析消息
      const message = this.parseWsMessage(data.toString());

      // 如果消息有效，分发处理
      if (message) {
        this.handleWsMessage(message);
      }
    });

    // 连接关闭事件
    ws.on('close', (code: number, reason: Buffer) => {
      // 更新连接状态
      this.wsConnected = false;

      // 停止心跳
      this.stopPingInterval();

      // 发出断开连接事件
      this.emit('disconnected', reason.toString() || `Code: ${code}`);

      // 如果启用自动重连，尝试重连
      if (this.config.wsAutoReconnect) {
        this.scheduleReconnect(isPrivate);
      }
    });

    // 错误事件
    ws.on('error', (error: Error) => {
      // 创建错误对象
      const exchangeError: ExchangeError = {
        type: 'WEBSOCKET_ERROR',
        message: error.message,
        retryable: true,
      };

      // 发出错误事件
      this.emit('error', exchangeError);
    });

    // Pong 响应事件
    ws.on('pong', () => {
      // 更新最后消息时间
      this.lastMessageTime = Date.now();
    });
  }

  /**
   * 等待 WebSocket 连接成功
   * @param ws - WebSocket 实例
   * @param timeout - 超时时间（毫秒）
   */
  protected waitForWsConnection(ws: WebSocket, timeout: number = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      // 设置超时定时器
      const timer = setTimeout(() => {
        reject(new ExchangeException(
          'WEBSOCKET_ERROR',
          'WebSocket connection timeout'
        ));
      }, timeout);

      // 监听连接成功
      ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });

      // 监听连接错误
      ws.once('error', (error: Error) => {
        clearTimeout(timer);
        reject(new ExchangeException(
          'WEBSOCKET_ERROR',
          `WebSocket connection failed: ${error.message}`
        ));
      });
    });
  }

  /**
   * 安排重连
   * 使用指数退避算法计算重连延迟
   * @param isPrivate - 是否为私有连接
   */
  protected scheduleReconnect(isPrivate: boolean): void {
    // 检查是否超过最大重试次数
    if (this.reconnectAttempts >= (this.config.wsReconnectMaxRetries ?? 10)) {
      const error: ExchangeError = {
        type: 'WEBSOCKET_ERROR',
        message: 'Max reconnection attempts exceeded',
        retryable: false,
      };
      this.emit('error', error);
      return;
    }

    // 增加重连次数
    this.reconnectAttempts++;

    // 发出重连事件
    this.emit('reconnecting', this.reconnectAttempts);

    // 计算指数退避延迟
    // 公式：min(baseDelay * 2^attempts, maxDelay) + 随机抖动
    const baseDelay = this.config.wsReconnectBaseDelay ?? 1000;
    const maxDelay = this.config.wsReconnectMaxDelay ?? 30000;

    // 指数部分
    const exponentialDelay = Math.min(
      baseDelay * Math.pow(2, this.reconnectAttempts - 1),
      maxDelay
    );

    // 添加随机抖动（0-1000ms）
    const jitter = Math.random() * 1000;

    // 最终延迟
    const delay = exponentialDelay + jitter;

    // 清除之前的重连定时器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    // 设置新的重连定时器
    this.reconnectTimer = setTimeout(async () => {
      try {
        // 尝试重连
        if (isPrivate) {
          await this.connectPrivateWs();
        } else {
          await this.connectPublicWs();
        }

        // 发出重连成功事件
        this.emit('reconnected');
      } catch {
        // 重连失败，继续尝试
        this.scheduleReconnect(isPrivate);
      }
    }, delay);
  }

  /**
   * 启动心跳定时器
   * 定期发送 ping 消息保持连接活跃
   * @param ws - WebSocket 实例
   */
  protected startPingInterval(ws: WebSocket): void {
    // 每 30 秒发送一次 ping
    this.pingTimer = setInterval(() => {
      // 检查连接状态
      if (ws.readyState === WebSocket.OPEN) {
        // 发送 ping
        ws.ping();

        // 检查是否超时（60 秒没有收到消息）
        if (Date.now() - this.lastMessageTime > 60000) {
          // 可能连接已死，关闭重连
          ws.close(4000, 'No message received for 60 seconds');
        }
      }
    }, 30000);
  }

  /**
   * 停止心跳定时器
   */
  protected stopPingInterval(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * 发送 WebSocket 消息
   * @param ws - WebSocket 实例
   * @param message - 消息对象
   */
  protected sendWsMessage(ws: WebSocket | null, message: Record<string, unknown>): void {
    // 检查连接状态
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new ExchangeException(
        'WEBSOCKET_ERROR',
        'WebSocket is not connected'
      );
    }

    // 序列化并发送
    ws.send(JSON.stringify(message));
  }

  /**
   * 处理 WebSocket 消息
   * 根据消息类型分发到对应的处理器
   * @param message - 解析后的消息
   */
  protected handleWsMessage(message: WsMessage): void {
    // 根据消息类型分发
    switch (message.type) {
      case 'ticker':
        // 验证并发出行情事件
        try {
          const ticker = validate(TickerSchema, message.data);
          this.emit('ticker', ticker);
        } catch { /* 忽略无效消息 */ }
        break;

      case 'orderbook':
        // 验证并发出订单簿事件
        try {
          const orderbook = validate(OrderBookSchema, message.data);
          this.emit('orderbook', orderbook);
        } catch { /* 忽略无效消息 */ }
        break;

      case 'trade':
        // 验证并发出成交事件
        try {
          const trade = validate(TradeSchema, message.data);
          this.emit('trade', trade);
        } catch { /* 忽略无效消息 */ }
        break;

      case 'kline':
        // 验证并发出 K线事件
        try {
          const klineData = message.data as { symbol: string } & Kline;
          this.emit('kline', klineData);
        } catch { /* 忽略无效消息 */ }
        break;

      case 'order':
        // 验证并发出订单事件
        try {
          const order = validate(OrderResultSchema, message.data);
          this.emit('order', order);
        } catch { /* 忽略无效消息 */ }
        break;

      case 'position':
        // 验证并发出持仓事件
        try {
          const position = validate(PositionSchema, message.data);
          this.emit('position', position);
        } catch { /* 忽略无效消息 */ }
        break;

      case 'balance':
        // 验证并发出余额事件
        try {
          const balance = validate(BalanceSchema, message.data);
          this.emit('balance', balance);
        } catch { /* 忽略无效消息 */ }
        break;

      case 'error':
        // 发出错误事件
        const error: ExchangeError = {
          type: 'EXCHANGE_ERROR',
          message: String(message.data),
        };
        this.emit('error', error);
        break;

      default:
        // 其他消息类型暂不处理
        break;
    }
  }

  // ========================================================================
  // 订阅管理
  // ========================================================================

  /**
   * 订阅行情数据
   * @param symbol - 交易对符号
   */
  async subscribeTicker(symbol: string): Promise<void> {
    // 创建订阅信息
    const subscription: WsSubscription = {
      channel: 'ticker',
      symbol,
      isPrivate: false,
    };

    // 执行订阅
    await this.subscribe(subscription);
  }

  /**
   * 订阅订单簿数据
   * @param symbol - 交易对符号
   * @param depth - 深度（可选）
   */
  async subscribeOrderBook(symbol: string, depth?: number): Promise<void> {
    // 创建订阅信息
    const subscription: WsSubscription = {
      channel: 'orderbook',
      symbol,
      params: depth ? { depth } : undefined,
      isPrivate: false,
    };

    // 执行订阅
    await this.subscribe(subscription);
  }

  /**
   * 订阅成交数据
   * @param symbol - 交易对符号
   */
  async subscribeTrades(symbol: string): Promise<void> {
    // 创建订阅信息
    const subscription: WsSubscription = {
      channel: 'trade',
      symbol,
      isPrivate: false,
    };

    // 执行订阅
    await this.subscribe(subscription);
  }

  /**
   * 订阅 K线数据
   * @param symbol - 交易对符号
   * @param timeframe - 时间周期
   */
  async subscribeKline(symbol: string, timeframe: Timeframe): Promise<void> {
    // 创建订阅信息
    const subscription: WsSubscription = {
      channel: 'kline',
      symbol,
      params: { timeframe },
      isPrivate: false,
    };

    // 执行订阅
    await this.subscribe(subscription);
  }

  /**
   * 订阅订单更新
   */
  async subscribeOrders(): Promise<void> {
    // 创建订阅信息
    const subscription: WsSubscription = {
      channel: 'orders',
      isPrivate: true,
    };

    // 执行订阅
    await this.subscribe(subscription);
  }

  /**
   * 订阅持仓更新
   */
  async subscribePositions(): Promise<void> {
    // 创建订阅信息
    const subscription: WsSubscription = {
      channel: 'positions',
      isPrivate: true,
    };

    // 执行订阅
    await this.subscribe(subscription);
  }

  /**
   * 订阅余额更新
   */
  async subscribeBalance(): Promise<void> {
    // 创建订阅信息
    const subscription: WsSubscription = {
      channel: 'balance',
      isPrivate: true,
    };

    // 执行订阅
    await this.subscribe(subscription);
  }

  /**
   * 执行订阅
   * @param subscription - 订阅信息
   */
  protected async subscribe(subscription: WsSubscription): Promise<void> {
    // 生成订阅 key
    const key = this.getSubscriptionKey(subscription);

    // 检查是否已订阅
    if (this.subscriptions.has(key)) {
      return;
    }

    // 确保对应的 WebSocket 已连接
    if (subscription.isPrivate) {
      if (!this.wsPrivate || this.wsPrivate.readyState !== WebSocket.OPEN) {
        await this.connectPrivateWs();
      }
    } else {
      if (!this.wsPublic || this.wsPublic.readyState !== WebSocket.OPEN) {
        await this.connectPublicWs();
      }
    }

    // 生成订阅消息
    const message = this.generateSubscribeMessage(subscription);

    // 发送订阅消息
    const ws = subscription.isPrivate ? this.wsPrivate : this.wsPublic;
    this.sendWsMessage(ws, message);

    // 保存订阅信息
    this.subscriptions.set(key, subscription);
  }

  /**
   * 取消订阅
   * @param subscription - 订阅信息
   */
  protected async unsubscribe(subscription: WsSubscription): Promise<void> {
    // 生成订阅 key
    const key = this.getSubscriptionKey(subscription);

    // 检查是否已订阅
    if (!this.subscriptions.has(key)) {
      return;
    }

    // 生成取消订阅消息
    const message = this.generateUnsubscribeMessage(subscription);

    // 发送取消订阅消息
    const ws = subscription.isPrivate ? this.wsPrivate : this.wsPublic;
    if (ws && ws.readyState === WebSocket.OPEN) {
      this.sendWsMessage(ws, message);
    }

    // 移除订阅信息
    this.subscriptions.delete(key);
  }

  /**
   * 重新订阅所有频道
   * 用于重连后恢复订阅
   */
  protected async resubscribeAll(): Promise<void> {
    // 遍历所有订阅
    for (const subscription of this.subscriptions.values()) {
      // 生成订阅消息
      const message = this.generateSubscribeMessage(subscription);

      // 发送订阅消息
      const ws = subscription.isPrivate ? this.wsPrivate : this.wsPublic;
      if (ws && ws.readyState === WebSocket.OPEN) {
        this.sendWsMessage(ws, message);
      }
    }
  }

  /**
   * 生成订阅 key
   * @param subscription - 订阅信息
   */
  protected getSubscriptionKey(subscription: WsSubscription): string {
    // 组合频道、交易对和参数生成唯一 key
    const parts = [subscription.channel];

    if (subscription.symbol) {
      parts.push(subscription.symbol);
    }

    if (subscription.params) {
      parts.push(JSON.stringify(subscription.params));
    }

    return parts.join(':');
  }

  // ========================================================================
  // REST API 方法
  // ========================================================================

  /**
   * 创建订单
   * @param request - 订单请求
   * @returns 订单结果（Zod 验证过）
   */
  async createOrder(request: CreateOrderRequest): Promise<OrderResult> {
    // 确保 CCXT 已初始化
    if (!this.ccxt) {
      throw new ExchangeException('UNKNOWN_ERROR', 'Exchange not initialized');
    }

    // 获取限频许可
    await this.rateLimiter.acquire();

    try {
      // 构建 CCXT 订单参数
      const params: Record<string, unknown> = {};

      // 设置触发价格（止损/止盈单）
      if (request.triggerPrice) {
        params.triggerPrice = request.triggerPrice;
        params.stopPrice = request.triggerPrice;
      }

      // 设置止损价格
      if (request.stopLoss) {
        params.stopLoss = {
          triggerPrice: request.stopLoss,
          type: 'market',
        };
      }

      // 设置止盈价格
      if (request.takeProfit) {
        params.takeProfit = {
          triggerPrice: request.takeProfit,
          type: 'market',
        };
      }

      // 设置只做 Maker
      if (request.postOnly) {
        params.postOnly = true;
      }

      // 设置减仓模式
      if (request.reduceOnly) {
        params.reduceOnly = true;
      }

      // 设置持仓方向（双向持仓模式）
      if (request.positionSide) {
        params.positionSide = request.positionSide;
      }

      // 设置客户端订单 ID
      if (request.clientOrderId) {
        params.clientOrderId = request.clientOrderId;
      }

      // 调用 CCXT 创建订单
      const rawOrder = await this.ccxt.createOrder(
        request.symbol,          // 交易对
        request.type,            // 订单类型
        request.side,            // 订单方向
        request.amount,          // 数量
        request.price,           // 价格（限价单）
        params                   // 附加参数
      );

      // 报告成功（重置 429 计数）
      this.rateLimiter.reportSuccess();

      // 转换为统一格式
      const order = this.transformOrder(rawOrder);

      // 验证并返回
      return validate(OrderResultSchema, order);
    } catch (error) {
      // 处理错误
      this.handleApiError(error);

      // 永远不会到达这里，handleApiError 会抛出异常
      throw error;
    }
  }

  /**
   * 取消订单
   * @param orderId - 订单 ID
   * @param symbol - 交易对符号
   * @returns 取消后的订单结果
   */
  async cancelOrder(orderId: string, symbol: string): Promise<OrderResult> {
    // 确保 CCXT 已初始化
    if (!this.ccxt) {
      throw new ExchangeException('UNKNOWN_ERROR', 'Exchange not initialized');
    }

    // 获取限频许可
    await this.rateLimiter.acquire();

    try {
      // 调用 CCXT 取消订单
      const rawOrder = await this.ccxt.cancelOrder(orderId, symbol);

      // 报告成功
      this.rateLimiter.reportSuccess();

      // 转换并验证
      const order = this.transformOrder(rawOrder);
      return validate(OrderResultSchema, order);
    } catch (error) {
      this.handleApiError(error, { orderId, symbol });
      throw error;
    }
  }

  /**
   * 批量取消订单
   * @param symbol - 交易对符号（取消该交易对的所有订单）
   */
  async cancelAllOrders(symbol?: string): Promise<OrderResult[]> {
    // 确保 CCXT 已初始化
    if (!this.ccxt) {
      throw new ExchangeException('UNKNOWN_ERROR', 'Exchange not initialized');
    }

    // 获取限频许可
    await this.rateLimiter.acquire();

    try {
      // 调用 CCXT 取消所有订单
      const rawOrders = await this.ccxt.cancelAllOrders(symbol);

      // 报告成功
      this.rateLimiter.reportSuccess();

      // 转换并验证每个订单
      return rawOrders.map((raw: unknown) => {
        const order = this.transformOrder(raw);
        return validate(OrderResultSchema, order);
      });
    } catch (error) {
      this.handleApiError(error, { symbol });
      throw error;
    }
  }

  /**
   * 获取订单详情
   * @param orderId - 订单 ID
   * @param symbol - 交易对符号
   * @returns 订单结果
   */
  async getOrder(orderId: string, symbol: string): Promise<OrderResult> {
    // 确保 CCXT 已初始化
    if (!this.ccxt) {
      throw new ExchangeException('UNKNOWN_ERROR', 'Exchange not initialized');
    }

    // 获取限频许可
    await this.rateLimiter.acquire();

    try {
      // 调用 CCXT 获取订单
      const rawOrder = await this.ccxt.fetchOrder(orderId, symbol);

      // 报告成功
      this.rateLimiter.reportSuccess();

      // 转换并验证
      const order = this.transformOrder(rawOrder);
      return validate(OrderResultSchema, order);
    } catch (error) {
      this.handleApiError(error, { orderId, symbol });
      throw error;
    }
  }

  /**
   * 获取未完成订单
   * @param symbol - 交易对符号（可选，不传则获取所有）
   * @returns 订单列表
   */
  async getOpenOrders(symbol?: string): Promise<OrderResult[]> {
    // 确保 CCXT 已初始化
    if (!this.ccxt) {
      throw new ExchangeException('UNKNOWN_ERROR', 'Exchange not initialized');
    }

    // 获取限频许可
    await this.rateLimiter.acquire();

    try {
      // 调用 CCXT 获取未完成订单
      const rawOrders = await this.ccxt.fetchOpenOrders(symbol);

      // 报告成功
      this.rateLimiter.reportSuccess();

      // 转换并验证每个订单
      return rawOrders.map((raw: unknown) => {
        const order = this.transformOrder(raw);
        return validate(OrderResultSchema, order);
      });
    } catch (error) {
      this.handleApiError(error, { symbol });
      throw error;
    }
  }

  /**
   * 获取持仓列表
   * @param symbol - 交易对符号（可选）
   * @returns 持仓列表（Zod 验证过）
   */
  async getPositions(symbol?: string): Promise<Position[]> {
    // 确保 CCXT 已初始化
    if (!this.ccxt) {
      throw new ExchangeException('UNKNOWN_ERROR', 'Exchange not initialized');
    }

    // 获取限频许可
    await this.rateLimiter.acquire();

    try {
      // 调用 CCXT 获取持仓
      // 不同交易所的 API 方法可能不同，这里使用通用方法
      const symbols = symbol ? [symbol] : undefined;
      const rawPositions = await this.ccxt.fetchPositions(symbols);

      // 报告成功
      this.rateLimiter.reportSuccess();

      // 过滤有效持仓（数量不为 0）
      const validPositions = rawPositions.filter((pos: ccxt.Position) => {
        // 某些交易所返回数量为 0 的空仓位，需要过滤
        const contracts = pos.contracts ?? 0;
        return contracts !== 0;
      });

      // 转换并验证每个持仓
      return validPositions.map((raw: unknown) => {
        const position = this.transformPosition(raw);
        return validate(PositionSchema, position);
      });
    } catch (error) {
      this.handleApiError(error, { symbol });
      throw error;
    }
  }

  /**
   * 获取账户余额
   * @returns 余额信息（Zod 验证过）
   */
  async getBalance(): Promise<Balance> {
    // 确保 CCXT 已初始化
    if (!this.ccxt) {
      throw new ExchangeException('UNKNOWN_ERROR', 'Exchange not initialized');
    }

    // 获取限频许可
    await this.rateLimiter.acquire();

    try {
      // 调用 CCXT 获取余额
      const rawBalance = await this.ccxt.fetchBalance();

      // 报告成功
      this.rateLimiter.reportSuccess();

      // 转换并验证
      const balance = this.transformBalance(rawBalance);
      return validate(BalanceSchema, balance);
    } catch (error) {
      this.handleApiError(error);
      throw error;
    }
  }

  /**
   * 获取资金费率
   * @param symbol - 交易对符号
   * @returns 资金费率信息（Zod 验证过）
   */
  async getFundingRate(symbol: string): Promise<FundingRate> {
    // 确保 CCXT 已初始化
    if (!this.ccxt) {
      throw new ExchangeException('UNKNOWN_ERROR', 'Exchange not initialized');
    }

    // 获取限频许可
    await this.rateLimiter.acquire();

    try {
      // 调用 CCXT 获取资金费率
      const rawFundingRate = await this.ccxt.fetchFundingRate(symbol);

      // 报告成功
      this.rateLimiter.reportSuccess();

      // 转换并验证
      const fundingRate = this.transformFundingRate(rawFundingRate);
      return validate(FundingRateSchema, fundingRate);
    } catch (error) {
      this.handleApiError(error, { symbol });
      throw error;
    }
  }

  /**
   * 获取历史资金费率
   * @param symbol - 交易对符号
   * @param since - 开始时间戳（可选）
   * @param limit - 数量限制（可选）
   * @returns 资金费率列表
   */
  async getFundingRateHistory(
    symbol: string,
    since?: number,
    limit?: number
  ): Promise<FundingRate[]> {
    // 确保 CCXT 已初始化
    if (!this.ccxt) {
      throw new ExchangeException('UNKNOWN_ERROR', 'Exchange not initialized');
    }

    // 获取限频许可
    await this.rateLimiter.acquire();

    try {
      // 调用 CCXT 获取历史资金费率
      const rawRates = await this.ccxt.fetchFundingRateHistory(symbol, since, limit);

      // 报告成功
      this.rateLimiter.reportSuccess();

      // 转换并验证每条记录
      return rawRates.map((raw: unknown) => {
        const rate = this.transformFundingRate(raw);
        return validate(FundingRateSchema, rate);
      });
    } catch (error) {
      this.handleApiError(error, { symbol });
      throw error;
    }
  }

  /**
   * 获取 K线数据
   * @param symbol - 交易对符号
   * @param timeframe - 时间周期
   * @param since - 开始时间戳（可选）
   * @param limit - 数量限制（可选）
   * @returns K线数据列表（Zod 验证过）
   */
  async getKlines(
    symbol: string,
    timeframe: Timeframe,
    since?: number,
    limit?: number
  ): Promise<Kline[]> {
    // 确保 CCXT 已初始化
    if (!this.ccxt) {
      throw new ExchangeException('UNKNOWN_ERROR', 'Exchange not initialized');
    }

    // 获取限频许可
    await this.rateLimiter.acquire();

    try {
      // 调用 CCXT 获取 K线
      const rawKlines = await this.ccxt.fetchOHLCV(symbol, timeframe, since, limit);

      // 报告成功
      this.rateLimiter.reportSuccess();

      // 转换格式
      // CCXT 返回格式: [[timestamp, open, high, low, close, volume], ...]
      return rawKlines.map((k: ccxt.OHLCV) => {
        const kline = {
          timestamp: k[0] as number,
          open: k[1] as number,
          high: k[2] as number,
          low: k[3] as number,
          close: k[4] as number,
          volume: k[5] as number,
        };
        return validate(KlineSchema, kline);
      });
    } catch (error) {
      this.handleApiError(error, { symbol });
      throw error;
    }
  }

  /**
   * 获取行情数据
   * @param symbol - 交易对符号
   * @returns 行情信息（Zod 验证过）
   */
  async getTicker(symbol: string): Promise<Ticker> {
    // 确保 CCXT 已初始化
    if (!this.ccxt) {
      throw new ExchangeException('UNKNOWN_ERROR', 'Exchange not initialized');
    }

    // 获取限频许可
    await this.rateLimiter.acquire();

    try {
      // 调用 CCXT 获取行情
      const rawTicker = await this.ccxt.fetchTicker(symbol);

      // 报告成功
      this.rateLimiter.reportSuccess();

      // 转换并验证
      const ticker: Ticker = {
        symbol: rawTicker.symbol,
        last: rawTicker.last ?? 0,
        bid: rawTicker.bid ?? 0,
        bidVolume: rawTicker.bidVolume,
        ask: rawTicker.ask ?? 0,
        askVolume: rawTicker.askVolume,
        open: rawTicker.open ?? 0,
        high: rawTicker.high ?? 0,
        low: rawTicker.low ?? 0,
        close: rawTicker.close ?? rawTicker.last ?? 0,
        change: rawTicker.change ?? 0,
        percentage: rawTicker.percentage ?? 0,
        baseVolume: rawTicker.baseVolume ?? 0,
        quoteVolume: rawTicker.quoteVolume ?? 0,
        timestamp: rawTicker.timestamp ?? Date.now(),
        info: rawTicker.info,
      };

      return validate(TickerSchema, ticker);
    } catch (error) {
      this.handleApiError(error, { symbol });
      throw error;
    }
  }

  /**
   * 获取订单簿
   * @param symbol - 交易对符号
   * @param limit - 深度限制（可选）
   * @returns 订单簿数据（Zod 验证过）
   */
  async getOrderBook(symbol: string, limit?: number): Promise<OrderBook> {
    // 确保 CCXT 已初始化
    if (!this.ccxt) {
      throw new ExchangeException('UNKNOWN_ERROR', 'Exchange not initialized');
    }

    // 获取限频许可
    await this.rateLimiter.acquire();

    try {
      // 调用 CCXT 获取订单簿
      const rawOrderBook = await this.ccxt.fetchOrderBook(symbol, limit);

      // 报告成功
      this.rateLimiter.reportSuccess();

      // 转换并验证
      const orderBook: OrderBook = {
        symbol,
        bids: rawOrderBook.bids.map((bid): [number, number] => [bid[0], bid[1]]),
        asks: rawOrderBook.asks.map((ask): [number, number] => [ask[0], ask[1]]),
        timestamp: rawOrderBook.timestamp ?? Date.now(),
        nonce: rawOrderBook.nonce,
      };

      return validate(OrderBookSchema, orderBook);
    } catch (error) {
      this.handleApiError(error, { symbol });
      throw error;
    }
  }

  /**
   * 获取市场信息
   * @param symbol - 交易对符号
   * @returns 市场信息
   */
  getMarket(symbol: string): Market | undefined {
    return this.markets.get(symbol);
  }

  /**
   * 获取所有市场
   * @returns 市场信息映射
   */
  getAllMarkets(): Map<string, Market> {
    return this.markets;
  }

  /**
   * 设置杠杆倍数
   * @param leverage - 杠杆倍数
   * @param symbol - 交易对符号
   */
  async setLeverage(leverage: number, symbol: string): Promise<void> {
    // 确保 CCXT 已初始化
    if (!this.ccxt) {
      throw new ExchangeException('UNKNOWN_ERROR', 'Exchange not initialized');
    }

    // 获取限频许可
    await this.rateLimiter.acquire();

    try {
      // 调用 CCXT 设置杠杆
      await this.ccxt.setLeverage(leverage, symbol);

      // 报告成功
      this.rateLimiter.reportSuccess();
    } catch (error) {
      this.handleApiError(error, { symbol });
      throw error;
    }
  }

  /**
   * 设置保证金模式
   * @param marginMode - 保证金模式（cross/isolated）
   * @param symbol - 交易对符号
   */
  async setMarginMode(marginMode: 'cross' | 'isolated', symbol: string): Promise<void> {
    // 确保 CCXT 已初始化
    if (!this.ccxt) {
      throw new ExchangeException('UNKNOWN_ERROR', 'Exchange not initialized');
    }

    // 获取限频许可
    await this.rateLimiter.acquire();

    try {
      // 调用 CCXT 设置保证金模式
      await this.ccxt.setMarginMode(marginMode, symbol);

      // 报告成功
      this.rateLimiter.reportSuccess();
    } catch (error) {
      this.handleApiError(error, { symbol });
      throw error;
    }
  }

  // ========================================================================
  // 错误处理
  // ========================================================================

  /**
   * 处理 API 错误
   * 将 CCXT 错误转换为统一的 ExchangeException
   * @param error - 原始错误
   * @param context - 错误上下文
   */
  protected handleApiError(
    error: unknown,
    context: { symbol?: string; orderId?: string } = {}
  ): never {
    // CCXT 限频错误
    if (error instanceof ccxt.RateLimitExceeded) {
      // 报告 429 错误
      this.rateLimiter.report429();

      // 检查是否超过最大重试次数
      if (this.rateLimiter.isMaxRetriesExceeded()) {
        throw new ExchangeException(
          'RATE_LIMIT_EXCEEDED',
          'Rate limit exceeded, max retries reached',
          {
            retryable: false,
            symbol: context.symbol,
          }
        );
      }

      // 抛出可重试错误
      throw new ExchangeException(
        'RATE_LIMIT_EXCEEDED',
        error.message,
        {
          retryable: true,
          retryAfter: this.rateLimiter.getBackoffDelay(),
          symbol: context.symbol,
        }
      );
    }

    // 认证错误
    if (error instanceof ccxt.AuthenticationError) {
      throw new ExchangeException(
        'AUTHENTICATION_ERROR',
        error.message,
        {
          originalMessage: error.message,
          retryable: false,
        }
      );
    }

    // 余额不足
    if (error instanceof ccxt.InsufficientFunds) {
      throw new ExchangeException(
        'INSUFFICIENT_FUNDS',
        error.message,
        {
          originalMessage: error.message,
          symbol: context.symbol,
          retryable: false,
        }
      );
    }

    // 无效订单
    if (error instanceof ccxt.InvalidOrder) {
      throw new ExchangeException(
        'INVALID_ORDER',
        error.message,
        {
          originalMessage: error.message,
          symbol: context.symbol,
          orderId: context.orderId,
          retryable: false,
        }
      );
    }

    // 订单未找到
    if (error instanceof ccxt.OrderNotFound) {
      throw new ExchangeException(
        'ORDER_NOT_FOUND',
        error.message,
        {
          originalMessage: error.message,
          symbol: context.symbol,
          orderId: context.orderId,
          retryable: false,
        }
      );
    }

    // 网络错误
    if (error instanceof ccxt.NetworkError) {
      throw new ExchangeException(
        'NETWORK_ERROR',
        error.message,
        {
          originalMessage: error.message,
          retryable: true,
          retryAfter: 1000,
        }
      );
    }

    // 交易所错误
    if (error instanceof ccxt.ExchangeError) {
      throw new ExchangeException(
        'EXCHANGE_ERROR',
        error.message,
        {
          originalMessage: error.message,
          symbol: context.symbol,
          orderId: context.orderId,
          retryable: false,
        }
      );
    }

    // 无效交易对
    if (error instanceof ccxt.BadSymbol) {
      throw new ExchangeException(
        'INVALID_SYMBOL',
        error.message,
        {
          originalMessage: error.message,
          symbol: context.symbol,
          retryable: false,
        }
      );
    }

    // 其他错误
    const message = error instanceof Error ? error.message : String(error);
    throw new ExchangeException(
      'UNKNOWN_ERROR',
      message,
      {
        originalMessage: message,
        symbol: context.symbol,
        orderId: context.orderId,
        retryable: false,
      }
    );
  }

  // ========================================================================
  // 清理方法
  // ========================================================================

  /**
   * 断开所有连接
   */
  async disconnect(): Promise<void> {
    // 停止心跳
    this.stopPingInterval();

    // 清除重连定时器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // 关闭公共 WebSocket
    if (this.wsPublic) {
      this.wsPublic.close(1000, 'Normal closure');
      this.wsPublic = null;
    }

    // 关闭私有 WebSocket
    if (this.wsPrivate) {
      this.wsPrivate.close(1000, 'Normal closure');
      this.wsPrivate = null;
    }

    // 清空订阅
    this.subscriptions.clear();

    // 更新连接状态
    this.wsConnected = false;
  }

  /**
   * 获取交易所名称
   */
  getName(): string {
    return this.exchangeName;
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.wsConnected;
  }
}
