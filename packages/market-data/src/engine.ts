// ============================================================================
// MarketDataEngine 主引擎类
// 统一管理 WebSocket 连接、数据解析、Redis 存储
// 提供高性能的市场数据订阅服务
// ============================================================================

import { EventEmitter } from 'eventemitter3';

import {
  type ExchangeId,
  type ChannelType,
  type MarketDataEngineConfig,
  type MarketDataEngineEvents,
  type SubscriptionConfig,
  type SubscriptionState,
  type EngineStats,
  type UnifiedTicker,
  type UnifiedDepth,
  type UnifiedTrade,
  type UnifiedFundingRate,
  type UnifiedMarketData,
  SUPPORTED_EXCHANGES,
  DEFAULT_CONFIG,
} from './types.js';

import { WsConnectionManager } from './ws-manager.js';
import { RedisClient } from './redis-client.js';
import {
  parseMessage,
  normalizeSymbol,
  denormalizeSymbol,
} from './normalizer.js';

// ============================================================================
// 订阅消息构建器
// ============================================================================

/**
 * 构建 Binance 订阅消息
 * Binance 使用组合流，需要在连接 URL 中指定订阅
 *
 * @param symbols - 原始交易对列表
 * @param channels - 频道类型列表
 * @returns 订阅消息（用于 URL 参数）
 */
function buildBinanceSubscribeStreams(
  symbols: string[],
  channels: ChannelType[]
): string[] {
  // 结果数组
  const streams: string[] = [];

  // 遍历交易对和频道
  for (const symbol of symbols) {
    // 转换为小写（Binance 要求）
    const lowerSymbol = symbol.toLowerCase();

    // 遍历频道
    for (const channel of channels) {
      // 根据频道类型构建流名称
      switch (channel) {
        case 'ticker':
          // 行情数据流
          streams.push(`${lowerSymbol}@ticker`);
          break;

        case 'depth5':
          // 5 档深度流（100ms）
          streams.push(`${lowerSymbol}@depth5@100ms`);
          break;

        case 'depth20':
          // 20 档深度流（250ms）
          streams.push(`${lowerSymbol}@depth20@250ms`);
          break;

        case 'aggTrade':
          // 聚合成交流
          streams.push(`${lowerSymbol}@aggTrade`);
          break;

        case 'fundingRate':
          // 资金费率流（标记价格流包含资金费率）
          streams.push(`${lowerSymbol}@markPrice@1s`);
          break;
      }
    }
  }

  // 返回流名称列表
  return streams;
}

/**
 * 构建 Binance 订阅 JSON 消息
 *
 * @param streams - 流名称列表
 * @param subscribe - 是否订阅（false 为取消订阅）
 * @returns JSON 字符串
 */
function buildBinanceSubscribeMessage(streams: string[], subscribe: boolean): string {
  // 构建消息对象
  const message = {
    // 方法：订阅或取消订阅
    method: subscribe ? 'SUBSCRIBE' : 'UNSUBSCRIBE',
    // 参数：流名称列表
    params: streams,
    // 请求 ID
    id: Date.now(),
  };

  // 返回 JSON 字符串
  return JSON.stringify(message);
}

/**
 * 构建 Bybit 订阅消息
 *
 * @param symbols - 原始交易对列表
 * @param channels - 频道类型列表
 * @param subscribe - 是否订阅
 * @returns JSON 字符串
 */
function buildBybitSubscribeMessage(
  symbols: string[],
  channels: ChannelType[],
  subscribe: boolean
): string {
  // 构建订阅参数列表
  const args: string[] = [];

  // 遍历交易对和频道
  for (const symbol of symbols) {
    for (const channel of channels) {
      // 根据频道类型构建主题
      switch (channel) {
        case 'ticker':
          // 行情数据
          args.push(`tickers.${symbol}`);
          break;

        case 'depth5':
          // 5 档深度
          args.push(`orderbook.1.${symbol}`);
          break;

        case 'depth20':
          // 深度（Bybit 支持 1, 50, 200, 500 档）
          args.push(`orderbook.50.${symbol}`);
          break;

        case 'aggTrade':
          // 成交数据
          args.push(`publicTrade.${symbol}`);
          break;

        case 'fundingRate':
          // 资金费率（通过 tickers 获取）
          // 已在 ticker 中包含，无需单独订阅
          break;
      }
    }
  }

  // 构建消息对象
  const message = {
    // 操作：订阅或取消订阅
    op: subscribe ? 'subscribe' : 'unsubscribe',
    // 参数
    args,
  };

  // 返回 JSON 字符串
  return JSON.stringify(message);
}

