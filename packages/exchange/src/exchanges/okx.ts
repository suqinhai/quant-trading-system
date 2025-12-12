// ============================================================================
// OKX 交易所适配器
// 实现 OKX V5 API 的 REST 和 WebSocket 接口
// ============================================================================

import ccxt from 'ccxt';
import crypto from 'crypto';

import {
  BaseExchange,
} from '../base-exchange';
import {
  type ExchangeConfig,
  type OrderResult,
  type Position,
  type Balance,
  type FundingRate,
  type WsMessage,
  type BalanceItem,
} from '../schemas';

// ============================================================================
// OKX 适配器
// ============================================================================

/**
 * OKX 交易所适配器
 *
 * 特点：
 * - 使用 V5 API
 * - 支持 USDT 永续、USDC 永续、币本位永续
 * - 需要 passphrase（API 密码）
 * - WebSocket 使用 RSA 或 HMAC 签名认证
 * - 支持模拟盘（Demo Trading）
 */
export class OKX extends BaseExchange {
  // ========================================================================
  // 属性定义
  // ========================================================================

  // 交易所名称
  protected readonly exchangeName = 'okx';

  // 心跳间隔（毫秒）
  private readonly wsHeartbeatInterval = 15000; // 15 秒

  // 私有 WebSocket 心跳定时器
  private wsPrivateHeartbeatTimer: NodeJS.Timeout | null = null;

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param config - 交易所配置
   */
  constructor(config: ExchangeConfig) {
    // 验证 passphrase
    if (!config.passphrase) {
      throw new Error('OKX requires passphrase in config');
    }

    // 调用父类构造函数
    super(config);

    // 初始化 CCXT OKX 实例
    this.initializeCcxt(ccxt.pro.okx as unknown as new (config: ccxt.ExchangeConfig) => ccxt.Exchange);
  }

  // ========================================================================
  // WebSocket URL 获取
  // ========================================================================

  /**
   * 获取公共 WebSocket URL
   * OKX 公共流地址
   */
  protected getPublicWsUrl(): string {
    // 测试网（模拟盘）和主网使用不同的地址
    if (this.config.testnet || this.config.sandbox) {
      // 模拟盘地址
      return 'wss://wspap.okx.com:8443/ws/v5/public?brokerId=9999';
    }

    // 主网地址
    return 'wss://ws.okx.com:8443/ws/v5/public';
  }

  /**
   * 获取私有 WebSocket URL
   * OKX 私有流地址
   */
  protected getPrivateWsUrl(): string {
    // 测试网（模拟盘）和主网使用不同的地址
    if (this.config.testnet || this.config.sandbox) {
      // 模拟盘地址
      return 'wss://wspap.okx.com:8443/ws/v5/private?brokerId=9999';
    }

    // 主网地址
    return 'wss://ws.okx.com:8443/ws/v5/private';
  }

  // ========================================================================
  // WebSocket 认证
  // ========================================================================

  /**
   * 生成 WebSocket 认证消息
   * OKX 使用 HMAC-SHA256 签名认证
   */
  protected generateWsAuthMessage(): Record<string, unknown> {
    // 生成时间戳（秒）
    const timestamp = Math.floor(Date.now() / 1000).toString();

    // 生成签名
    // 签名内容：timestamp + 'GET' + '/users/self/verify'
    const signaturePayload = timestamp + 'GET' + '/users/self/verify';

    // 使用 HMAC-SHA256 签名，然后 Base64 编码
    const signature = crypto
      .createHmac('sha256', this.config.apiSecret)
      .update(signaturePayload)
      .digest('base64');

    // 返回认证消息
    return {
      op: 'login',
      args: [
        {
          apiKey: this.config.apiKey,       // API Key
          passphrase: this.config.passphrase, // API 密码
          timestamp: timestamp,               // 时间戳
          sign: signature,                    // 签名
        },
      ],
    };
  }

