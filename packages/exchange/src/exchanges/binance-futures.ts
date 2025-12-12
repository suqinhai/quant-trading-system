// ============================================================================
// Binance Futures 交易所适配器
// 实现 Binance USDT 永续合约的 REST API 和 WebSocket 接口
// ============================================================================

import ccxt from 'ccxt';

import {
  BaseExchange,
  type ExchangeEvents,
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
// Binance Futures 适配器
// ============================================================================

/**
 * Binance Futures（币安合约）交易所适配器
 *
 * 特点：
 * - 支持 USDT 永续合约（USDT-M Futures）
 * - 支持 COIN 永续合约（COIN-M Futures）
 * - 双向持仓模式支持
 * - listenKey 机制的私有 WebSocket
 */
export class BinanceFutures extends BaseExchange {
  // ========================================================================
  // 属性定义
  // ========================================================================

  // 交易所名称
  protected readonly exchangeName = 'binance_futures';

  // listenKey（私有 WebSocket 需要）
  private listenKey: string | null = null;

  // listenKey 刷新定时器
  private listenKeyTimer: NodeJS.Timeout | null = null;

  // listenKey 刷新间隔（30分钟）
  private readonly listenKeyRefreshInterval = 30 * 60 * 1000;

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

    // 初始化 CCXT Binance 实例
    // 使用 binanceusdm 类处理 USDT 永续合约
    this.initializeCcxt(ccxt.pro.binanceusdm as unknown as new (config: ccxt.ExchangeConfig) => ccxt.Exchange);
  }

  // ========================================================================
  // WebSocket URL 获取
  // ========================================================================

  /**
   * 获取公共 WebSocket URL
   * Binance 公共流地址
   */
  protected getPublicWsUrl(): string {
    // 测试网和主网使用不同的地址
    if (this.config.testnet) {
      // 测试网地址
      return 'wss://stream.binancefuture.com/ws';
    }

    // 主网地址
    return 'wss://fstream.binance.com/ws';
  }

  /**
   * 获取私有 WebSocket URL
   * Binance 需要使用 listenKey 建立私有连接
   */
  protected getPrivateWsUrl(): string {
    // 确保 listenKey 已获取
    if (!this.listenKey) {
      throw new Error('listenKey not available, call getListenKey() first');
    }

    // 测试网和主网使用不同的地址
    if (this.config.testnet) {
      return `wss://stream.binancefuture.com/ws/${this.listenKey}`;
    }

    return `wss://fstream.binance.com/ws/${this.listenKey}`;
  }

  // ========================================================================
  // listenKey 管理
  // ========================================================================

  /**
   * 获取 listenKey
   * listenKey 是 Binance 私有 WebSocket 的认证凭证
   */
  async getListenKey(): Promise<string> {
    // 确保 CCXT 已初始化
    if (!this.ccxt) {
      throw new Error('Exchange not initialized');
    }

    // 获取限频许可
    await this.rateLimiter.acquire();

    try {
      // 调用 Binance API 获取 listenKey
      // POST /fapi/v1/listenKey
      const response = await this.ccxt.fapiPrivatePostListenKey();

      // 提取 listenKey
      this.listenKey = response.listenKey as string;

      // 报告成功
      this.rateLimiter.reportSuccess();

      // 启动定期刷新
      this.startListenKeyRefresh();

      return this.listenKey;
    } catch (error) {
      this.handleApiError(error);
      throw error;
    }
  }

  /**
   * 刷新 listenKey
   * listenKey 有效期为 60 分钟，需要定期刷新
   */
  private async refreshListenKey(): Promise<void> {
    // 确保 CCXT 已初始化
    if (!this.ccxt || !this.listenKey) {
      return;
    }

    try {
      // 获取限频许可
      await this.rateLimiter.acquire();

      // 调用 Binance API 刷新 listenKey
      // PUT /fapi/v1/listenKey
      await this.ccxt.fapiPrivatePutListenKey();

      // 报告成功
      this.rateLimiter.reportSuccess();
    } catch (error) {
      // 刷新失败，尝试重新获取
      console.error('Failed to refresh listenKey, getting new one:', error);
      await this.getListenKey();
    }
  }

  /**
   * 启动 listenKey 定期刷新
   */
  private startListenKeyRefresh(): void {
    // 清除之前的定时器
    if (this.listenKeyTimer) {
      clearInterval(this.listenKeyTimer);
    }

    // 每 30 分钟刷新一次（有效期 60 分钟）
    this.listenKeyTimer = setInterval(() => {
      this.refreshListenKey().catch(console.error);
    }, this.listenKeyRefreshInterval);
  }

  /**
   * 停止 listenKey 刷新
   */
  private stopListenKeyRefresh(): void {
    if (this.listenKeyTimer) {
      clearInterval(this.listenKeyTimer);
      this.listenKeyTimer = null;
    }
  }

  // ========================================================================
  // WebSocket 认证
  // ========================================================================

  /**
   * 生成 WebSocket 认证消息
   * Binance 不需要发送认证消息，使用 listenKey 即可
   */
  protected generateWsAuthMessage(): Record<string, unknown> {
    // Binance 使用 listenKey 认证，不需要额外的认证消息
    // 返回空对象，实际上不会发送
    return {};
  }

  /**
   * 连接私有 WebSocket
   * 重写父类方法，先获取 listenKey
   */
  async connectPrivateWs(): Promise<void> {
    // 先获取 listenKey
    await this.getListenKey();

    // 然后调用父类方法建立连接
    await super.connectPrivateWs();
  }

  // ========================================================================
  // WebSocket 订阅消息生成
  // ========================================================================

  /**
   * 生成订阅消息
   * Binance 使用 SUBSCRIBE 方法订阅流
   * @param subscription - 订阅信息
   */
  protected generateSubscribeMessage(
    subscription: { channel: string; symbol?: string; params?: Record<string, unknown> }
  ): Record<string, unknown> {
    // 生成流名称
    const stream = this.getStreamName(subscription);

    // Binance 订阅消息格式
    return {
      method: 'SUBSCRIBE',
      params: [stream],
      id: Date.now(), // 使用时间戳作为请求 ID
    };
  }

  /**
   * 生成取消订阅消息
   * @param subscription - 订阅信息
   */
  protected generateUnsubscribeMessage(
    subscription: { channel: string; symbol?: string; params?: Record<string, unknown> }
  ): Record<string, unknown> {
    // 生成流名称
    const stream = this.getStreamName(subscription);

    // Binance 取消订阅消息格式
    return {
      method: 'UNSUBSCRIBE',
      params: [stream],
      id: Date.now(),
    };
  }

  /**
   * 根据订阅信息生成流名称
   * Binance 流名称格式：<symbol>@<channel>
   * @param subscription - 订阅信息
   */
  private getStreamName(
    subscription: { channel: string; symbol?: string; params?: Record<string, unknown> }
  ): string {
    // 转换交易对格式：BTC/USDT:USDT -> btcusdt
    const symbol = subscription.symbol
      ? subscription.symbol.replace('/', '').replace(':USDT', '').toLowerCase()
      : '';

    // 根据频道类型生成流名称
    switch (subscription.channel) {
      case 'ticker':
        // 24小时行情流
        return `${symbol}@ticker`;

      case 'orderbook':
        // 订单簿深度流
        // 可选深度：5, 10, 20（默认 20）
        const depth = (subscription.params?.depth as number) ?? 20;
        return `${symbol}@depth${depth}@100ms`;

      case 'trade':
        // 逐笔成交流
        return `${symbol}@aggTrade`;

      case 'kline':
        // K线流
        const timeframe = (subscription.params?.timeframe as string) ?? '1m';
        return `${symbol}@kline_${timeframe}`;

      case 'orders':
        // 订单更新（私有流，通过 listenKey 自动订阅）
        return 'ORDER_TRADE_UPDATE';

      case 'positions':
        // 持仓更新（私有流）
        return 'ACCOUNT_UPDATE';

      case 'balance':
        // 余额更新（私有流）
        return 'ACCOUNT_UPDATE';

      default:
        // 未知频道，直接使用
        return subscription.channel;
    }
  }

  // ========================================================================
  // WebSocket 消息解析
  // ========================================================================

  /**
   * 解析 WebSocket 消息
   * 将 Binance 原始消息转换为统一格式
   * @param data - 原始消息字符串
   */
  protected parseWsMessage(data: string): WsMessage | null {
    try {
      // 解析 JSON
      const message = JSON.parse(data) as Record<string, unknown>;

      // 检查是否为错误消息
      if (message.error) {
        return {
          type: 'error',
          data: message.error,
          timestamp: Date.now(),
        };
      }

      // 检查是否为订阅确认消息
      if (message.result === null && message.id) {
        return {
          type: 'subscribed',
          data: message,
          timestamp: Date.now(),
        };
      }

      // 获取事件类型
      const eventType = message.e as string | undefined;

      // 根据事件类型解析
      switch (eventType) {
        // 24小时行情
        case '24hrTicker':
          return this.parseTickerMessage(message);

        // 深度更新
        case 'depthUpdate':
          return this.parseOrderBookMessage(message);

        // 聚合成交
        case 'aggTrade':
          return this.parseTradeMessage(message);

        // K线更新
        case 'kline':
          return this.parseKlineMessage(message);

        // 订单更新
        case 'ORDER_TRADE_UPDATE':
          return this.parseOrderUpdateMessage(message);

        // 账户更新
        case 'ACCOUNT_UPDATE':
          return this.parseAccountUpdateMessage(message);

        default:
          // 未知消息类型，忽略
          return null;
      }
    } catch (error) {
      // JSON 解析失败
      console.error('Failed to parse WebSocket message:', error);
      return null;
    }
  }

  /**
   * 解析行情消息
   */
  private parseTickerMessage(message: Record<string, unknown>): WsMessage {
    // 提取并转换数据
    const ticker = {
      symbol: this.normalizeSymbol(message.s as string),
      last: parseFloat(message.c as string),
      bid: parseFloat(message.b as string),
      bidVolume: parseFloat(message.B as string),
      ask: parseFloat(message.a as string),
      askVolume: parseFloat(message.A as string),
      open: parseFloat(message.o as string),
      high: parseFloat(message.h as string),
      low: parseFloat(message.l as string),
      close: parseFloat(message.c as string),
      change: parseFloat(message.p as string),
      percentage: parseFloat(message.P as string),
      baseVolume: parseFloat(message.v as string),
      quoteVolume: parseFloat(message.q as string),
      timestamp: message.E as number,
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
    // 提取并转换数据
    const orderbook = {
      symbol: this.normalizeSymbol(message.s as string),
      bids: (message.b as string[][]).map((bid): [number, number] => [
        parseFloat(bid[0]!),
        parseFloat(bid[1]!),
      ]),
      asks: (message.a as string[][]).map((ask): [number, number] => [
        parseFloat(ask[0]!),
        parseFloat(ask[1]!),
      ]),
      timestamp: message.E as number,
      nonce: message.u as number,
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
    // 提取并转换数据
    const trade = {
      id: String(message.a), // 聚合成交 ID
      orderId: '',
      symbol: this.normalizeSymbol(message.s as string),
      side: (message.m as boolean) ? 'sell' : 'buy', // m=true 表示卖方是 maker
      price: parseFloat(message.p as string),
      amount: parseFloat(message.q as string),
      cost: parseFloat(message.p as string) * parseFloat(message.q as string),
      fee: null,
      maker: message.m as boolean,
      timestamp: message.T as number,
      info: message,
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
    // K线数据在 k 字段中
    const k = message.k as Record<string, unknown>;

    // 提取并转换数据
    const kline = {
      symbol: this.normalizeSymbol(k.s as string),
      timestamp: k.t as number,
      open: parseFloat(k.o as string),
      high: parseFloat(k.h as string),
      low: parseFloat(k.l as string),
      close: parseFloat(k.c as string),
      volume: parseFloat(k.v as string),
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
    // 订单数据在 o 字段中
    const o = message.o as Record<string, unknown>;

    // 转换订单状态
    const statusMap: Record<string, string> = {
      NEW: 'open',
      PARTIALLY_FILLED: 'partially_filled',
      FILLED: 'filled',
      CANCELED: 'canceled',
      REJECTED: 'rejected',
      EXPIRED: 'expired',
    };

    // 转换订单类型
    const typeMap: Record<string, string> = {
      MARKET: 'market',
      LIMIT: 'limit',
      STOP: 'stop',
      STOP_MARKET: 'stop',
      TAKE_PROFIT: 'take_profit',
      TAKE_PROFIT_MARKET: 'take_profit',
      TRAILING_STOP_MARKET: 'trailing_stop',
    };

    // 提取并转换数据
    const order: OrderResult = {
      id: String(o.i),
      clientOrderId: o.c as string,
      symbol: this.normalizeSymbol(o.s as string),
      side: (o.S as string).toLowerCase() as 'buy' | 'sell',
      type: (typeMap[o.o as string] ?? 'limit') as OrderResult['type'],
      status: (statusMap[o.X as string] ?? 'open') as OrderResult['status'],
      price: parseFloat(o.p as string) || null,
      amount: parseFloat(o.q as string),
      filled: parseFloat(o.z as string),
      remaining: parseFloat(o.q as string) - parseFloat(o.z as string),
      average: parseFloat(o.ap as string) || null,
      cost: parseFloat(o.z as string) * (parseFloat(o.ap as string) || 0),
      fee: {
        cost: parseFloat(o.n as string) || 0,
        currency: (o.N as string) || 'USDT',
      },
      timestamp: o.T as number,
      datetime: new Date(o.T as number).toISOString(),
      lastUpdateTimestamp: message.E as number,
      reduceOnly: o.R as boolean,
      postOnly: o.f === 'GTX',
      info: message,
    };

    return {
      type: 'order',
      symbol: order.symbol,
      data: order,
      timestamp: order.timestamp,
    };
  }

  /**
   * 解析账户更新消息
   */
  private parseAccountUpdateMessage(message: Record<string, unknown>): WsMessage | null {
    // 账户数据在 a 字段中
    const a = message.a as Record<string, unknown>;

    if (!a) {
      return null;
    }

    // 更新原因
    const updateReason = a.m as string;

    // 如果有持仓更新
    const positions = a.P as Array<Record<string, unknown>> | undefined;
    if (positions && positions.length > 0) {
      // 转换第一个持仓（通常只有一个）
      const p = positions[0]!;

      const position: Position = {
        symbol: this.normalizeSymbol(p.s as string),
        side: parseFloat(p.pa as string) >= 0 ? 'long' : 'short',
        amount: Math.abs(parseFloat(p.pa as string)),
        contracts: Math.abs(parseFloat(p.pa as string)),
        entryPrice: parseFloat(p.ep as string),
        markPrice: parseFloat(p.mp as string) || 0,
        liquidationPrice: null, // 需要单独获取
        unrealizedPnl: parseFloat(p.up as string),
        realizedPnl: 0, // 账户更新中没有
        percentage: 0, // 需要计算
        marginMode: (p.mt as string) === 'cross' ? 'cross' : 'isolated',
        leverage: 1, // 需要单独获取
        margin: parseFloat(p.iw as string) || 0,
        notional: Math.abs(parseFloat(p.pa as string)) * parseFloat(p.ep as string),
        timestamp: message.E as number,
        info: p,
      };

      return {
        type: 'position',
        symbol: position.symbol,
        data: position,
        timestamp: position.timestamp,
      };
    }

    // 如果有余额更新
    const balances = a.B as Array<Record<string, unknown>> | undefined;
    if (balances && balances.length > 0) {
      // 构建余额对象
      const currencies: Record<string, BalanceItem> = {};
      let totalEquity = 0;

      for (const b of balances) {
        const currency = b.a as string;
        const walletBalance = parseFloat(b.wb as string);
        const crossWalletBalance = parseFloat(b.cw as string);

        currencies[currency] = {
          currency,
          free: crossWalletBalance,
          used: walletBalance - crossWalletBalance,
          total: walletBalance,
        };

        // 假设 USDT 为主要计价货币
        if (currency === 'USDT') {
          totalEquity = walletBalance;
        }
      }

      const balance: Balance = {
        currencies,
        totalEquity,
        availableMargin: totalEquity, // 简化处理
        usedMargin: 0,
        unrealizedPnl: 0,
        timestamp: message.E as number,
        info: message,
      };

      return {
        type: 'balance',
        data: balance,
        timestamp: balance.timestamp,
      };
    }

    return null;
  }

  /**
   * 标准化交易对符号
   * 将 Binance 格式（BTCUSDT）转换为统一格式（BTC/USDT:USDT）
   * @param binanceSymbol - Binance 交易对符号
   */
  private normalizeSymbol(binanceSymbol: string): string {
    // 移除 USDT 后缀，添加斜杠
    // BTCUSDT -> BTC/USDT:USDT
    if (binanceSymbol.endsWith('USDT')) {
      const base = binanceSymbol.slice(0, -4);
      return `${base}/USDT:USDT`;
    }

    // 其他情况直接返回
    return binanceSymbol;
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

    // 转换订单类型
    const typeMap: Record<string, OrderResult['type']> = {
      market: 'market',
      limit: 'limit',
      stop: 'stop',
      stop_limit: 'stop_limit',
      take_profit: 'take_profit',
      take_profit_limit: 'take_profit_limit',
      trailing_stop: 'trailing_stop',
    };

    return {
      id: order.id,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side as 'buy' | 'sell',
      type: typeMap[order.type] ?? 'limit',
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
      postOnly: (order.info as Record<string, unknown>)?.timeInForce === 'GTX',
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

    // 确定持仓方向
    const side = (pos.side as string) === 'long' ? 'long' : 'short';

    return {
      symbol: pos.symbol,
      side,
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

    // 遍历所有币种
    for (const [currency, data] of Object.entries(bal)) {
      // 跳过非余额字段
      if (typeof data !== 'object' || !data) continue;
      if (!('free' in data)) continue;

      const balanceData = data as { free: number; used: number; total: number };

      // 只保留有余额的币种
      if (balanceData.total > 0) {
        currencies[currency] = {
          currency,
          free: balanceData.free ?? 0,
          used: balanceData.used ?? 0,
          total: balanceData.total ?? 0,
        };
      }
    }

    // 获取 USDT 余额作为主要权益
    const usdtBalance = currencies['USDT'];
    const totalEquity = usdtBalance?.total ?? 0;

    // 获取账户信息（如果有）
    const info = bal.info as Record<string, unknown> | undefined;

    return {
      currencies,
      totalEquity,
      availableMargin: usdtBalance?.free ?? 0,
      usedMargin: usdtBalance?.used ?? 0,
      marginRatio: info?.marginRatio as number | undefined,
      unrealizedPnl: (info?.totalUnrealizedProfit as number) ?? 0,
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
      interval: 8 * 60 * 60 * 1000, // Binance 8 小时结算
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
   * 重写父类方法，添加 listenKey 清理
   */
  async disconnect(): Promise<void> {
    // 停止 listenKey 刷新
    this.stopListenKeyRefresh();

    // 调用父类断开连接
    await super.disconnect();
  }
}