/**
 * 构建 OKX 订阅消息
 *
 * @param symbols - 原始交易对列表（OKX 格式）
 * @param channels - 频道类型列表
 * @param subscribe - 是否订阅
 * @returns JSON 字符串
 */
function buildOkxSubscribeMessage(
  symbols: string[],
  channels: ChannelType[],
  subscribe: boolean
): string {
  // 构建订阅参数列表
  const args: Array<{ channel: string; instId: string }> = [];

  // 遍历交易对和频道
  for (const symbol of symbols) {
    for (const channel of channels) {
      // 根据频道类型构建参数
      switch (channel) {
        case 'ticker':
          // 行情数据
          args.push({ channel: 'tickers', instId: symbol });
          break;

        case 'depth5':
          // 5 档深度
          args.push({ channel: 'books5', instId: symbol });
          break;

        case 'depth20':
          // 深度（OKX 使用 books）
          args.push({ channel: 'books', instId: symbol });
          break;

        case 'aggTrade':
          // 成交数据
          args.push({ channel: 'trades', instId: symbol });
          break;

        case 'fundingRate':
          // 资金费率
          args.push({ channel: 'funding-rate', instId: symbol });
          break;
      }
    }
  }

  // 构建消息对象
  const message = {
    // 操作：订阅或取消订阅
    op: subscribe ? 'subscribe' : 'unsubscribe',
    // 参数
    args,
  };

  // 返回 JSON 字符串
  return JSON.stringify(message);
}

// ============================================================================
// MarketDataEngine 主类
// ============================================================================

/**
 * 市场数据引擎
 *
 * 功能：
 * - 同时订阅 Binance/Bybit/OKX 三个交易所
 * - 支持 ticker、depth、trade、fundingRate 数据
 * - 统一数据格式和时间戳
 * - 写入 RedisTimeSeries + 发布到 Redis Channel
 * - 动态订阅/取消订阅
 * - 低 CPU 占用（批量处理、高效解析）
 */
export class MarketDataEngine extends EventEmitter<MarketDataEngineEvents> {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // WebSocket 连接管理器
  private readonly wsManager: WsConnectionManager;

  // Redis 客户端
  private readonly redisClient: RedisClient;

  // 配置
  private readonly config: MarketDataEngineConfig;

  // 订阅状态 Map<subscriptionId, SubscriptionState>
  private subscriptions: Map<string, SubscriptionState> = new Map();

  // 是否正在运行
  private running: boolean = false;

  // 启动时间
  private startedAt: number = 0;

  // 消息统计
  private messageStats = {
    // 总接收数
    received: 0,
    // 各类型消息数
    byType: {} as Record<string, number>,
    // 各交易所消息数
    byExchange: {} as Record<ExchangeId, number>,
    // 最后统计时间
    lastStatsTime: 0,
    // 最后统计的消息数
    lastStatsCount: 0,
  };

