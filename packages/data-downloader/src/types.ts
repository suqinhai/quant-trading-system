// ============================================================================
// 数据下载器类型定义
// 定义所有数据下载、清洗、存储相关的接口和类型
// ============================================================================

// ============================================================================
// 交易所枚举
// ============================================================================

/**
 * 支持的交易所列表
 * 目前支持三大主流永续合约交易所
 */
export type ExchangeId = 'binance' | 'bybit' | 'okx';

/**
 * 所有支持的交易所数组（用于遍历）
 */
export const SUPPORTED_EXCHANGES: readonly ExchangeId[] = [
  'binance',  // 币安 USDT 永续
  'bybit',    // Bybit 线性合约
  'okx',      // OKX 永续合约
] as const;

// ============================================================================
// 数据类型枚举
// ============================================================================

/**
 * 支持下载的数据类型
 * - kline: K线数据（1分钟）
 * - funding_rate: 资金费率（8小时结算）
 * - mark_price: 标记价格
 * - open_interest: 持仓量
 * - agg_trade: 聚合成交（可选，数据量大）
 */
export type DataType =
  | 'kline'         // K线数据
  | 'funding_rate'  // 资金费率
  | 'mark_price'    // 标记价格
  | 'open_interest' // 持仓量
  | 'agg_trade';    // 聚合成交

/**
 * 所有支持的数据类型数组
 */
export const SUPPORTED_DATA_TYPES: readonly DataType[] = [
  'kline',
  'funding_rate',
  'mark_price',
  'open_interest',
  'agg_trade',
] as const;

// ============================================================================
// K线数据类型
// ============================================================================

/**
 * 原始 K线数据（从 CCXT 获取）
 * CCXT 返回格式：[timestamp, open, high, low, close, volume]
 */
export interface RawKline {
  // 开盘时间（毫秒）
  timestamp: number;
  // 开盘价
  open: number;
  // 最高价
  high: number;
  // 最低价
  low: number;
  // 收盘价
  close: number;
  // 成交量（基础货币）
  volume: number;
  // 成交额（计价货币，如有）
  quoteVolume?: number;
  // 成交笔数（如有）
  trades?: number;
}

/**
 * 清洗后的 K线数据（用于 ClickHouse）
 */
export interface CleanKline {
  // 交易所 ID
  exchange: ExchangeId;
  // 交易对符号（统一格式：BTC/USDT:USDT）
  symbol: string;
  // 开盘时间（DateTime64）
  open_time: Date;
  // 开盘价
  open: number;
  // 最高价
  high: number;
  // 最低价
  low: number;
  // 收盘价
  close: number;
  // 成交量
  volume: number;
  // 成交额
  quote_volume: number;
  // 成交笔数
  trades: number;
  // 数据版本（用于 ReplacingMergeTree）
  version: number;
}

// ============================================================================
// 资金费率数据类型
// ============================================================================

/**
 * 原始资金费率数据
 */
export interface RawFundingRate {
  // 时间戳（毫秒）
  timestamp: number;
  // 交易对
  symbol: string;
  // 资金费率
  fundingRate: number;
  // 标记价格（如有）
  markPrice?: number;
  // 指数价格（如有）
  indexPrice?: number;
}

/**
 * 清洗后的资金费率数据
 */
export interface CleanFundingRate {
  // 交易所 ID
  exchange: ExchangeId;
  // 交易对符号
  symbol: string;
  // 结算时间
  funding_time: Date;
  // 资金费率
  funding_rate: number;
  // 标记价格
  mark_price: number;
  // 指数价格
  index_price: number;
  // 数据版本
  version: number;
}

// ============================================================================
// 标记价格数据类型
// ============================================================================

/**
 * 原始标记价格数据
 */
export interface RawMarkPrice {
  // 时间戳
  timestamp: number;
  // 交易对
  symbol: string;
  // 标记价格
  markPrice: number;
  // 指数价格
  indexPrice?: number;
  // 预估结算价格
  estimatedSettlePrice?: number;
}

/**
 * 清洗后的标记价格数据
 */
