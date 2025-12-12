// ============================================================================
// Bybit V5 交易所适配器
// 实现 Bybit V5 API 的 REST 和 WebSocket 接口
// ============================================================================

import ccxt from 'ccxt';
import crypto from 'crypto';

import {
  BaseExchange,
} from './base-exchange.js';
import {
  type ExchangeConfig,
  type OrderResult,
  type Position,
  type Balance,
  type FundingRate,
  type WsMessage,
  type BalanceItem,
} from './schemas.js';

// ============================================================================
// Bybit V5 适配器
// ============================================================================

/**
 * Bybit V5 交易所适配器
 *
 * 特点：
 * - 使用 V5 统一 API
 * - 支持 USDT 永续、USDC 永续、反向永续
 * - 支持单向和双向持仓模式
 * - WebSocket 使用 HMAC 签名认证
 */
export class BybitV5 extends BaseExchange {
  // ========================================================================
  // 属性定义
  // ========================================================================

  // 交易所名称
  protected readonly exchangeName = 'bybit_v5';

  // 认证过期时间（毫秒）
  private readonly authExpireMs = 5 * 60 * 1000; // 5 分钟

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param config - 交易所配置
   */
  constructor(config: ExchangeConfig) {
    // 调用父类构造函数
    super(config);

    // 初始化 CCXT Bybit 实例
    this.initializeCcxt(ccxt.pro.bybit as unknown as new (config: ccxt.ExchangeConfig) => ccxt.Exchange);
  }

  // ========================================================================
  // WebSocket URL 获取
  // ========================================================================

  /**
   * 获取公共 WebSocket URL
   * Bybit V5 公共流地址
   */
  protected getPublicWsUrl(): string {
    // 测试网和主网使用不同的地址
    if (this.config.testnet) {
      // 测试网地址（USDT 永续）
      return 'wss://stream-testnet.bybit.com/v5/public/linear';
    }

    // 主网地址（USDT 永续）
    return 'wss://stream.bybit.com/v5/public/linear';
  }

  /**
   * 获取私有 WebSocket URL
   * Bybit V5 私有流地址
   */
  protected getPrivateWsUrl(): string {
    // 测试网和主网使用不同的地址
    if (this.config.testnet) {
      return 'wss://stream-testnet.bybit.com/v5/private';
    }

    return 'wss://stream.bybit.com/v5/private';
  }

  // ========================================================================
  // WebSocket 认证
  // ========================================================================

  /**
   * 生成 WebSocket 认证消息
   * Bybit 使用 HMAC-SHA256 签名认证
   */
  protected generateWsAuthMessage(): Record<string, unknown> {
    // 生成过期时间戳（当前时间 + 5 分钟）
    const expires = Date.now() + this.authExpireMs;

    // 生成签名
    // 签名内容：GET/realtime{expires}
    const signaturePayload = `GET/realtime${expires}`;

    // 使用 HMAC-SHA256 签名
    const signature = crypto
      .createHmac('sha256', this.config.apiSecret)
      .update(signaturePayload)
      .digest('hex');

    // 返回认证消息
    return {
      op: 'auth',
      args: [
        this.config.apiKey,  // API Key
        expires,              // 过期时间戳
        signature,            // 签名
      ],
    };
  }

  // ========================================================================
  // WebSocket 订阅消息生成
  // ========================================================================

  /**
   * 生成订阅消息
   * Bybit V5 使用 subscribe 操作订阅
   * @param subscription - 订阅信息
   */
  protected generateSubscribeMessage(
    subscription: { channel: string; symbol?: string; params?: Record<string, unknown> }
  ): Record<string, unknown> {
    // 生成主题名称
    const topic = this.getTopicName(subscription);

    // Bybit 订阅消息格式
    return {
      op: 'subscribe',
      args: [topic],
    };
  }

  /**
   * 生成取消订阅消息
   * @param subscription - 订阅信息
   */
  protected generateUnsubscribeMessage(
    subscription: { channel: string; symbol?: string; params?: Record<string, unknown> }
  ): Record<string, unknown> {
    // 生成主题名称
    const topic = this.getTopicName(subscription);

    // Bybit 取消订阅消息格式
    return {
      op: 'unsubscribe',
      args: [topic],
    };
  }