  /**
   * 连接私有 WebSocket
   * 重写父类方法，添加心跳管理
   */
  async connectPrivateWs(): Promise<void> {
    // 调用父类方法建立连接
    await super.connectPrivateWs();

    // 启动 OKX 特有的心跳（ping 字符串）
    this.startOkxHeartbeat();
  }

  /**
   * 启动 OKX WebSocket 心跳
   * OKX 需要发送 "ping" 字符串作为心跳
   */
  private startOkxHeartbeat(): void {
    // 清除之前的定时器
    if (this.wsPrivateHeartbeatTimer) {
      clearInterval(this.wsPrivateHeartbeatTimer);
    }

    // 每 15 秒发送一次 ping
    this.wsPrivateHeartbeatTimer = setInterval(() => {
      if (this.wsPrivate && this.wsPrivate.readyState === 1) { // WebSocket.OPEN
        // OKX 使用 "ping" 字符串作为心跳
        this.wsPrivate.send('ping');
      }
    }, this.wsHeartbeatInterval);
  }

  /**
   * 停止 OKX 心跳
   */
  private stopOkxHeartbeat(): void {
    if (this.wsPrivateHeartbeatTimer) {
      clearInterval(this.wsPrivateHeartbeatTimer);
      this.wsPrivateHeartbeatTimer = null;
    }
  }

  // ========================================================================
  // WebSocket 订阅消息生成
  // ========================================================================

  /**
   * 生成订阅消息
   * OKX 使用 subscribe 操作订阅
   * @param subscription - 订阅信息
   */
  protected generateSubscribeMessage(
    subscription: { channel: string; symbol?: string; params?: Record<string, unknown>; isPrivate?: boolean }
  ): Record<string, unknown> {
    // 生成订阅参数
    const args = this.getSubscriptionArgs(subscription);

    // OKX 订阅消息格式
    return {
      op: 'subscribe',
      args: [args],
    };
  }

  /**
   * 生成取消订阅消息
   * @param subscription - 订阅信息
   */
  protected generateUnsubscribeMessage(
    subscription: { channel: string; symbol?: string; params?: Record<string, unknown>; isPrivate?: boolean }
  ): Record<string, unknown> {
    // 生成订阅参数
    const args = this.getSubscriptionArgs(subscription);

    // OKX 取消订阅消息格式
    return {
      op: 'unsubscribe',
      args: [args],
    };
  }

  /**
   * 根据订阅信息生成订阅参数
   * OKX 使用对象格式的订阅参数
   * @param subscription - 订阅信息
   */
  private getSubscriptionArgs(
    subscription: { channel: string; symbol?: string; params?: Record<string, unknown>; isPrivate?: boolean }
  ): Record<string, unknown> {
    // 转换交易对格式：BTC/USDT:USDT -> BTC-USDT-SWAP
    const instId = subscription.symbol
      ? this.toOkxSymbol(subscription.symbol)
      : undefined;

    // 根据频道类型生成参数
    switch (subscription.channel) {
      case 'ticker':
        // 行情频道
        return {
          channel: 'tickers',
          instId,
        };

      case 'orderbook':
        // 订单簿频道
        // OKX 支持：books（400档）、books5（5档）、books-l2-tbt（400档逐笔）、books50-l2-tbt（50档逐笔）
        const depth = (subscription.params?.depth as number) ?? 5;
        const channel = depth <= 5 ? 'books5' : 'books';
        return {
          channel,
          instId,
        };

      case 'trade':
        // 成交频道
        return {
          channel: 'trades',
          instId,
        };

      case 'kline':
        // K线频道
        const timeframe = (subscription.params?.timeframe as string) ?? '1m';
        // OKX 格式：candle1m, candle5m, candle1H, candle1D 等
        const candleChannel = `candle${this.convertTimeframe(timeframe)}`;
        return {
          channel: candleChannel,
          instId,
        };

      case 'orders':
        // 订单更新（私有）
        return {
          channel: 'orders',
          instType: 'SWAP', // 永续合约
        };

      case 'positions':
        // 持仓更新（私有）
        return {
          channel: 'positions',
          instType: 'SWAP',
        };

      case 'balance':
        // 账户余额（私有）
        return {
          channel: 'account',
        };

      default:
        // 未知频道
        return {
          channel: subscription.channel,
          instId,
        };
    }
  }