export interface CleanMarkPrice {
  // 交易所 ID
  exchange: ExchangeId;
  // 交易对符号
  symbol: string;
  // 时间
  timestamp: Date;
  // 标记价格
  mark_price: number;
  // 指数价格
  index_price: number;
  // 预估结算价格
  estimated_settle_price: number;
  // 数据版本
  version: number;
}

// ============================================================================
// 持仓量数据类型
// ============================================================================

/**
 * 原始持仓量数据
 */
export interface RawOpenInterest {
  // 时间戳
  timestamp: number;
  // 交易对
  symbol: string;
  // 持仓量（合约张数或基础货币数量）
  openInterest: number;
  // 持仓价值（USDT）
  openInterestValue?: number;
}

/**
 * 清洗后的持仓量数据
 */
export interface CleanOpenInterest {
  // 交易所 ID
  exchange: ExchangeId;
  // 交易对符号
  symbol: string;
  // 时间
  timestamp: Date;
  // 持仓量
  open_interest: number;
  // 持仓价值（USDT）
  open_interest_value: number;
  // 数据版本
  version: number;
}

// ============================================================================
// 聚合成交数据类型
// ============================================================================

/**
 * 原始聚合成交数据
 */
export interface RawAggTrade {
  // 聚合成交 ID
  id: string | number;
  // 时间戳
  timestamp: number;
  // 交易对
  symbol: string;
  // 成交价格
  price: number;
  // 成交数量
  amount: number;
  // 是否买方挂单成交
  isBuyerMaker: boolean;
}

/**
 * 清洗后的聚合成交数据
 */
export interface CleanAggTrade {
  // 交易所 ID
  exchange: ExchangeId;
  // 交易对符号
  symbol: string;
  // 成交 ID
  trade_id: string;
  // 成交时间
  timestamp: Date;
  // 成交价格
  price: number;
  // 成交数量
  amount: number;
  // 成交方向（1=买，-1=卖）
  side: number;
  // 数据版本
  version: number;
}

// ============================================================================
// 断点续传类型
// ============================================================================

/**
 * 下载进度检查点
 * 用于断点续传和增量更新
 */
export interface Checkpoint {
  // 交易所 ID
  exchange: ExchangeId;
  // 交易对符号
  symbol: string;
  // 数据类型
  dataType: DataType;
  // 最后成功下载的时间戳（毫秒）
  lastTimestamp: number;
  // 最后更新时间
  updatedAt: number;
  // 下载状态
  status: 'pending' | 'running' | 'completed' | 'failed';
  // 错误信息（如有）
  errorMessage?: string;
  // 已下载记录数
  downloadedCount: number;
}

/**
 * 检查点存储接口
 */
export interface CheckpointStore {
  // 获取检查点
  get(exchange: ExchangeId, symbol: string, dataType: DataType): Promise<Checkpoint | null>;
  // 保存检查点
  save(checkpoint: Checkpoint): Promise<void>;
  // 获取所有检查点
  getAll(): Promise<Checkpoint[]>;
  // 删除检查点
  delete(exchange: ExchangeId, symbol: string, dataType: DataType): Promise<void>;
}

// ============================================================================
// 下载配置类型
// ============================================================================

/**
 * 下载任务配置
 */
export interface DownloadConfig {
  // 要下载的交易所列表
  exchanges: ExchangeId[];
  // 要下载的交易对列表（统一格式）
  symbols: string[];
  // 要下载的数据类型
  dataTypes: DataType[];
  // 开始时间（毫秒时间戳或 ISO 字符串）
  startTime: number | string;
  // 结束时间（默认当前时间）
  endTime?: number | string;
  // 每批下载数量
  batchSize?: number;
  // 请求间隔（毫秒，用于限速）
  requestDelay?: number;
  // 是否启用断点续传
  enableCheckpoint?: boolean;
  // 检查点存储路径
  checkpointPath?: string;
  // 并发下载数
  concurrency?: number;
  // 重试次数
  retryCount?: number;
  // 重试延迟（毫秒）
  retryDelay?: number;
}