  /**
   * 根据订阅信息生成主题名称
   * Bybit V5 主题格式：<channel>.<symbol>
   * @param subscription - 订阅信息
   */
  private getTopicName(
    subscription: { channel: string; symbol?: string; params?: Record<string, unknown> }
  ): string {
    // 转换交易对格式：BTC/USDT:USDT -> BTCUSDT
    const symbol = subscription.symbol
      ? subscription.symbol.replace('/', '').replace(':USDT', '')
      : '';

    // 根据频道类型生成主题名称
    switch (subscription.channel) {
      case 'ticker':
        // 行情主题
        return `tickers.${symbol}`;

      case 'orderbook':
        // 订单簿主题
        // 深度选项：1, 50, 200, 500
        const depth = (subscription.params?.depth as number) ?? 50;
        return `orderbook.${depth}.${symbol}`;

      case 'trade':
        // 成交主题
        return `publicTrade.${symbol}`;

      case 'kline':
        // K线主题
        const timeframe = (subscription.params?.timeframe as string) ?? '1';
        // Bybit 使用分钟数：1, 3, 5, 15, 30, 60, 120, 240, 360, 720, D, W, M
        const interval = this.convertTimeframe(timeframe);
        return `kline.${interval}.${symbol}`;

      case 'orders':
        // 订单更新（私有）
        return 'order';

      case 'positions':
        // 持仓更新（私有）
        return 'position';

      case 'balance':
        // 余额更新（私有）
        return 'wallet';

      default:
        // 未知频道
        return subscription.channel;
    }
  }

  /**
   * 转换时间周期格式
   * 将通用格式转换为 Bybit 格式
   * @param timeframe - 通用时间周期
   */
  private convertTimeframe(timeframe: string): string {
    // 时间周期映射
    const map: Record<string, string> = {
      '1m': '1',
      '3m': '3',
      '5m': '5',
      '15m': '15',
      '30m': '30',
      '1h': '60',
      '2h': '120',
      '4h': '240',
      '6h': '360',
      '12h': '720',
      '1d': 'D',
      '1w': 'W',
      '1M': 'M',
    };

    return map[timeframe] ?? '1';
  }

  // ========================================================================
  // WebSocket 消息解析
  // ========================================================================

  /**
   * 解析 WebSocket 消息
   * 将 Bybit 原始消息转换为统一格式
   * @param data - 原始消息字符串
   */
  protected parseWsMessage(data: string): WsMessage | null {
    try {
      // 解析 JSON
      const message = JSON.parse(data) as Record<string, unknown>;

      // 检查是否为 pong 消息
      if (message.op === 'pong') {
        return null; // 心跳响应，不处理
      }

      // 检查是否为订阅确认
      if (message.op === 'subscribe' && message.success === true) {
        return {
          type: 'subscribed',
          data: message,
          timestamp: Date.now(),
        };
      }

      // 检查是否为认证确认
      if (message.op === 'auth' && message.success === true) {
        return {
          type: 'connected',
          data: message,
          timestamp: Date.now(),
        };
      }

      // 检查是否为错误
      if (message.success === false) {
        return {
          type: 'error',
          data: message.ret_msg ?? 'Unknown error',
          timestamp: Date.now(),
        };
      }

      // 获取主题
      const topic = message.topic as string | undefined;

      if (!topic) {
        return null;
      }

      // 根据主题前缀解析
      if (topic.startsWith('tickers.')) {
        return this.parseTickerMessage(message);
      }

      if (topic.startsWith('orderbook.')) {
        return this.parseOrderBookMessage(message);
      }

      if (topic.startsWith('publicTrade.')) {
        return this.parseTradeMessage(message);
      }

      if (topic.startsWith('kline.')) {
        return this.parseKlineMessage(message);
      }

      if (topic === 'order') {
        return this.parseOrderUpdateMessage(message);
      }

      if (topic === 'position') {
        return this.parsePositionUpdateMessage(message);
      }

      if (topic === 'wallet') {
        return this.parseWalletUpdateMessage(message);
      }

      // 未知主题
      return null;
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
      return null;
    }
  }