  /**
   * 将统一交易对格式转换为 OKX 格式
   * BTC/USDT:USDT -> BTC-USDT-SWAP
   * @param symbol - 统一交易对符号
   */
  private toOkxSymbol(symbol: string): string {
    // 解析统一格式
    // 格式：BASE/QUOTE:SETTLE 或 BASE/QUOTE
    const parts = symbol.split(':');
    const baseQuote = parts[0]!.split('/');
    const base = baseQuote[0];
    const quote = baseQuote[1];

    // 永续合约格式：BTC-USDT-SWAP
    return `${base}-${quote}-SWAP`;
  }

  /**
   * 将 OKX 交易对格式转换为统一格式
   * BTC-USDT-SWAP -> BTC/USDT:USDT
   * @param okxSymbol - OKX 交易对符号
   */
  private normalizeSymbol(okxSymbol: string): string {
    // 解析 OKX 格式
    // 格式：BASE-QUOTE-SWAP
    const parts = okxSymbol.split('-');

    if (parts.length >= 2) {
      const base = parts[0];
      const quote = parts[1];
      return `${base}/${quote}:${quote}`;
    }

    return okxSymbol;
  }

  /**
   * 转换时间周期格式
   * 将通用格式转换为 OKX 格式
   * @param timeframe - 通用时间周期
   */
  private convertTimeframe(timeframe: string): string {
    // 时间周期映射
    const map: Record<string, string> = {
      '1m': '1m',
      '3m': '3m',
      '5m': '5m',
      '15m': '15m',
      '30m': '30m',
      '1h': '1H',
      '2h': '2H',
      '4h': '4H',
      '6h': '6H',
      '12h': '12H',
      '1d': '1D',
      '1w': '1W',
      '1M': '1M',
    };

    return map[timeframe] ?? '1m';
  }

  // ========================================================================
  // WebSocket 消息解析
  // ========================================================================