  // 性能统计
  private perfStats = {
    // 延迟累计（微秒）
    totalLatencyUs: 0,
    // 延迟样本数
    latencySamples: 0,
    // 最大延迟
    maxLatencyUs: 0,
  };

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param config - 引擎配置
   */
  constructor(config: MarketDataEngineConfig) {
    // 初始化 EventEmitter
    super();

    // 保存配置
    this.config = config;

    // 创建 WebSocket 连接管理器
    this.wsManager = new WsConnectionManager({
      // 重连基础延迟
      reconnectBaseDelay: config.wsReconnectBaseDelay ?? DEFAULT_CONFIG.wsReconnectBaseDelay,
      // 重连最大延迟
      reconnectMaxDelay: config.wsReconnectMaxDelay ?? DEFAULT_CONFIG.wsReconnectMaxDelay,
      // 最大重连次数
      maxReconnectAttempts: config.wsMaxReconnectAttempts ?? DEFAULT_CONFIG.wsMaxReconnectAttempts,
      // 心跳间隔
      heartbeatInterval: config.heartbeatInterval ?? DEFAULT_CONFIG.heartbeatInterval,
    });

    // 创建 Redis 客户端
    this.redisClient = new RedisClient(config.redis, {
      // 数据保留配置
      retention: config.retention ?? DEFAULT_CONFIG.retention,
      // 批量写入间隔
      batchInterval: config.batchInterval ?? DEFAULT_CONFIG.batchInterval,
      // 批量写入大小
      batchSize: config.batchSize ?? DEFAULT_CONFIG.batchSize,
      // Pub/Sub 频道
      pubSubChannel: config.pubSubChannel ?? DEFAULT_CONFIG.pubSubChannel,
      // 是否启用 TimeSeries
      enableTimeSeries: config.enableTimeSeries ?? DEFAULT_CONFIG.enableTimeSeries,
      // 是否启用 Pub/Sub
      enablePubSub: config.enablePubSub ?? DEFAULT_CONFIG.enablePubSub,
    });

    // 初始化交易所消息统计
    for (const exchange of SUPPORTED_EXCHANGES) {
      this.messageStats.byExchange[exchange] = 0;
    }

    // 绑定 WebSocket 事件处理器
    this.setupWsEventHandlers();
  }

  // ========================================================================
  // 事件处理
  // ========================================================================

  /**
   * 设置 WebSocket 事件处理器
   */
  private setupWsEventHandlers(): void {
    // 处理收到的消息
    this.wsManager.on('message', (exchange, message) => {
      // 处理消息
      this.handleMessage(exchange, message);
    });

    // 处理连接成功事件
    this.wsManager.on('connected', (exchange) => {
      // 发出连接事件
      this.emit('connected', exchange);
    });

    // 处理断开连接事件
    this.wsManager.on('disconnected', (exchange, reason) => {
      // 发出断开事件
      this.emit('disconnected', exchange, reason);
    });

    // 处理重连事件
    this.wsManager.on('reconnecting', (exchange, attempt) => {
      // 发出重连事件
      this.emit('reconnecting', exchange, attempt);
    });

    // 处理错误事件
    this.wsManager.on('error', (exchange, error) => {
      // 发出错误事件
      this.emit('error', error, `WebSocket error from ${exchange}`);
    });
  }

  /**
   * 处理收到的 WebSocket 消息
   * @param exchange - 交易所 ID
   * @param message - 原始消息
   */
  private handleMessage(exchange: ExchangeId, message: string): void {
    // 记录接收时间（高精度）
    const receivedAt = Date.now();
    // 记录处理开始时间（用于性能统计）
    const startTime = performance.now();

    try {
      // 解析消息为统一格式
      const dataList = parseMessage(exchange, message, receivedAt);

      // 如果没有解析出数据，跳过
      if (dataList.length === 0) {
        return;
      }

      // 更新消息统计
      this.messageStats.received += dataList.length;
      this.messageStats.byExchange[exchange] += dataList.length;

      // 遍历解析结果
      for (const data of dataList) {
        // 更新类型统计
        this.messageStats.byType[data.type] =
          (this.messageStats.byType[data.type] || 0) + 1;

        // 更新订阅状态
        this.updateSubscriptionState(exchange, data);

        // 根据数据类型发出事件
        this.emitDataEvent(data);

        // 写入 Redis
        this.redisClient.writeMarketData(data).catch((error) => {
          // 记录错误但不中断处理
          console.error('Failed to write market data:', error);
        });
      }

      // 更新性能统计
      const endTime = performance.now();
      const latencyUs = (endTime - startTime) * 1000;
      this.perfStats.totalLatencyUs += latencyUs;
      this.perfStats.latencySamples++;
      if (latencyUs > this.perfStats.maxLatencyUs) {
        this.perfStats.maxLatencyUs = latencyUs;
      }

    } catch (error) {
      // 发出错误事件
      this.emit('error', error as Error, `Message processing error from ${exchange}`);
    }
  }

  /**
   * 更新订阅状态
   * @param exchange - 交易所 ID
   * @param data - 市场数据
   */
  private updateSubscriptionState(exchange: ExchangeId, data: UnifiedMarketData): void {
    // 构建订阅 ID
    const channel = this.dataTypeToChannel(data.type);
    const subscriptionId = `${exchange}:${data.symbol}:${channel}`;

    // 获取订阅状态
    const state = this.subscriptions.get(subscriptionId);

    // 如果存在订阅，更新状态
    if (state) {
      state.lastDataAt = Date.now();
      state.messageCount++;
    }
  }