  /**
   * 解析行情消息
   */
  private parseTickerMessage(message: Record<string, unknown>): WsMessage {
    // 数据在 data 字段中
    const data = message.data as Record<string, unknown>;

    // 提取并转换数据
    const ticker = {
      symbol: this.normalizeSymbol(data.symbol as string),
      last: parseFloat(data.lastPrice as string),
      bid: parseFloat(data.bid1Price as string),
      bidVolume: parseFloat(data.bid1Size as string),
      ask: parseFloat(data.ask1Price as string),
      askVolume: parseFloat(data.ask1Size as string),
      open: parseFloat(data.prevPrice24h as string),
      high: parseFloat(data.highPrice24h as string),
      low: parseFloat(data.lowPrice24h as string),
      close: parseFloat(data.lastPrice as string),
      change: parseFloat(data.price24hPcnt as string) * parseFloat(data.prevPrice24h as string),
      percentage: parseFloat(data.price24hPcnt as string) * 100,
      baseVolume: parseFloat(data.volume24h as string),
      quoteVolume: parseFloat(data.turnover24h as string),
      timestamp: message.ts as number,
      info: message,
    };

    return {
      type: 'ticker',
      symbol: ticker.symbol,
      data: ticker,
      timestamp: ticker.timestamp,
    };
  }

  /**
   * 解析订单簿消息
   */
  private parseOrderBookMessage(message: Record<string, unknown>): WsMessage {
    // 数据在 data 字段中
    const data = message.data as Record<string, unknown>;

    // 解析买卖盘
    const bids = (data.b as string[][]).map((bid): [number, number] => [
      parseFloat(bid[0]!),
      parseFloat(bid[1]!),
    ]);

    const asks = (data.a as string[][]).map((ask): [number, number] => [
      parseFloat(ask[0]!),
      parseFloat(ask[1]!),
    ]);

    // 从主题中提取交易对
    const topic = message.topic as string;
    const symbolPart = topic.split('.')[2] ?? '';

    const orderbook = {
      symbol: this.normalizeSymbol(symbolPart),
      bids,
      asks,
      timestamp: message.ts as number,
      nonce: data.u as number,
    };

    return {
      type: 'orderbook',
      symbol: orderbook.symbol,
      data: orderbook,
      timestamp: orderbook.timestamp,
    };
  }

  /**
   * 解析成交消息
   */
  private parseTradeMessage(message: Record<string, unknown>): WsMessage {
    // 数据在 data 字段中（数组）
    const dataArray = message.data as Array<Record<string, unknown>>;
    const data = dataArray[0]!;

    const trade = {
      id: data.i as string,
      orderId: '',
      symbol: this.normalizeSymbol(data.s as string),
      side: (data.S as string).toLowerCase() as 'buy' | 'sell',
      price: parseFloat(data.p as string),
      amount: parseFloat(data.v as string),
      cost: parseFloat(data.p as string) * parseFloat(data.v as string),
      fee: null,
      maker: data.L === 'EMPTY', // Bybit 不直接提供 maker 信息
      timestamp: data.T as number,
      info: data,
    };

    return {
      type: 'trade',
      symbol: trade.symbol,
      data: trade,
      timestamp: trade.timestamp,
    };
  }

  /**
   * 解析 K线消息
   */
  private parseKlineMessage(message: Record<string, unknown>): WsMessage {
    // 数据在 data 字段中（数组）
    const dataArray = message.data as Array<Record<string, unknown>>;
    const data = dataArray[0]!;

    // 从主题中提取交易对
    const topic = message.topic as string;
    const parts = topic.split('.');
    const symbolPart = parts[2] ?? '';

    const kline = {
      symbol: this.normalizeSymbol(symbolPart),
      timestamp: data.start as number,
      open: parseFloat(data.open as string),
      high: parseFloat(data.high as string),
      low: parseFloat(data.low as string),
      close: parseFloat(data.close as string),
      volume: parseFloat(data.volume as string),
    };

    return {
      type: 'kline',
      symbol: kline.symbol,
      data: kline,
      timestamp: kline.timestamp,
    };
  }

  /**
   * 解析订单更新消息
   */
  private parseOrderUpdateMessage(message: Record<string, unknown>): WsMessage {
    // 数据在 data 字段中（数组）
    const dataArray = message.data as Array<Record<string, unknown>>;
    const data = dataArray[0]!;

    // 转换订单状态
    const statusMap: Record<string, OrderResult['status']> = {
      Created: 'pending',
      New: 'open',
      PartiallyFilled: 'partially_filled',
      Filled: 'filled',
      Cancelled: 'canceled',
      Rejected: 'rejected',
      Deactivated: 'canceled',
    };

    // 转换订单类型
    const typeMap: Record<string, OrderResult['type']> = {
      Market: 'market',
      Limit: 'limit',
    };

    const order: OrderResult = {
      id: data.orderId as string,
      clientOrderId: data.orderLinkId as string,
      symbol: this.normalizeSymbol(data.symbol as string),
      side: (data.side as string).toLowerCase() as 'buy' | 'sell',
      type: typeMap[data.orderType as string] ?? 'limit',
      status: statusMap[data.orderStatus as string] ?? 'open',
      price: parseFloat(data.price as string) || null,
      amount: parseFloat(data.qty as string),
      filled: parseFloat(data.cumExecQty as string),
      remaining: parseFloat(data.leavesQty as string),
      average: parseFloat(data.avgPrice as string) || null,
      cost: parseFloat(data.cumExecValue as string),
      fee: {
        cost: parseFloat(data.cumExecFee as string) || 0,
        currency: 'USDT',
      },
      timestamp: parseInt(data.createdTime as string, 10),
      datetime: new Date(parseInt(data.createdTime as string, 10)).toISOString(),
      lastUpdateTimestamp: parseInt(data.updatedTime as string, 10),
      reduceOnly: data.reduceOnly as boolean,
      info: data,
    };

    return {
      type: 'order',
      symbol: order.symbol,
      data: order,
      timestamp: order.timestamp,
    };
  }

