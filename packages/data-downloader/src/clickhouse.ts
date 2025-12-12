// ============================================================================
// ClickHouse 客户端
// 提供数据库连接、自动建表、批量插入功能
// 使用 ReplacingMergeTree 引擎支持数据去重
// ============================================================================

import { createClient, ClickHouseClient } from '@clickhouse/client';

import {
  type ClickHouseConfig,
  type ExchangeId,
  type DataType,
  type CleanKline,
  type CleanFundingRate,
  type CleanMarkPrice,
  type CleanOpenInterest,
  type CleanAggTrade,
  DEFAULT_CLICKHOUSE_CONFIG,
} from './types';

// ============================================================================
// 表结构定义
// ============================================================================

/**
 * K线表 DDL
 * 使用 ReplacingMergeTree 引擎，按 version 去重
 * 分区按月，排序按交易所、交易对、时间
 */
const KLINE_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS klines (
    -- 交易所 ID（LowCardinality 优化低基数字符串）
    exchange LowCardinality(String),
    -- 交易对符号
    symbol LowCardinality(String),
    -- 开盘时间（毫秒精度）
    open_time DateTime64(3, 'UTC'),
    -- 开盘价
    open Float64,
    -- 最高价
    high Float64,
    -- 最低价
    low Float64,
    -- 收盘价
    close Float64,
    -- 成交量（基础货币）
    volume Float64,
    -- 成交额（计价货币）
    quote_volume Float64,
    -- 成交笔数
    trades UInt32,
    -- 数据版本（用于去重，取最新版本）
    version UInt64
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(open_time)
ORDER BY (exchange, symbol, open_time)
SETTINGS index_granularity = 8192
`;

/**
 * 资金费率表 DDL
 */
const FUNDING_RATE_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS funding_rates (
    -- 交易所 ID
    exchange LowCardinality(String),
    -- 交易对符号
    symbol LowCardinality(String),
    -- 结算时间
    funding_time DateTime64(3, 'UTC'),
    -- 资金费率
    funding_rate Float64,
    -- 标记价格
    mark_price Float64,
    -- 指数价格
    index_price Float64,
    -- 数据版本
    version UInt64
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(funding_time)
ORDER BY (exchange, symbol, funding_time)
SETTINGS index_granularity = 8192
`;

/**
 * 标记价格表 DDL
 * 数据量较大，按天分区
 */
const MARK_PRICE_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS mark_prices (
    -- 交易所 ID
    exchange LowCardinality(String),
    -- 交易对符号
    symbol LowCardinality(String),
    -- 时间戳
    timestamp DateTime64(3, 'UTC'),
    -- 标记价格
    mark_price Float64,
    -- 指数价格
    index_price Float64,
    -- 预估结算价格
    estimated_settle_price Float64,
    -- 数据版本
    version UInt64
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (exchange, symbol, timestamp)
SETTINGS index_granularity = 8192
`;

/**
 * 持仓量表 DDL
 */
const OPEN_INTEREST_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS open_interests (
    -- 交易所 ID
    exchange LowCardinality(String),
    -- 交易对符号
    symbol LowCardinality(String),
    -- 时间戳
    timestamp DateTime64(3, 'UTC'),
    -- 持仓量（合约数量）
    open_interest Float64,
    -- 持仓价值（USDT）
    open_interest_value Float64,
    -- 数据版本
    version UInt64
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (exchange, symbol, timestamp)
SETTINGS index_granularity = 8192
`;

/**
 * 聚合成交表 DDL
 * 数据量最大，按天分区
 */
const AGG_TRADE_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS agg_trades (
    -- 交易所 ID
    exchange LowCardinality(String),
    -- 交易对符号
    symbol LowCardinality(String),
    -- 成交 ID
    trade_id String,
    -- 成交时间
    timestamp DateTime64(3, 'UTC'),
    -- 成交价格
    price Float64,
    -- 成交数量
    amount Float64,
    -- 成交方向（1=买，-1=卖）
    side Int8,
    -- 数据版本
    version UInt64
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (exchange, symbol, timestamp, trade_id)
SETTINGS index_granularity = 8192
`;

/**
 * 下载检查点表 DDL
 * 用于断点续传
 */
const CHECKPOINT_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS download_checkpoints (
    -- 交易所 ID
    exchange LowCardinality(String),
    -- 交易对符号
    symbol LowCardinality(String),
    -- 数据类型
    data_type LowCardinality(String),
    -- 最后下载时间戳
    last_timestamp DateTime64(3, 'UTC'),
    -- 更新时间
    updated_at DateTime64(3, 'UTC'),
    -- 下载状态
    status LowCardinality(String),
    -- 错误信息
    error_message String,
    -- 已下载记录数
    downloaded_count UInt64,
    -- 版本
    version UInt64
)
ENGINE = ReplacingMergeTree(version)
ORDER BY (exchange, symbol, data_type)
SETTINGS index_granularity = 8192
`;

// ============================================================================
// ClickHouse 客户端类
// ============================================================================

/**
 * ClickHouse 数据库客户端
 *
 * 功能：
 * - 连接管理
 * - 自动建表（ReplacingMergeTree 引擎）
 * - 批量数据插入
 * - 数据查询
 */
export class ClickHouseDatabase {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // ClickHouse 客户端实例
  private client: ClickHouseClient;

  // 配置
  private readonly config: Required<ClickHouseConfig>;

  // 是否已初始化表结构
  private tablesInitialized: boolean = false;

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param config - ClickHouse 配置
   */
  constructor(config: Partial<ClickHouseConfig> = {}) {
    // 合并默认配置
    this.config = {
      ...DEFAULT_CLICKHOUSE_CONFIG,
      ...config,
    };

    // 创建 ClickHouse 客户端
    this.client = createClient({
      // 主机地址（包含协议和端口）
      host: `${this.config.https ? 'https' : 'http'}://${this.config.host}:${this.config.port}`,
      // 数据库名
      database: this.config.database,
      // 用户名
      username: this.config.username,
      // 密码
      password: this.config.password,
      // 请求超时
      request_timeout: this.config.requestTimeout,
      // 连接超时
      connect_timeout: this.config.connectTimeout,
      // 启用压缩
      compression: {
        request: true,
        response: true,
      },
    });
  }

  // ========================================================================
  // 连接管理
  // ========================================================================

  /**
   * 初始化数据库和表结构
   * 如果数据库或表不存在，自动创建
   */
  async initialize(): Promise<void> {
    // 如果已初始化，跳过
    if (this.tablesInitialized) {
      return;
    }

    try {
      // 创建数据库（如果不存在）
      await this.createDatabase();

      // 创建所有表
      await this.createTables();

      // 标记已初始化
      this.tablesInitialized = true;

      // 输出成功信息
      console.log(`[ClickHouse] Database "${this.config.database}" initialized successfully`);

    } catch (error) {
      // 初始化失败
      console.error('[ClickHouse] Failed to initialize database:', error);
      throw error;
    }
  }

  /**
   * 创建数据库
   */
  private async createDatabase(): Promise<void> {
    // 使用 system 数据库执行创建语句
    // 注意：需要临时切换到 default 数据库
    const tempClient = createClient({
      host: `${this.config.https ? 'https' : 'http'}://${this.config.host}:${this.config.port}`,
      username: this.config.username,
      password: this.config.password,
    });

    try {
      // 执行创建数据库语句
      await tempClient.command({
        query: `CREATE DATABASE IF NOT EXISTS ${this.config.database}`,
      });
    } finally {
      // 关闭临时客户端
      await tempClient.close();
    }
  }

  /**
   * 创建所有表
   */
  private async createTables(): Promise<void> {
    // 所有表的 DDL 列表
    const ddlStatements = [
      KLINE_TABLE_DDL,
      FUNDING_RATE_TABLE_DDL,
      MARK_PRICE_TABLE_DDL,
      OPEN_INTEREST_TABLE_DDL,
      AGG_TRADE_TABLE_DDL,
      CHECKPOINT_TABLE_DDL,
    ];

    // 依次执行 DDL
    for (const ddl of ddlStatements) {
      await this.client.command({ query: ddl });
    }
  }

  /**
   * 关闭连接
   */
  async close(): Promise<void> {
    await this.client.close();
  }

  /**
   * 测试连接
   * @returns 是否连接成功
   */
  async ping(): Promise<boolean> {
    try {
      // 执行简单查询测试连接
      await this.client.query({ query: 'SELECT 1' });
      return true;
    } catch (error) {
      return false;
    }
  }

  // ========================================================================
  // K线数据操作
  // ========================================================================

  /**
   * 批量插入 K线数据
   * @param data - K线数据数组
   */
  async insertKlines(data: CleanKline[]): Promise<void> {
    // 如果没有数据，跳过
    if (data.length === 0) {
      return;
    }

    // 使用 insert 方法批量插入
    await this.client.insert({
      // 目标表名
      table: 'klines',
      // 数据数组
      values: data.map((row) => ({
        exchange: row.exchange,
        symbol: row.symbol,
        open_time: row.open_time,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
        quote_volume: row.quote_volume,
        trades: row.trades,
        version: row.version,
      })),
      // 数据格式
      format: 'JSONEachRow',
    });
  }

  /**
   * 查询 K线数据
   * @param exchange - 交易所
   * @param symbol - 交易对
   * @param startTime - 开始时间
   * @param endTime - 结束时间
   * @returns K线数据数组
   */
  async queryKlines(
    exchange: ExchangeId,
    symbol: string,
    startTime: Date,
    endTime: Date
  ): Promise<CleanKline[]> {
    // 执行查询
    const result = await this.client.query({
      query: `
        SELECT *
        FROM klines FINAL
        WHERE exchange = {exchange:String}
          AND symbol = {symbol:String}
          AND open_time >= {startTime:DateTime64(3)}
          AND open_time < {endTime:DateTime64(3)}
        ORDER BY open_time ASC
      `,
      query_params: {
        exchange,
        symbol,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
      },
      format: 'JSONEachRow',
    });

    // 返回结果
    return await result.json();
  }

  // ========================================================================
  // 资金费率数据操作
  // ========================================================================

  /**
   * 批量插入资金费率数据
   * @param data - 资金费率数据数组
   */
  async insertFundingRates(data: CleanFundingRate[]): Promise<void> {
    // 如果没有数据，跳过
    if (data.length === 0) {
      return;
    }

    // 批量插入
    await this.client.insert({
      table: 'funding_rates',
      values: data.map((row) => ({
        exchange: row.exchange,
        symbol: row.symbol,
        funding_time: row.funding_time,
        funding_rate: row.funding_rate,
        mark_price: row.mark_price,
        index_price: row.index_price,
        version: row.version,
      })),
      format: 'JSONEachRow',
    });
  }

  /**
   * 查询资金费率数据
   */
  async queryFundingRates(
    exchange: ExchangeId,
    symbol: string,
    startTime: Date,
    endTime: Date
  ): Promise<CleanFundingRate[]> {
    const result = await this.client.query({
      query: `
        SELECT *
        FROM funding_rates FINAL
        WHERE exchange = {exchange:String}
          AND symbol = {symbol:String}
          AND funding_time >= {startTime:DateTime64(3)}
          AND funding_time < {endTime:DateTime64(3)}
        ORDER BY funding_time ASC
      `,
      query_params: {
        exchange,
        symbol,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
      },
      format: 'JSONEachRow',
    });

    return await result.json();
  }

  // ========================================================================
  // 标记价格数据操作
  // ========================================================================

  /**
   * 批量插入标记价格数据
   * @param data - 标记价格数据数组
   */
  async insertMarkPrices(data: CleanMarkPrice[]): Promise<void> {
    if (data.length === 0) {
      return;
    }

    await this.client.insert({
      table: 'mark_prices',
      values: data.map((row) => ({
        exchange: row.exchange,
        symbol: row.symbol,
        timestamp: row.timestamp,
        mark_price: row.mark_price,
        index_price: row.index_price,
        estimated_settle_price: row.estimated_settle_price,
        version: row.version,
      })),
      format: 'JSONEachRow',
    });
  }

  // ========================================================================
  // 持仓量数据操作
  // ========================================================================

  /**
   * 批量插入持仓量数据
   * @param data - 持仓量数据数组
   */
  async insertOpenInterests(data: CleanOpenInterest[]): Promise<void> {
    if (data.length === 0) {
      return;
    }

    await this.client.insert({
      table: 'open_interests',
      values: data.map((row) => ({
        exchange: row.exchange,
        symbol: row.symbol,
        timestamp: row.timestamp,
        open_interest: row.open_interest,
        open_interest_value: row.open_interest_value,
        version: row.version,
      })),
      format: 'JSONEachRow',
    });
  }

  // ========================================================================
  // 聚合成交数据操作
  // ========================================================================

  /**
   * 批量插入聚合成交数据
   * @param data - 聚合成交数据数组
   */
  async insertAggTrades(data: CleanAggTrade[]): Promise<void> {
    if (data.length === 0) {
      return;
    }

    await this.client.insert({
      table: 'agg_trades',
      values: data.map((row) => ({
        exchange: row.exchange,
        symbol: row.symbol,
        trade_id: row.trade_id,
        timestamp: row.timestamp,
        price: row.price,
        amount: row.amount,
        side: row.side,
        version: row.version,
      })),
      format: 'JSONEachRow',
    });
  }

  // ========================================================================
  // 检查点操作
  // ========================================================================

  /**
   * 保存下载检查点
   * @param exchange - 交易所
   * @param symbol - 交易对
   * @param dataType - 数据类型
   * @param lastTimestamp - 最后下载时间戳
   * @param status - 状态
   * @param downloadedCount - 已下载数量
   * @param errorMessage - 错误信息
   */
  async saveCheckpoint(
    exchange: ExchangeId,
    symbol: string,
    dataType: DataType,
    lastTimestamp: number,
    status: string,
    downloadedCount: number,
    errorMessage?: string
  ): Promise<void> {
    // 当前时间戳作为版本号
    const version = Date.now();

    await this.client.insert({
      table: 'download_checkpoints',
      values: [{
        exchange,
        symbol,
        data_type: dataType,
        last_timestamp: new Date(lastTimestamp),
        updated_at: new Date(),
        status,
        error_message: errorMessage || '',
        downloaded_count: downloadedCount,
        version,
      }],
      format: 'JSONEachRow',
    });
  }

  /**
   * 获取下载检查点
   * @param exchange - 交易所
   * @param symbol - 交易对
   * @param dataType - 数据类型
   * @returns 检查点信息
   */
  async getCheckpoint(
    exchange: ExchangeId,
    symbol: string,
    dataType: DataType
  ): Promise<{
    lastTimestamp: number;
    status: string;
    downloadedCount: number;
  } | null> {
    const result = await this.client.query({
      query: `
        SELECT
          last_timestamp,
          status,
          downloaded_count
        FROM download_checkpoints FINAL
        WHERE exchange = {exchange:String}
          AND symbol = {symbol:String}
          AND data_type = {dataType:String}
        LIMIT 1
      `,
      query_params: {
        exchange,
        symbol,
        dataType,
      },
      format: 'JSONEachRow',
    });

    // 获取结果
    const rows = await result.json<{
      last_timestamp: string;
      status: string;
      downloaded_count: string;
    }[]>();

    // 如果没有结果，返回 null
    if (rows.length === 0) {
      return null;
    }

    // 返回检查点信息
    const row = rows[0]!;
    return {
      lastTimestamp: new Date(row.last_timestamp).getTime(),
      status: row.status,
      downloadedCount: parseInt(row.downloaded_count, 10),
    };
  }

  // ========================================================================
  // 统计查询
  // ========================================================================

  /**
   * 获取数据统计信息
   * @param tableName - 表名
   * @param exchange - 交易所
   * @param symbol - 交易对
   * @returns 统计信息
   */
  async getDataStats(
    tableName: string,
    exchange: ExchangeId,
    symbol: string
  ): Promise<{
    count: number;
    minTime: Date | null;
    maxTime: Date | null;
  }> {
    // 根据表名确定时间字段
    const timeField = tableName === 'klines' ? 'open_time' :
                      tableName === 'funding_rates' ? 'funding_time' :
                      'timestamp';

    const result = await this.client.query({
      query: `
        SELECT
          count() as count,
          min(${timeField}) as min_time,
          max(${timeField}) as max_time
        FROM ${tableName} FINAL
        WHERE exchange = {exchange:String}
          AND symbol = {symbol:String}
      `,
      query_params: {
        exchange,
        symbol,
      },
      format: 'JSONEachRow',
    });

    const rows = await result.json<{
      count: string;
      min_time: string;
      max_time: string;
    }[]>();

    if (rows.length === 0 || rows[0]!.count === '0') {
      return {
        count: 0,
        minTime: null,
        maxTime: null,
      };
    }

    const row = rows[0]!;
    return {
      count: parseInt(row.count, 10),
      minTime: new Date(row.min_time),
      maxTime: new Date(row.max_time),
    };
  }

  /**
   * 优化表（触发 FINAL 合并）
   * @param tableName - 表名
   */
  async optimizeTable(tableName: string): Promise<void> {
    await this.client.command({
      query: `OPTIMIZE TABLE ${tableName} FINAL`,
    });
  }

  /**
   * 执行原始查询
   * @param query - SQL 查询
   * @param params - 查询参数
   * @returns 查询结果
   */
  async query<T = unknown>(query: string, params?: Record<string, unknown>): Promise<T[]> {
    const result = await this.client.query({
      query,
      query_params: params,
      format: 'JSONEachRow',
    });

    return await result.json();
  }
}