  /**
   * 将数据类型转换为频道类型
   * @param type - 数据类型
   * @returns 频道类型
   */
  private dataTypeToChannel(type: string): ChannelType {
    // 根据数据类型返回对应频道
    switch (type) {
      case 'ticker':
        return 'ticker';
      case 'depth':
        return 'depth5'; // 默认返回 depth5
      case 'trade':
        return 'aggTrade';
      case 'fundingRate':
        return 'fundingRate';
      default:
        return 'ticker';
    }
  }

  /**
   * 发出数据事件
   * @param data - 市场数据
   */
  private emitDataEvent(data: UnifiedMarketData): void {
    // 根据数据类型发出对应事件
    switch (data.type) {
      case 'ticker':
        this.emit('ticker', data as UnifiedTicker);
        break;

      case 'depth':
        this.emit('depth', data as UnifiedDepth);
        break;

      case 'trade':
        this.emit('trade', data as UnifiedTrade);
        break;

      case 'fundingRate':
        this.emit('fundingRate', data as UnifiedFundingRate);
        break;
    }
  }

  // ========================================================================
  // 生命周期管理
  // ========================================================================

  /**
   * 启动引擎
   * 连接所有交易所并等待 Redis 就绪
   */
  async start(): Promise<void> {
    // 如果已运行，直接返回
    if (this.running) {
      return;
    }

    try {
      // 等待 Redis 连接就绪
      await this.redisClient.waitForReady();

      // 连接所有交易所
      await this.wsManager.connectAll();

      // 标记为运行中
      this.running = true;
      this.startedAt = Date.now();

      // 初始化统计时间
      this.messageStats.lastStatsTime = Date.now();

    } catch (error) {
      // 启动失败，清理资源
      await this.stop();
      throw error;
    }
  }

  /**
   * 停止引擎
   * 断开所有连接并清理资源
   */
  async stop(): Promise<void> {
    // 标记为停止
    this.running = false;

    // 断开所有 WebSocket 连接
    this.wsManager.disconnectAll();

    // 关闭 Redis 连接
    await this.redisClient.close();

    // 清空订阅状态
    this.subscriptions.clear();
  }

  /**
   * 检查是否正在运行
   */
  isRunning(): boolean {
    return this.running;
  }

  // ========================================================================
  // 订阅管理
  // ========================================================================

  /**
   * 订阅市场数据
   *
   * @param config - 订阅配置
   *
   * @example
   * ```typescript
   * // 订阅 Binance 的 BTC 和 ETH 的 ticker 和深度数据
   * engine.subscribe({
   *   exchange: 'binance',
   *   symbols: ['BTC/USDT:USDT', 'ETH/USDT:USDT'],
   *   channels: ['ticker', 'depth5'],
   * });
   * ```
   */
  subscribe(config: SubscriptionConfig): void {
    // 获取交易所 ID
    const { exchange, symbols, channels } = config;

    // 将统一符号转换为交易所原始格式
    const rawSymbols = symbols.map((s) => denormalizeSymbol(exchange, s));

    // 构建订阅消息
    let subscribeMessage: string;

    // 根据交易所构建不同的订阅消息
    switch (exchange) {
      case 'binance': {
        // Binance 使用流名称列表
        const streams = buildBinanceSubscribeStreams(rawSymbols, channels);
        subscribeMessage = buildBinanceSubscribeMessage(streams, true);
        break;
      }

      case 'bybit':
        // Bybit 使用主题列表
        subscribeMessage = buildBybitSubscribeMessage(rawSymbols, channels, true);
        break;

      case 'okx':
        // OKX 使用参数列表
        subscribeMessage = buildOkxSubscribeMessage(rawSymbols, channels, true);
        break;

      default:
        // 不支持的交易所
        throw new Error(`Unsupported exchange: ${exchange}`);
    }

    // 发送订阅消息
    this.wsManager.subscribe(exchange, subscribeMessage);

    // 记录订阅状态
    for (const symbol of symbols) {
      for (const channel of channels) {
        // 构建订阅 ID
        const subscriptionId = `${exchange}:${symbol}:${channel}`;

        // 检查是否已订阅
        if (!this.subscriptions.has(subscriptionId)) {
          // 创建订阅状态
          const state: SubscriptionState = {
            id: subscriptionId,
            exchange,
            symbol,
            channel,
            active: true,
            subscribedAt: Date.now(),
            lastDataAt: 0,
            messageCount: 0,
          };

          // 保存订阅状态
          this.subscriptions.set(subscriptionId, state);

          // 发出订阅事件
          this.emit('subscribed', exchange, symbol, channel);
        }
      }
    }
  }