  /**
   * 解析持仓更新消息
   */
  private parsePositionUpdateMessage(message: Record<string, unknown>): WsMessage {
    // 数据在 data 字段中（数组）
    const dataArray = message.data as Array<Record<string, unknown>>;
    const data = dataArray[0]!;

    const position: Position = {
      symbol: this.normalizeSymbol(data.symbol as string),
      side: (data.side as string) === 'Buy' ? 'long' : 'short',
      amount: Math.abs(parseFloat(data.size as string)),
      contracts: Math.abs(parseFloat(data.size as string)),
      entryPrice: parseFloat(data.entryPrice as string),
      markPrice: parseFloat(data.markPrice as string),
      liquidationPrice: parseFloat(data.liqPrice as string) || null,
      unrealizedPnl: parseFloat(data.unrealisedPnl as string),
      realizedPnl: parseFloat(data.cumRealisedPnl as string),
      percentage: 0, // 需要计算
      marginMode: (data.tradeMode as number) === 0 ? 'cross' : 'isolated',
      leverage: parseFloat(data.leverage as string),
      margin: parseFloat(data.positionMM as string),
      maintenanceMargin: parseFloat(data.positionMM as string),
      initialMargin: parseFloat(data.positionIM as string),
      notional: parseFloat(data.positionValue as string),
      timestamp: message.ts as number,
      info: data,
    };

    return {
      type: 'position',
      symbol: position.symbol,
      data: position,
      timestamp: position.timestamp,
    };
  }

  /**
   * 解析钱包更新消息
   */
  private parseWalletUpdateMessage(message: Record<string, unknown>): WsMessage {
    // 数据在 data 字段中（数组）
    const dataArray = message.data as Array<Record<string, unknown>>;
    const data = dataArray[0]!;

    // 解析币种余额
    const coins = data.coin as Array<Record<string, unknown>>;
    const currencies: Record<string, BalanceItem> = {};
    let totalEquity = 0;
    let unrealizedPnl = 0;

    for (const coin of coins) {
      const currency = coin.coin as string;
      const walletBalance = parseFloat(coin.walletBalance as string);
      const availableBalance = parseFloat(coin.availableToWithdraw as string);
      const usedBalance = walletBalance - availableBalance;

      currencies[currency] = {
        currency,
        free: availableBalance,
        used: usedBalance,
        total: walletBalance,
      };

      // 累加 USDT 计价的权益
      if (currency === 'USDT') {
        totalEquity = parseFloat(coin.equity as string);
        unrealizedPnl = parseFloat(coin.unrealisedPnl as string);
      }
    }

    const balance: Balance = {
      currencies,
      totalEquity,
      availableMargin: currencies['USDT']?.free ?? 0,
      usedMargin: currencies['USDT']?.used ?? 0,
      unrealizedPnl,
      timestamp: message.ts as number,
      info: data,
    };

    return {
      type: 'balance',
      data: balance,
      timestamp: balance.timestamp,
    };
  }

  /**
   * 标准化交易对符号
   * 将 Bybit 格式（BTCUSDT）转换为统一格式（BTC/USDT:USDT）
   * @param bybitSymbol - Bybit 交易对符号
   */
  private normalizeSymbol(bybitSymbol: string): string {
    // 移除 USDT 后缀，添加斜杠
    if (bybitSymbol.endsWith('USDT')) {
      const base = bybitSymbol.slice(0, -4);
      return `${base}/USDT:USDT`;
    }

    return bybitSymbol;
  }

