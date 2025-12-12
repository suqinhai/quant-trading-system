// ============================================================================
// ClickHouse 数据加载器
// 高性能批量加载历史数据（trade、depth、funding）
// 支持流式加载和内存优化
// ============================================================================

import { createClient, ClickHouseClient } from '@clickhouse/client';

import {
  type ExchangeId,
  type Timestamp,
  type TradeEvent,
  type DepthEvent,
  type FundingEvent,
  type MarkPriceEvent,
  type KlineEvent,
  type BacktestEvent,
  type PriceLevel,
  type ClickHouseConfig,
} from './types';

// ============================================================================
// 数据加载器配置
// ============================================================================

// 数据加载器配置
export interface DataLoaderConfig {
  // ClickHouse 配置
  clickhouse: ClickHouseConfig;
  // 批次大小（每次查询返回的最大行数）
  batchSize: number;
  // 是否预加载（启动时一次性加载所有数据）
  preload: boolean;
  // 数据类型过滤
  dataTypes: Array<'trade' | 'depth' | 'funding' | 'markPrice' | 'kline'>;
}

// 默认数据加载器配置
export const DEFAULT_DATA_LOADER_CONFIG: Partial<DataLoaderConfig> = {
  // 批次大小 10 万条
  batchSize: 100000,
  // 不预加载（流式加载）
  preload: false,
  // 默认加载所有数据类型
  dataTypes: ['trade', 'depth', 'funding', 'markPrice'],
};

// ============================================================================
// 数据行类型（ClickHouse 返回的原始数据）
// ============================================================================

// 成交数据行
interface TradeRow {
  // 交易所
  exchange: string;
  // 交易对
  symbol: string;
  // 时间戳
  timestamp: string;
  // 成交 ID
  trade_id: string;
  // 价格
  price: string;
  // 数量
  quantity: string;
  // 是否卖方主动
  is_sell: number;
}

// 深度数据行
interface DepthRow {
  // 交易所
  exchange: string;
  // 交易对
  symbol: string;
  // 时间戳
  timestamp: string;
  // 买盘（JSON 格式）
  bids: string;
  // 卖盘（JSON 格式）
  asks: string;
}

// 资金费率数据行
interface FundingRow {
  // 交易所
  exchange: string;
  // 交易对
  symbol: string;
  // 结算时间
  funding_time: string;
  // 资金费率
  funding_rate: string;
  // 标记价格
  mark_price: string;
}

// 标记价格数据行
interface MarkPriceRow {
  // 交易所
  exchange: string;
  // 交易对
  symbol: string;
  // 时间戳
  timestamp: string;
  // 标记价格
  mark_price: string;
  // 指数价格
  index_price: string;
}

// K线数据行
interface KlineRow {
  // 交易所
  exchange: string;
  // 交易对
  symbol: string;
  // 开盘时间
  open_time: string;
  // OHLCV
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  quote_volume: string;
  trades: string;
}

// ============================================================================
// 数据加载统计
// ============================================================================

// 加载统计
export interface LoadStats {
  // 加载的事件总数
  totalEvents: number;
  // 各类型事件数量
  tradeEvents: number;
  depthEvents: number;
  fundingEvents: number;
  markPriceEvents: number;
  klineEvents: number;
  // 加载耗时（毫秒）
  loadTime: number;
  // 数据时间范围
  startTime: Timestamp;
  endTime: Timestamp;
}

// ============================================================================
// 数据加载器类
// ============================================================================

/**
 * ClickHouse 数据加载器
 * 高性能批量加载回测数据
 */
export class DataLoader {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // ClickHouse 客户端
  private client: ClickHouseClient;

  // 配置
  private config: DataLoaderConfig;

  // 是否已连接
  private connected: boolean = false;

  // 加载统计
  private stats: LoadStats = {
    totalEvents: 0,
    tradeEvents: 0,
    depthEvents: 0,
    fundingEvents: 0,
    markPriceEvents: 0,
    klineEvents: 0,
    loadTime: 0,
    startTime: 0,
    endTime: 0,
  };

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param config - 配置
   */
  constructor(config: DataLoaderConfig) {
    // 合并配置
    this.config = { ...DEFAULT_DATA_LOADER_CONFIG, ...config } as DataLoaderConfig;

    // 创建 ClickHouse 客户端
    this.client = createClient({
      // 主机地址
      host: `http://${this.config.clickhouse.host}:${this.config.clickhouse.port}`,
      // 数据库
      database: this.config.clickhouse.database,
      // 用户名
      username: this.config.clickhouse.username ?? 'default',
      // 密码
      password: this.config.clickhouse.password ?? '',
      // 连接设置
      clickhouse_settings: {
        // 查询超时（毫秒）
        max_execution_time: 300,
        // 等待队列超时
        wait_end_of_query: 1,
      },
    });
  }