  /**
   * 取消订阅市场数据
   *
   * @param config - 订阅配置（同 subscribe）
   */
  unsubscribe(config: SubscriptionConfig): void {
    // 获取交易所 ID
    const { exchange, symbols, channels } = config;

    // 将统一符号转换为交易所原始格式
    const rawSymbols = symbols.map((s) => denormalizeSymbol(exchange, s));

    // 构建取消订阅消息
    let unsubscribeMessage: string;

    // 根据交易所构建不同的取消订阅消息
    switch (exchange) {
      case 'binance': {
        const streams = buildBinanceSubscribeStreams(rawSymbols, channels);
        unsubscribeMessage = buildBinanceSubscribeMessage(streams, false);
        break;
      }

      case 'bybit':
        unsubscribeMessage = buildBybitSubscribeMessage(rawSymbols, channels, false);
        break;

      case 'okx':
        unsubscribeMessage = buildOkxSubscribeMessage(rawSymbols, channels, false);
        break;

      default:
        throw new Error(`Unsupported exchange: ${exchange}`);
    }

    // 需要找到对应的订阅消息来取消
    // 这里简化处理，直接发送取消订阅消息
    this.wsManager.send(exchange, unsubscribeMessage);

    // 更新订阅状态
    for (const symbol of symbols) {
      for (const channel of channels) {
        // 构建订阅 ID
        const subscriptionId = `${exchange}:${symbol}:${channel}`;

        // 删除订阅状态
        if (this.subscriptions.has(subscriptionId)) {
          this.subscriptions.delete(subscriptionId);

          // 发出取消订阅事件
          this.emit('unsubscribed', exchange, symbol, channel);
        }
      }
    }
  }

  /**
   * 获取所有订阅状态
   * @returns 订阅状态映射
   */
  getSubscriptions(): Map<string, SubscriptionState> {
    return new Map(this.subscriptions);
  }

  /**
   * 获取指定交易所的订阅数量
   * @param exchange - 交易所 ID
   * @returns 订阅数量
   */
  getSubscriptionCount(exchange?: ExchangeId): number {
    // 如果指定交易所，返回该交易所的订阅数
    if (exchange) {
      let count = 0;
      for (const state of this.subscriptions.values()) {
        if (state.exchange === exchange) {
          count++;
        }
      }
      return count;
    }

    // 否则返回所有订阅数
    return this.subscriptions.size;
  }

  // ========================================================================
  // 便捷订阅方法
  // ========================================================================

  /**
   * 订阅 Ticker 数据
   *
   * @param exchange - 交易所 ID
   * @param symbols - 交易对列表
   */
  subscribeTicker(exchange: ExchangeId, symbols: string[]): void {
    this.subscribe({
      exchange,
      symbols,
      channels: ['ticker'],
    });
  }

  /**
   * 订阅深度数据
   *
   * @param exchange - 交易所 ID
   * @param symbols - 交易对列表
   * @param depth - 深度档数（5 或 20）
   */
  subscribeDepth(
    exchange: ExchangeId,
    symbols: string[],
    depth: 5 | 20 = 5
  ): void {
    this.subscribe({
      exchange,
      symbols,
      channels: [depth === 5 ? 'depth5' : 'depth20'],
    });
  }

  /**
   * 订阅成交数据
   *
   * @param exchange - 交易所 ID
   * @param symbols - 交易对列表
   */
  subscribeTrades(exchange: ExchangeId, symbols: string[]): void {
    this.subscribe({
      exchange,
      symbols,
      channels: ['aggTrade'],
    });
  }

