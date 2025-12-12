// ============================================================================
// MarketDataEngine 类型定义
// 定义所有市场数据相关的接口和类型
// ============================================================================

// ============================================================================
// 交易所枚举
// ============================================================================

/**
 * 支持的交易所列表
 * 目前支持三大主流交易所
 */
export type ExchangeId = 'binance' | 'bybit' | 'okx';

/**
 * 所有支持的交易所数组（用于遍历）
 */
export const SUPPORTED_EXCHANGES: readonly ExchangeId[] = [
  'binance',  // 币安
  'bybit',    // Bybit
  'okx',      // OKX
] as const;

// ============================================================================
// 订阅频道类型
// ============================================================================

/**
 * 市场数据频道类型
 * - ticker: 行情数据（100ms 更新）
 * - depth5: 5 档深度（100ms 更新）
 * - depth20: 20 档深度（250ms 更新）
 * - aggTrade: 聚合成交
 * - fundingRate: 资金费率
 */
export type ChannelType =
  | 'ticker'       // 行情数据
  | 'depth5'       // 5 档深度
  | 'depth20'      // 20 档深度
  | 'aggTrade'     // 聚合成交
  | 'fundingRate'; // 资金费率

// ============================================================================
// 统一数据格式
// ============================================================================

/**
 * 统一时间戳接口
 * 包含交易所时间和本地接收时间
 */
export interface UnifiedTimestamp {
  // 交易所服务器时间（毫秒）
  exchangeTime: number;
  // 本地接收时间（毫秒）
  receivedAt: number;
  // 统一时间戳（取平均值）
  timestamp: number;
}

/**
 * 统一行情数据
 * 所有交易所的 ticker 数据都转换为此格式
 */
export interface UnifiedTicker extends UnifiedTimestamp {
  // 数据类型标识
  type: 'ticker';
  // 交易所 ID
  exchange: ExchangeId;
  // 统一交易对符号（如 BTC/USDT:USDT）
  symbol: string;
  // 原始交易对符号（各交易所格式）
  rawSymbol: string;
  // 最新价格
  last: number;
  // 买一价
  bid: number;
  // 买一量
  bidSize: number;
  // 卖一价
  ask: number;
  // 卖一量
  askSize: number;
  // 24小时最高价
  high24h: number;
  // 24小时最低价
  low24h: number;
  // 24小时成交量（基础货币）
  volume24h: number;
  // 24小时成交额（计价货币）
  turnover24h: number;
  // 24小时涨跌幅（百分比）
  change24h: number;
}

/**
 * 深度数据档位
 * [价格, 数量]
 */
export type DepthLevel = [number, number];

/**
 * 统一深度数据
 * 所有交易所的 orderbook 数据都转换为此格式
 */
export interface UnifiedDepth extends UnifiedTimestamp {
  // 数据类型标识
  type: 'depth';
  // 交易所 ID
  exchange: ExchangeId;
  // 统一交易对符号
  symbol: string;
  // 原始交易对符号
  rawSymbol: string;
  // 买单列表（按价格降序）
  bids: DepthLevel[];
  // 卖单列表（按价格升序）
  asks: DepthLevel[];
  // 更新序号（用于增量更新）
  updateId: number;
}

/**
 * 统一成交数据
 * 所有交易所的 trade 数据都转换为此格式
 */
export interface UnifiedTrade extends UnifiedTimestamp {
  // 数据类型标识
  type: 'trade';
  // 交易所 ID
  exchange: ExchangeId;
  // 统一交易对符号
  symbol: string;
  // 原始交易对符号
  rawSymbol: string;
  // 成交 ID
  tradeId: string;
  // 成交价格
  price: number;
  // 成交数量
  quantity: number;
  // 成交方向（true = 买方主动，false = 卖方主动）
  isBuyerMaker: boolean;
}

/**
 * 统一资金费率数据
 */
export interface UnifiedFundingRate extends UnifiedTimestamp {
  // 数据类型标识
  type: 'fundingRate';
  // 交易所 ID
  exchange: ExchangeId;
  // 统一交易对符号
  symbol: string;
  // 原始交易对符号
  rawSymbol: string;
  // 当前资金费率
  fundingRate: number;
  // 预测资金费率（如有）
  nextFundingRate: number | null;
  // 下次结算时间
  nextFundingTime: number;
  // 标记价格
  markPrice: number;
  // 指数价格
  indexPrice: number;
}

/**
 * 统一市场数据类型联合
 */
export type UnifiedMarketData =
  | UnifiedTicker
  | UnifiedDepth
  | UnifiedTrade
  | UnifiedFundingRate;

// ============================================================================
// 订阅管理类型
// ============================================================================

/**
 * 订阅配置
 */
export interface SubscriptionConfig {
  // 交易所 ID
  exchange: ExchangeId;
  // 交易对列表（统一格式）
  symbols: string[];
  // 订阅的频道类型
  channels: ChannelType[];
}

/**
 * 订阅状态
 */
export interface SubscriptionState {
  // 订阅 ID（exchange:symbol:channel）
  id: string;
  // 交易所 ID
  exchange: ExchangeId;
  // 交易对
  symbol: string;
  // 频道类型
  channel: ChannelType;
  // 是否已订阅
  active: boolean;
  // 订阅时间
  subscribedAt: number;
  // 最后收到数据时间
  lastDataAt: number;
  // 接收到的消息数
  messageCount: number;
}

// ============================================================================
// WebSocket 连接类型
// ============================================================================

/**
 * WebSocket 连接状态
 */
export type WsConnectionState =
  | 'disconnected'  // 已断开
  | 'connecting'    // 连接中
  | 'connected'     // 已连接
  | 'reconnecting'; // 重连中