/**
 * 默认下载配置
 */
export const DEFAULT_DOWNLOAD_CONFIG: Required<Omit<DownloadConfig, 'exchanges' | 'symbols' | 'dataTypes' | 'startTime'>> = {
  // 结束时间默认当前
  endTime: Date.now(),
  // 每批 1000 条
  batchSize: 1000,
  // 请求间隔 100ms（避免限速）
  requestDelay: 100,
  // 启用断点续传
  enableCheckpoint: true,
  // 检查点存储路径
  checkpointPath: './checkpoints',
  // 并发数 3
  concurrency: 3,
  // 重试 3 次
  retryCount: 3,
  // 重试延迟 1 秒
  retryDelay: 1000,
};

// ============================================================================
// ClickHouse 配置类型
// ============================================================================

/**
 * ClickHouse 连接配置
 */
export interface ClickHouseConfig {
  // 主机地址
  host: string;
  // 端口
  port: number;
  // 数据库名
  database: string;
  // 用户名
  username?: string;
  // 密码
  password?: string;
  // 请求超时（毫秒）
  requestTimeout?: number;
  // 连接超时（毫秒）
  connectTimeout?: number;
  // 是否使用 HTTPS
  https?: boolean;
}

/**
 * 默认 ClickHouse 配置
 */
export const DEFAULT_CLICKHOUSE_CONFIG: Required<ClickHouseConfig> = {
  // 默认主机
  host: 'localhost',
  // 默认端口
  port: 8123,
  // 默认数据库
  database: 'quant',
  // 默认用户名
  username: 'default',
  // 默认密码
  password: '',
  // 请求超时 30 秒
  requestTimeout: 30000,
  // 连接超时 10 秒
  connectTimeout: 10000,
  // 不使用 HTTPS
  https: false,
};

// ============================================================================
// 下载进度事件类型
// ============================================================================

/**
 * 下载进度事件
 */
export interface DownloadProgressEvent {
  // 交易所
  exchange: ExchangeId;
  // 交易对
  symbol: string;
  // 数据类型
  dataType: DataType;
  // 当前进度（0-100）
  progress: number;
  // 已下载记录数
  downloadedCount: number;
  // 当前下载的时间范围
  currentTimestamp: number;
  // 目标时间
  targetTimestamp: number;
  // 预估剩余时间（秒）
  estimatedTimeRemaining?: number;
}

/**
 * 下载器事件类型
 */
export interface DownloaderEvents {
  // 开始下载
  start: (exchange: ExchangeId, symbol: string, dataType: DataType) => void;
  // 下载进度
  progress: (event: DownloadProgressEvent) => void;
  // 下载完成
  complete: (exchange: ExchangeId, symbol: string, dataType: DataType, count: number) => void;
  // 下载错误
  error: (exchange: ExchangeId, symbol: string, dataType: DataType, error: Error) => void;
  // 跳过（已是最新）
  skip: (exchange: ExchangeId, symbol: string, dataType: DataType, reason: string) => void;
}

// ============================================================================
// 工具类型
// ============================================================================

/**
 * 交易对信息
 */
export interface SymbolInfo {
  // 交易所 ID
  exchange: ExchangeId;
  // 统一符号（如 BTC/USDT:USDT）
  symbol: string;
  // 原始符号（交易所格式）
  rawSymbol: string;
  // 基础货币
  base: string;
  // 计价货币
  quote: string;
  // 结算货币
  settle: string;
  // 合约乘数
  contractSize?: number;
  // 最小下单量
  minAmount?: number;
  // 价格精度
  pricePrecision?: number;
  // 数量精度
  amountPrecision?: number;
  // 上线时间
  listingDate?: number;
}

/**
 * 数据统计
 */
export interface DataStats {
  // 交易所
  exchange: ExchangeId;
  // 交易对
  symbol: string;
  // 数据类型
  dataType: DataType;
  // 记录总数
  totalCount: number;
  // 最早记录时间
  minTimestamp: number;
  // 最新记录时间
  maxTimestamp: number;
  // 数据完整度（百分比）
  completeness: number;
}