  /**
   * 订阅资金费率数据
   *
   * @param exchange - 交易所 ID
   * @param symbols - 交易对列表
   */
  subscribeFundingRate(exchange: ExchangeId, symbols: string[]): void {
    this.subscribe({
      exchange,
      symbols,
      channels: ['fundingRate'],
    });
  }

  /**
   * 订阅所有数据类型
   *
   * @param exchange - 交易所 ID
   * @param symbols - 交易对列表
   */
  subscribeAll(exchange: ExchangeId, symbols: string[]): void {
    this.subscribe({
      exchange,
      symbols,
      channels: ['ticker', 'depth5', 'aggTrade', 'fundingRate'],
    });
  }

  // ========================================================================
  // 统计信息
  // ========================================================================

  /**
   * 获取引擎运行统计
   * @returns 统计信息
   */
  getStats(): EngineStats {
    // 计算当前时间
    const now = Date.now();

    // 计算每秒消息数
    const timeDiff = now - this.messageStats.lastStatsTime;
    const countDiff = this.messageStats.received - this.messageStats.lastStatsCount;
    const messagesPerSecond = timeDiff > 0 ? (countDiff / timeDiff) * 1000 : 0;

    // 更新统计基准
    this.messageStats.lastStatsTime = now;
    this.messageStats.lastStatsCount = this.messageStats.received;

    // 计算平均延迟
    const avgLatencyUs = this.perfStats.latencySamples > 0
      ? this.perfStats.totalLatencyUs / this.perfStats.latencySamples
      : 0;

    // 获取内存使用
    const memUsage = process.memoryUsage();
    const memoryUsageMb = memUsage.heapUsed / 1024 / 1024;

    // 构建连接信息
    const connections: Record<ExchangeId, any> = {} as any;
    for (const exchange of SUPPORTED_EXCHANGES) {
      connections[exchange] = this.wsManager.getConnectionInfo(exchange);
    }

    // 获取 Redis 统计
    const redisStats = this.redisClient.getStats();

    // 返回统计信息
    return {
      // 启动时间
      startedAt: this.startedAt,
      // 运行时长
      uptime: now - this.startedAt,
      // 连接状态
      connections,
      // 活跃订阅数
      activeSubscriptions: this.subscriptions.size,
      // 消息统计
      messages: {
        received: this.messageStats.received,
        perSecond: Math.round(messagesPerSecond * 100) / 100,
        byType: { ...this.messageStats.byType },
        byExchange: { ...this.messageStats.byExchange },
      },
      // Redis 统计
      redis: {
        timeSeriesWrites: redisStats.timeSeriesWrites,
        pubSubPublishes: redisStats.pubSubPublishes,
        errors: redisStats.errors,
      },
      // 性能统计
      performance: {
        avgLatencyUs: Math.round(avgLatencyUs * 100) / 100,
        maxLatencyUs: Math.round(this.perfStats.maxLatencyUs * 100) / 100,
        memoryUsageMb: Math.round(memoryUsageMb * 100) / 100,
        cpuUsagePercent: 0, // CPU 使用率需要更复杂的计算，暂时设为 0
      },
    };
  }

  /**
   * 重置统计信息
   */
  resetStats(): void {
    // 重置消息统计
    this.messageStats.received = 0;
    this.messageStats.byType = {};
    this.messageStats.lastStatsTime = Date.now();
    this.messageStats.lastStatsCount = 0;

    // 重置交易所统计
    for (const exchange of SUPPORTED_EXCHANGES) {
      this.messageStats.byExchange[exchange] = 0;
    }

    // 重置性能统计
    this.perfStats.totalLatencyUs = 0;
    this.perfStats.latencySamples = 0;
    this.perfStats.maxLatencyUs = 0;

    // 重置 Redis 统计
    this.redisClient.resetStats();
  }

  // ========================================================================
  // 连接管理
  // ========================================================================

  /**
   * 检查交易所是否已连接
   * @param exchange - 交易所 ID
   * @returns 是否已连接
   */
  isConnected(exchange: ExchangeId): boolean {
    return this.wsManager.isConnected(exchange);
  }

  /**
   * 重新连接指定交易所
   * @param exchange - 交易所 ID
   */
  async reconnect(exchange: ExchangeId): Promise<void> {
    // 先断开连接
    this.wsManager.disconnect(exchange);

    // 重新连接
    await this.wsManager.connect(exchange);
  }
}