  // ========================================================================
  // 数据转换方法
  // ========================================================================

  /**
   * 转换订单为统一格式
   * @param rawOrder - CCXT 返回的原始订单
   */
  protected transformOrder(rawOrder: unknown): OrderResult {
    // CCXT 订单对象
    const order = rawOrder as ccxt.Order;

    // 转换订单状态
    const statusMap: Record<string, OrderResult['status']> = {
      open: 'open',
      closed: 'filled',
      canceled: 'canceled',
      expired: 'expired',
      rejected: 'rejected',
    };

    return {
      id: order.id,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side as 'buy' | 'sell',
      type: order.type as OrderResult['type'],
      status: statusMap[order.status] ?? 'open',
      price: order.price,
      amount: order.amount,
      filled: order.filled,
      remaining: order.remaining,
      average: order.average,
      cost: order.cost,
      fee: order.fee
        ? { cost: order.fee.cost ?? 0, currency: order.fee.currency ?? 'USDT' }
        : null,
      timestamp: order.timestamp,
      datetime: order.datetime,
      lastUpdateTimestamp: order.lastUpdateTimestamp,
      reduceOnly: (order.info as Record<string, unknown>)?.reduceOnly as boolean,
      info: order.info,
    };
  }

  /**
   * 转换持仓为统一格式
   * @param rawPosition - CCXT 返回的原始持仓
   */
  protected transformPosition(rawPosition: unknown): Position {
    // CCXT 持仓对象
    const pos = rawPosition as ccxt.Position;

    return {
      symbol: pos.symbol,
      side: (pos.side as string) === 'long' ? 'long' : 'short',
      amount: Math.abs(pos.contracts ?? 0),
      contracts: Math.abs(pos.contracts ?? 0),
      entryPrice: pos.entryPrice ?? 0,
      markPrice: pos.markPrice ?? 0,
      liquidationPrice: pos.liquidationPrice,
      unrealizedPnl: pos.unrealizedPnl ?? 0,
      realizedPnl: pos.realizedPnl ?? 0,
      percentage: pos.percentage ?? 0,
      marginMode: (pos.marginMode as 'cross' | 'isolated') ?? 'cross',
      leverage: pos.leverage ?? 1,
      margin: pos.collateral ?? 0,
      maintenanceMargin: pos.maintenanceMargin,
      initialMargin: pos.initialMargin,
      notional: pos.notional ?? 0,
      timestamp: pos.timestamp ?? Date.now(),
      info: pos.info,
    };
  }

  /**
   * 转换余额为统一格式
   * @param rawBalance - CCXT 返回的原始余额
   */
  protected transformBalance(rawBalance: unknown): Balance {
    // CCXT 余额对象
    const bal = rawBalance as ccxt.Balances;

    // 构建各币种余额
    const currencies: Record<string, BalanceItem> = {};

    for (const [currency, data] of Object.entries(bal)) {
      if (typeof data !== 'object' || !data) continue;
      if (!('free' in data)) continue;

      const balanceData = data as { free: number; used: number; total: number };

      if (balanceData.total > 0) {
        currencies[currency] = {
          currency,
          free: balanceData.free ?? 0,
          used: balanceData.used ?? 0,
          total: balanceData.total ?? 0,
        };
      }
    }

    const usdtBalance = currencies['USDT'];
    const info = bal.info as Record<string, unknown> | undefined;

    return {
      currencies,
      totalEquity: usdtBalance?.total ?? 0,
      availableMargin: usdtBalance?.free ?? 0,
      usedMargin: usdtBalance?.used ?? 0,
      unrealizedPnl: 0,
      timestamp: Date.now(),
      info: bal.info,
    };
  }

  /**
   * 转换资金费率为统一格式
   * @param rawFundingRate - CCXT 返回的原始资金费率
   */
  protected transformFundingRate(rawFundingRate: unknown): FundingRate {
    // CCXT 资金费率对象
    const fr = rawFundingRate as ccxt.FundingRate;

    return {
      symbol: fr.symbol,
      fundingRate: fr.fundingRate ?? 0,
      nextFundingRate: fr.nextFundingRate ?? null,
      fundingTimestamp: fr.fundingTimestamp ?? Date.now(),
      nextFundingTimestamp: fr.nextFundingTimestamp ?? null,
      interval: 8 * 60 * 60 * 1000, // Bybit 8 小时结算
      markPrice: fr.markPrice ?? 0,
      indexPrice: fr.indexPrice ?? 0,
      info: fr.info,
    };
  }
}