  /**
   * 解析 WebSocket 消息
   * 将 OKX 原始消息转换为统一格式
   * @param data - 原始消息字符串
   */
  protected parseWsMessage(data: string): WsMessage | null {
    // 检查是否为 pong 消息
    if (data === 'pong') {
      return null; // 心跳响应，不处理
    }

    try {
      // 解析 JSON
      const message = JSON.parse(data) as Record<string, unknown>;

      // 检查事件类型
      const event = message.event as string | undefined;

      // 登录成功
      if (event === 'login' && message.code === '0') {
        return {
          type: 'connected',
          data: message,
          timestamp: Date.now(),
        };
      }

      // 订阅成功
      if (event === 'subscribe') {
        return {
          type: 'subscribed',
          data: message,
          timestamp: Date.now(),
        };
      }

      // 错误
      if (event === 'error' || message.code !== undefined && message.code !== '0') {
        return {
          type: 'error',
          data: message.msg ?? message.data,
          timestamp: Date.now(),
        };
      }

      // 获取频道
      const arg = message.arg as Record<string, unknown> | undefined;
      const channel = arg?.channel as string | undefined;

      if (!channel) {
        return null;
      }

      // 根据频道解析
      if (channel === 'tickers') {
        return this.parseTickerMessage(message);
      }

      if (channel === 'books5' || channel === 'books') {
        return this.parseOrderBookMessage(message);
      }

      if (channel === 'trades') {
        return this.parseTradeMessage(message);
      }

      if (channel.startsWith('candle')) {
        return this.parseKlineMessage(message);
      }

      if (channel === 'orders') {
        return this.parseOrderUpdateMessage(message);
      }

      if (channel === 'positions') {
        return this.parsePositionUpdateMessage(message);
      }

      if (channel === 'account') {
        return this.parseAccountUpdateMessage(message);
      }

      // 未知频道
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
    // 数据在 data 字段中（数组）
    const dataArray = message.data as Array<Record<string, unknown>>;
    const data = dataArray[0]!;

    const ticker = {
      symbol: this.normalizeSymbol(data.instId as string),
      last: parseFloat(data.last as string),
      bid: parseFloat(data.bidPx as string),
      bidVolume: parseFloat(data.bidSz as string),
      ask: parseFloat(data.askPx as string),
      askVolume: parseFloat(data.askSz as string),
      open: parseFloat(data.open24h as string),
      high: parseFloat(data.high24h as string),
      low: parseFloat(data.low24h as string),
      close: parseFloat(data.last as string),
      change: parseFloat(data.last as string) - parseFloat(data.open24h as string),
      percentage: ((parseFloat(data.last as string) - parseFloat(data.open24h as string)) / parseFloat(data.open24h as string)) * 100,
      baseVolume: parseFloat(data.vol24h as string),
      quoteVolume: parseFloat(data.volCcy24h as string),
      timestamp: parseInt(data.ts as string, 10),
      info: data,
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
    // 数据在 data 字段中（数组）
    const dataArray = message.data as Array<Record<string, unknown>>;
    const data = dataArray[0]!;
    const arg = message.arg as Record<string, unknown>;

    // 解析买卖盘
    // OKX 格式：[[price, size, liquidatedOrders, orders], ...]
    const bids = (data.bids as string[][]).map((bid): [number, number] => [
      parseFloat(bid[0]!),
      parseFloat(bid[1]!),
    ]);

    const asks = (data.asks as string[][]).map((ask): [number, number] => [
      parseFloat(ask[0]!),
      parseFloat(ask[1]!),
    ]);

    const orderbook = {
      symbol: this.normalizeSymbol(arg.instId as string),
      bids,
      asks,
      timestamp: parseInt(data.ts as string, 10),
      nonce: data.seqId as number,
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
      id: data.tradeId as string,
      orderId: '',
      symbol: this.normalizeSymbol(data.instId as string),
      side: (data.side as string).toLowerCase() as 'buy' | 'sell',
      price: parseFloat(data.px as string),
      amount: parseFloat(data.sz as string),
      cost: parseFloat(data.px as string) * parseFloat(data.sz as string),
      fee: null,
      maker: false, // OKX 不提供此信息
      timestamp: parseInt(data.ts as string, 10),
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
    const dataArray = message.data as Array<string[]>;
    const data = dataArray[0]!;
    const arg = message.arg as Record<string, unknown>;

    // OKX K线格式：[ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
    const kline = {
      symbol: this.normalizeSymbol(arg.instId as string),
      timestamp: parseInt(data[0]!, 10),
      open: parseFloat(data[1]!),
      high: parseFloat(data[2]!),
      low: parseFloat(data[3]!),
      close: parseFloat(data[4]!),
      volume: parseFloat(data[5]!),
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
      live: 'open',
      partially_filled: 'partially_filled',
      filled: 'filled',
      canceled: 'canceled',
    };

    // 转换订单类型
    const typeMap: Record<string, OrderResult['type']> = {
      market: 'market',
      limit: 'limit',
      post_only: 'limit',
      fok: 'limit',
      ioc: 'limit',
    };

    const order: OrderResult = {
      id: data.ordId as string,
      clientOrderId: data.clOrdId as string,
      symbol: this.normalizeSymbol(data.instId as string),
      side: (data.side as string).toLowerCase() as 'buy' | 'sell',
      type: typeMap[data.ordType as string] ?? 'limit',
      status: statusMap[data.state as string] ?? 'open',
      price: parseFloat(data.px as string) || null,
      amount: parseFloat(data.sz as string),
      filled: parseFloat(data.accFillSz as string),
      remaining: parseFloat(data.sz as string) - parseFloat(data.accFillSz as string),
      average: parseFloat(data.avgPx as string) || null,
      cost: parseFloat(data.accFillSz as string) * (parseFloat(data.avgPx as string) || 0),
      fee: {
        cost: Math.abs(parseFloat(data.fee as string) || 0),
        currency: data.feeCcy as string || 'USDT',
      },
      timestamp: parseInt(data.cTime as string, 10),
      datetime: new Date(parseInt(data.cTime as string, 10)).toISOString(),
      lastUpdateTimestamp: parseInt(data.uTime as string, 10),
      reduceOnly: data.reduceOnly === 'true',
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

    // 确定持仓方向
    const positionSide = data.posSide as string;
    let side: 'long' | 'short';
    if (positionSide === 'long') {
      side = 'long';
    } else if (positionSide === 'short') {
      side = 'short';
    } else {
      // net 模式，根据持仓数量判断
      side = parseFloat(data.pos as string) >= 0 ? 'long' : 'short';
    }

    const position: Position = {
      symbol: this.normalizeSymbol(data.instId as string),
      side,
      amount: Math.abs(parseFloat(data.pos as string)),
      contracts: Math.abs(parseFloat(data.pos as string)),
      entryPrice: parseFloat(data.avgPx as string),
      markPrice: parseFloat(data.markPx as string) || 0,
      liquidationPrice: parseFloat(data.liqPx as string) || null,
      unrealizedPnl: parseFloat(data.upl as string),
      realizedPnl: parseFloat(data.realizedPnl as string) || 0,
      percentage: parseFloat(data.uplRatio as string) * 100,
      marginMode: (data.mgnMode as string) === 'cross' ? 'cross' : 'isolated',
      leverage: parseFloat(data.lever as string),
      margin: parseFloat(data.margin as string) || 0,
      notional: parseFloat(data.notionalUsd as string),
      timestamp: parseInt(data.uTime as string, 10),
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
   * 解析账户更新消息
   */
  private parseAccountUpdateMessage(message: Record<string, unknown>): WsMessage {
    // 数据在 data 字段中（数组）
    const dataArray = message.data as Array<Record<string, unknown>>;
    const data = dataArray[0]!;

    // 解析各币种余额
    const details = data.details as Array<Record<string, unknown>>;
    const currencies: Record<string, BalanceItem> = {};
    let totalEquity = 0;
    let unrealizedPnl = 0;

    for (const detail of details) {
      const currency = detail.ccy as string;
      const equity = parseFloat(detail.eq as string);
      const available = parseFloat(detail.availBal as string);
      const frozen = parseFloat(detail.frozenBal as string);

      currencies[currency] = {
        currency,
        free: available,
        used: frozen,
        total: equity,
      };

      // USDT 为主要计价货币
      if (currency === 'USDT') {
        unrealizedPnl = parseFloat(detail.upl as string) || 0;
      }
    }

    // 总权益
    totalEquity = parseFloat(data.totalEq as string);

    const balance: Balance = {
      currencies,
      totalEquity,
      availableMargin: currencies['USDT']?.free ?? 0,
      usedMargin: currencies['USDT']?.used ?? 0,
      marginRatio: parseFloat(data.mgnRatio as string) || undefined,
      unrealizedPnl,
      timestamp: parseInt(data.uTime as string, 10),
      info: data,
    };

    return {
      type: 'balance',
      data: balance,
      timestamp: balance.timestamp,
    };
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
      reduceOnly: (order.info as Record<string, unknown>)?.reduceOnly === 'true',
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
      interval: 8 * 60 * 60 * 1000, // OKX 8 小时结算
      markPrice: fr.markPrice ?? 0,
      indexPrice: fr.indexPrice ?? 0,
      info: fr.info,
    };
  }

  // ========================================================================
  // 清理方法
  // ========================================================================

  /**
   * 断开连接
   * 重写父类方法，添加心跳清理
   */
  async disconnect(): Promise<void> {
    // 停止 OKX 心跳
    this.stopOkxHeartbeat();

    // 调用父类断开连接
    await super.disconnect();
  }
}