/**
 * WebSocket 连接信息
 */
export interface WsConnectionInfo {
  // 交易所 ID
  exchange: ExchangeId;
  // 连接状态
  state: WsConnectionState;
  // 连接 URL
  url: string;
  // 连接时间
  connectedAt: number | null;
  // 重连次数
  reconnectCount: number;
  // 最后收到消息时间
  lastMessageAt: number;
  // 延迟（毫秒）
  latency: number;
}

// ============================================================================
// Redis 配置类型
// ============================================================================

/**
 * Redis 连接配置
 */
export interface RedisConfig {
  // Redis 主机地址
  host: string;
  // Redis 端口
  port: number;
  // Redis 密码（可选）
  password?: string;
  // 数据库编号
  db?: number;
  // 连接池大小（用于发布）
  poolSize?: number;
  // 键前缀
  keyPrefix?: string;
}

/**
 * TimeSeries 数据保留配置
 */
export interface TimeSeriesRetention {
  // ticker 数据保留时间（毫秒）
  ticker: number;
  // depth 数据保留时间
  depth: number;
  // trade 数据保留时间
  trade: number;
  // fundingRate 数据保留时间
  fundingRate: number;
}

// ============================================================================
// 引擎配置类型
// ============================================================================

/**
 * MarketDataEngine 配置
 */
export interface MarketDataEngineConfig {
  // Redis 配置
  redis: RedisConfig;
  // TimeSeries 数据保留配置
  retention?: TimeSeriesRetention;
  // 是否启用 TimeSeries 写入
  enableTimeSeries?: boolean;
  // 是否启用 Pub/Sub 推送
  enablePubSub?: boolean;
  // Pub/Sub 频道名称
  pubSubChannel?: string;
  // 数据批量写入间隔（毫秒）
  batchInterval?: number;
  // 批量写入大小
  batchSize?: number;
  // WebSocket 重连基础延迟（毫秒）
  wsReconnectBaseDelay?: number;
  // WebSocket 重连最大延迟
  wsReconnectMaxDelay?: number;
  // WebSocket 最大重连次数
  wsMaxReconnectAttempts?: number;
  // 心跳间隔（毫秒）
  heartbeatInterval?: number;
  // 是否启用压缩
  enableCompression?: boolean;
}

/**
 * 默认配置
 */
export const DEFAULT_CONFIG: Required<Omit<MarketDataEngineConfig, 'redis'>> = {
  // TimeSeries 数据保留配置（默认）
  retention: {
    ticker: 24 * 60 * 60 * 1000,      // 1 天
    depth: 1 * 60 * 60 * 1000,        // 1 小时
    trade: 24 * 60 * 60 * 1000,       // 1 天
    fundingRate: 7 * 24 * 60 * 60 * 1000, // 7 天
  },
  // 启用 TimeSeries 写入
  enableTimeSeries: true,
  // 启用 Pub/Sub 推送
  enablePubSub: true,
  // Pub/Sub 频道名称
  pubSubChannel: 'market',
  // 批量写入间隔（50ms）
  batchInterval: 50,
  // 批量写入大小（100 条）
  batchSize: 100,
  // WebSocket 重连基础延迟
  wsReconnectBaseDelay: 1000,
  // WebSocket 重连最大延迟
  wsReconnectMaxDelay: 30000,
  // WebSocket 最大重连次数
  wsMaxReconnectAttempts: 100,
  // 心跳间隔（30 秒）
  heartbeatInterval: 30000,
  // 启用压缩
  enableCompression: true,
};

// ============================================================================
// 事件类型
// ============================================================================

/**
 * MarketDataEngine 事件类型
 */
export interface MarketDataEngineEvents {
  // 数据事件
  ticker: (data: UnifiedTicker) => void;
  depth: (data: UnifiedDepth) => void;
  trade: (data: UnifiedTrade) => void;
  fundingRate: (data: UnifiedFundingRate) => void;

  // 连接事件
  connected: (exchange: ExchangeId) => void;
  disconnected: (exchange: ExchangeId, reason: string) => void;
  reconnecting: (exchange: ExchangeId, attempt: number) => void;

  // 订阅事件
  subscribed: (exchange: ExchangeId, symbol: string, channel: ChannelType) => void;
  unsubscribed: (exchange: ExchangeId, symbol: string, channel: ChannelType) => void;

  // 错误事件
  error: (error: Error, context?: string) => void;
}

// ============================================================================
// 统计类型
// ============================================================================

/**
 * 引擎运行统计
 */
export interface EngineStats {
  // 启动时间
  startedAt: number;
  // 运行时长（毫秒）
  uptime: number;
  // 各交易所连接状态
  connections: Record<ExchangeId, WsConnectionInfo>;
  // 活跃订阅数量
  activeSubscriptions: number;
  // 消息统计
  messages: {
    // 总接收数
    received: number;
    // 每秒接收数
    perSecond: number;
    // 各类型消息数
    byType: Record<string, number>;
    // 各交易所消息数
    byExchange: Record<ExchangeId, number>;
  };
  // Redis 统计
  redis: {
    // TimeSeries 写入数
    timeSeriesWrites: number;
    // Pub/Sub 发布数
    pubSubPublishes: number;
    // 写入错误数
    errors: number;
  };
  // 性能统计
  performance: {
    // 平均处理延迟（微秒）
    avgLatencyUs: number;
    // 最大处理延迟
    maxLatencyUs: number;
    // 内存使用（MB）
    memoryUsageMb: number;
    // CPU 使用百分比
    cpuUsagePercent: number;
  };
}