  // ========================================================================
  // 公共方法 - 连接管理
  // ========================================================================

  /**
   * 连接到 ClickHouse
   */
  async connect(): Promise<void> {
    // 如果已连接，跳过
    if (this.connected) {
      return;
    }

    // 测试连接
    try {
      await this.client.ping();
      this.connected = true;
      console.log('[DataLoader] Connected to ClickHouse');
    } catch (error) {
      console.error('[DataLoader] Failed to connect to ClickHouse:', error);
      throw error;
    }
  }

  /**
   * 关闭连接
   */
  async close(): Promise<void> {
    // 如果未连接，跳过
    if (!this.connected) {
      return;
    }

    // 关闭客户端
    await this.client.close();
    this.connected = false;
    console.log('[DataLoader] Disconnected from ClickHouse');
  }

  // ========================================================================
  // 公共方法 - 数据加载
  // ========================================================================

  /**
   * 加载所有数据并转换为事件流
   * @param exchanges - 交易所列表
   * @param symbols - 交易对列表
   * @param startTime - 开始时间
   * @param endTime - 结束时间
   * @returns 排序后的事件数组
   */
  async loadEvents(
    exchanges: ExchangeId[],
    symbols: string[],
    startTime: Timestamp,
    endTime: Timestamp
  ): Promise<BacktestEvent[]> {
    // 确保已连接
    await this.connect();

    // 记录开始时间
    const loadStartTime = Date.now();

    // 重置统计
    this.resetStats();
    this.stats.startTime = startTime;
    this.stats.endTime = endTime;

    // 收集所有事件
    const events: BacktestEvent[] = [];

    // 根据配置加载不同类型的数据
    const loadPromises: Promise<void>[] = [];

    // 加载成交数据
    if (this.config.dataTypes.includes('trade')) {
      loadPromises.push(
        this.loadTradeEvents(exchanges, symbols, startTime, endTime)
          .then((tradeEvents) => {
            events.push(...tradeEvents);
            this.stats.tradeEvents = tradeEvents.length;
          })
      );
    }

    // 加载深度数据
    if (this.config.dataTypes.includes('depth')) {
      loadPromises.push(
        this.loadDepthEvents(exchanges, symbols, startTime, endTime)
          .then((depthEvents) => {
            events.push(...depthEvents);
            this.stats.depthEvents = depthEvents.length;
          })
      );
    }

    // 加载资金费率数据
    if (this.config.dataTypes.includes('funding')) {
      loadPromises.push(
        this.loadFundingEvents(exchanges, symbols, startTime, endTime)
          .then((fundingEvents) => {
            events.push(...fundingEvents);
            this.stats.fundingEvents = fundingEvents.length;
          })
      );
    }

    // 加载标记价格数据
    if (this.config.dataTypes.includes('markPrice')) {
      loadPromises.push(
        this.loadMarkPriceEvents(exchanges, symbols, startTime, endTime)
          .then((markPriceEvents) => {
            events.push(...markPriceEvents);
            this.stats.markPriceEvents = markPriceEvents.length;
          })
      );
    }

    // 加载 K线数据
    if (this.config.dataTypes.includes('kline')) {
      loadPromises.push(
        this.loadKlineEvents(exchanges, symbols, startTime, endTime)
          .then((klineEvents) => {
            events.push(...klineEvents);
            this.stats.klineEvents = klineEvents.length;
          })
      );
    }

    // 等待所有加载完成
    await Promise.all(loadPromises);

    // 按时间戳排序（使用原地排序提高性能）
    events.sort((a, b) => a.timestamp - b.timestamp);

    // 更新统计
    this.stats.totalEvents = events.length;
    this.stats.loadTime = Date.now() - loadStartTime;

    console.log(
      `[DataLoader] Loaded ${events.length} events in ${this.stats.loadTime}ms ` +
      `(${(events.length / this.stats.loadTime * 1000).toFixed(0)} events/s)`
    );

    return events;
  }

  /**
   * 获取加载统计
   */
  getStats(): LoadStats {
    return { ...this.stats };
  }

  // ========================================================================
  // 私有方法 - 成交数据加载
  // ========================================================================

  /**
   * 加载成交数据
   */
  private async loadTradeEvents(
    exchanges: ExchangeId[],
    symbols: string[],
    startTime: Timestamp,
    endTime: Timestamp
  ): Promise<TradeEvent[]> {
    // 构建查询
    const query = `
      SELECT
        exchange,
        symbol,
        toString(timestamp) as timestamp,
        trade_id,
        toString(price) as price,
        toString(quantity) as quantity,
        is_sell
      FROM agg_trades
      WHERE exchange IN ({exchanges:Array(String)})
        AND symbol IN ({symbols:Array(String)})
        AND timestamp >= toDateTime64({startTime:UInt64} / 1000, 3)
        AND timestamp < toDateTime64({endTime:UInt64} / 1000, 3)
      ORDER BY timestamp
    `;

    // 执行查询
    const result = await this.client.query({
      query,
      query_params: {
        exchanges,
        symbols,
        startTime,
        endTime,
      },
      format: 'JSONEachRow',
    });

    // 解析结果
    const rows = await result.json<TradeRow[]>();

    // 转换为事件
    return rows.map((row) => this.rowToTradeEvent(row));
  }

  /**
   * 将数据行转换为成交事件
   */
  private rowToTradeEvent(row: TradeRow): TradeEvent {
    return {
      type: 'trade',
      timestamp: new Date(row.timestamp).getTime(),
      exchange: row.exchange as ExchangeId,
      symbol: row.symbol,
      tradeId: row.trade_id,
      price: parseFloat(row.price),
      quantity: parseFloat(row.quantity),
      isSell: row.is_sell === 1,
    };
  }

  // ========================================================================
  // 私有方法 - 深度数据加载
  // ========================================================================

  /**
   * 加载深度数据
   */
  private async loadDepthEvents(
    exchanges: ExchangeId[],
    symbols: string[],
    startTime: Timestamp,
    endTime: Timestamp
  ): Promise<DepthEvent[]> {
    // 构建查询
    const query = `
      SELECT
        exchange,
        symbol,
        toString(timestamp) as timestamp,
        bids,
        asks
      FROM depth_snapshots
      WHERE exchange IN ({exchanges:Array(String)})
        AND symbol IN ({symbols:Array(String)})
        AND timestamp >= toDateTime64({startTime:UInt64} / 1000, 3)
        AND timestamp < toDateTime64({endTime:UInt64} / 1000, 3)
      ORDER BY timestamp
    `;

    // 执行查询
    const result = await this.client.query({
      query,
      query_params: {
        exchanges,
        symbols,
        startTime,
        endTime,
      },
      format: 'JSONEachRow',
    });

    // 解析结果
    const rows = await result.json<DepthRow[]>();

    // 转换为事件
    return rows.map((row) => this.rowToDepthEvent(row));
  }

  /**
   * 将数据行转换为深度事件
   */
  private rowToDepthEvent(row: DepthRow): DepthEvent {
    // 解析买卖盘 JSON
    let bids: PriceLevel[] = [];
    let asks: PriceLevel[] = [];

    try {
      // 尝试解析 JSON
      const bidsData = JSON.parse(row.bids) as Array<[number, number]>;
      const asksData = JSON.parse(row.asks) as Array<[number, number]>;

      // 转换为 PriceLevel 格式
      bids = bidsData.map(([price, quantity]) => ({ price, quantity }));
      asks = asksData.map(([price, quantity]) => ({ price, quantity }));
    } catch {
      // 解析失败，使用空数组
      console.warn('[DataLoader] Failed to parse depth data:', row);
    }

    return {
      type: 'depth',
      timestamp: new Date(row.timestamp).getTime(),
      exchange: row.exchange as ExchangeId,
      symbol: row.symbol,
      bids,
      asks,
    };
  }

  // ========================================================================
  // 私有方法 - 资金费率数据加载
  // ========================================================================

  /**
   * 加载资金费率数据
   */
  private async loadFundingEvents(
    exchanges: ExchangeId[],
    symbols: string[],
    startTime: Timestamp,
    endTime: Timestamp
  ): Promise<FundingEvent[]> {
    // 构建查询
    const query = `
      SELECT
        exchange,
        symbol,
        toString(funding_time) as funding_time,
        toString(funding_rate) as funding_rate,
        toString(mark_price) as mark_price
      FROM funding_rates
      WHERE exchange IN ({exchanges:Array(String)})
        AND symbol IN ({symbols:Array(String)})
        AND funding_time >= toDateTime64({startTime:UInt64} / 1000, 3)
        AND funding_time < toDateTime64({endTime:UInt64} / 1000, 3)
      ORDER BY funding_time
    `;

    // 执行查询
    const result = await this.client.query({
      query,
      query_params: {
        exchanges,
        symbols,
        startTime,
        endTime,
      },
      format: 'JSONEachRow',
    });

    // 解析结果
    const rows = await result.json<FundingRow[]>();

    // 转换为事件
    return rows.map((row) => this.rowToFundingEvent(row));
  }

  /**
   * 将数据行转换为资金费率事件
   */
  private rowToFundingEvent(row: FundingRow): FundingEvent {
    // 计算下次资金费率时间（8 小时后）
    const fundingTime = new Date(row.funding_time).getTime();
    const nextFundingTime = fundingTime + 8 * 60 * 60 * 1000;

    return {
      type: 'funding',
      timestamp: fundingTime,
      exchange: row.exchange as ExchangeId,
      symbol: row.symbol,
      fundingRate: parseFloat(row.funding_rate),
      markPrice: parseFloat(row.mark_price),
      nextFundingTime,
    };
  }

  // ========================================================================
  // 私有方法 - 标记价格数据加载
  // ========================================================================

  /**
   * 加载标记价格数据
   */
  private async loadMarkPriceEvents(
    exchanges: ExchangeId[],
    symbols: string[],
    startTime: Timestamp,
    endTime: Timestamp
  ): Promise<MarkPriceEvent[]> {
    // 构建查询
    const query = `
      SELECT
        exchange,
        symbol,
        toString(timestamp) as timestamp,
        toString(mark_price) as mark_price,
        toString(index_price) as index_price
      FROM mark_prices
      WHERE exchange IN ({exchanges:Array(String)})
        AND symbol IN ({symbols:Array(String)})
        AND timestamp >= toDateTime64({startTime:UInt64} / 1000, 3)
        AND timestamp < toDateTime64({endTime:UInt64} / 1000, 3)
      ORDER BY timestamp
    `;

    // 执行查询
    const result = await this.client.query({
      query,
      query_params: {
        exchanges,
        symbols,
        startTime,
        endTime,
      },
      format: 'JSONEachRow',
    });

    // 解析结果
    const rows = await result.json<MarkPriceRow[]>();

    // 转换为事件
    return rows.map((row) => this.rowToMarkPriceEvent(row));
  }

  /**
   * 将数据行转换为标记价格事件
   */
  private rowToMarkPriceEvent(row: MarkPriceRow): MarkPriceEvent {
    return {
      type: 'markPrice',
      timestamp: new Date(row.timestamp).getTime(),
      exchange: row.exchange as ExchangeId,
      symbol: row.symbol,
      markPrice: parseFloat(row.mark_price),
      indexPrice: parseFloat(row.index_price),
    };
  }

  // ========================================================================
  // 私有方法 - K线数据加载
  // ========================================================================

  /**
   * 加载 K线数据
   */
  private async loadKlineEvents(
    exchanges: ExchangeId[],
    symbols: string[],
    startTime: Timestamp,
    endTime: Timestamp
  ): Promise<KlineEvent[]> {
    // 构建查询
    const query = `
      SELECT
        exchange,
        symbol,
        toString(open_time) as open_time,
        toString(open) as open,
        toString(high) as high,
        toString(low) as low,
        toString(close) as close,
        toString(volume) as volume,
        toString(quote_volume) as quote_volume,
        toString(trades) as trades
      FROM klines
      WHERE exchange IN ({exchanges:Array(String)})
        AND symbol IN ({symbols:Array(String)})
        AND open_time >= toDateTime64({startTime:UInt64} / 1000, 3)
        AND open_time < toDateTime64({endTime:UInt64} / 1000, 3)
      ORDER BY open_time
    `;

    // 执行查询
    const result = await this.client.query({
      query,
      query_params: {
        exchanges,
        symbols,
        startTime,
        endTime,
      },
      format: 'JSONEachRow',
    });

    // 解析结果
    const rows = await result.json<KlineRow[]>();

    // 转换为事件（K线事件的时间戳使用收盘时间，即开盘时间 + 1 分钟）
    return rows.map((row) => this.rowToKlineEvent(row));
  }

  /**
   * 将数据行转换为 K线事件
   */
  private rowToKlineEvent(row: KlineRow): KlineEvent {
    // K线开盘时间
    const openTime = new Date(row.open_time).getTime();

    // 事件时间戳使用 K线收盘时间（开盘时间 + 1 分钟 - 1 毫秒）
    const timestamp = openTime + 60000 - 1;

    return {
      type: 'kline',
      timestamp,
      exchange: row.exchange as ExchangeId,
      symbol: row.symbol,
      openTime,
      open: parseFloat(row.open),
      high: parseFloat(row.high),
      low: parseFloat(row.low),
      close: parseFloat(row.close),
      volume: parseFloat(row.volume),
      quoteVolume: parseFloat(row.quote_volume),
      trades: parseInt(row.trades, 10),
    };
  }

  // ========================================================================
  // 私有方法 - 统计
  // ========================================================================

  /**
   * 重置统计
   */
  private resetStats(): void {
    this.stats = {
      totalEvents: 0,
      tradeEvents: 0,
      depthEvents: 0,
      fundingEvents: 0,
      markPriceEvents: 0,
      klineEvents: 0,
      loadTime: 0,
      startTime: 0,
      endTime: 0,
    };
  }
}

// ============================================================================
// 导出工厂函数
// ============================================================================

/**
 * 创建数据加载器
 * @param config - 配置
 */
export function createDataLoader(config: DataLoaderConfig): DataLoader {
  return new DataLoader(config);
}
