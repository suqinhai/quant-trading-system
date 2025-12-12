// ============================================================================
// 资金费率套利策略类型定义
// 定义策略所需的所有数据结构
// ============================================================================

// ============================================================================
// 基础类型
// ============================================================================

// 支持的交易所 ID
export type ExchangeId = 'binance' | 'bybit' | 'okx';

// 所有支持的交易所列表
export const SUPPORTED_EXCHANGES: ExchangeId[] = ['binance', 'bybit', 'okx'];

// 持仓方向
export type PositionSide = 'long' | 'short' | 'none';

// 订单方向
export type OrderSide = 'buy' | 'sell';

// 时间戳类型（毫秒）
export type Timestamp = number;

// ============================================================================
// 资金费率类型
// ============================================================================

// 单个交易所的资金费率数据
export interface ExchangeFundingRate {
  // 交易所 ID
  exchange: ExchangeId;
  // 交易对符号
  symbol: string;
  // 当前资金费率（原始值，如 0.0001 表示 0.01%）
  currentRate: number;
  // 预测资金费率（下一期）
  predictedRate: number;
  // 当前年化费率（currentRate * 3 * 365）
  currentAnnualized: number;
  // 预测年化费率
  predictedAnnualized: number;
  // 标记价格
  markPrice: number;
  // 指数价格
  indexPrice: number;
  // 下次结算时间
  nextFundingTime: Timestamp;
  // 数据更新时间
  updatedAt: Timestamp;
}

// 资金费率历史记录
export interface FundingRateHistory {
  // 交易所 ID
  exchange: ExchangeId;
  // 交易对符号
  symbol: string;
  // 结算时间
  fundingTime: Timestamp;
  // 资金费率
  fundingRate: number;
  // 年化费率
  annualizedRate: number;
}

// 资金费率预测结果
export interface FundingRatePrediction {
  // 交易所 ID
  exchange: ExchangeId;
  // 交易对符号
  symbol: string;
  // 预测的下一期费率
  nextRate: number;
  // 预测的年化费率
  nextAnnualized: number;
  // 预测置信度（0-1）
  confidence: number;
  // 预测方法
  method: 'ema' | 'linear' | 'arima' | 'ensemble' | 'recent';
  // 预测时间
  predictedAt: Timestamp;
}

// ============================================================================
// 套利机会类型
// ============================================================================

// 套利机会
export interface ArbitrageOpportunity {
  // 套利 ID（唯一标识）
  id: string;
  // 交易对符号
  symbol: string;
  // 做多交易所（收取资金费）
  longExchange: ExchangeId;
  // 做空交易所（支付资金费）
  shortExchange: ExchangeId;
  // 做多交易所年化费率
  longAnnualized: number;
  // 做空交易所年化费率
  shortAnnualized: number;
  // 年化利差（longAnnualized - shortAnnualized）
  spreadAnnualized: number;
  // 年化利差百分比
  spreadPercent: number;
  // 预期收益（考虑手续费后）
  expectedReturn: number;
  // 风险评分（0-100，越低越好）
  riskScore: number;
  // 建议仓位比例（0-1）
  suggestedSize: number;
  // 发现时间
  detectedAt: Timestamp;
  // 有效期（毫秒）
  validUntil: Timestamp;
  // 是否仍然有效
  isValid: boolean;
}

// 套利方向
export interface ArbitrageDirection {
  // 做多交易所
  longExchange: ExchangeId;
  // 做空交易所
  shortExchange: ExchangeId;
  // 利差
  spread: number;
}

// ============================================================================
// 库存管理类型
// ============================================================================

// 单个交易所的库存状态
export interface ExchangeInventory {
  // 交易所 ID
  exchange: ExchangeId;
  // 交易对符号
  symbol: string;
  // 当前持仓方向
  side: PositionSide;
  // 持仓数量（始终为正）
  quantity: number;
  // 持仓价值（USDT）
  notionalValue: number;
  // 开仓均价
  entryPrice: number;
  // 未实现盈亏
  unrealizedPnl: number;
  // 已实现盈亏
  realizedPnl: number;
  // 累计资金费用（正数为支出）
  fundingPaid: number;
  // 累计资金收入
  fundingReceived: number;
  // 净资金费用
  netFunding: number;
  // 杠杆倍数
  leverage: number;
  // 保证金
  margin: number;
  // 更新时间
  updatedAt: Timestamp;
}

// 总库存状态
export interface TotalInventory {
  // 交易对符号
  symbol: string;
  // 各交易所库存
  exchanges: Map<ExchangeId, ExchangeInventory>;
  // 总净持仓（多头为正，空头为负）
  netPosition: number;
  // 总持仓价值
  totalNotional: number;
  // 库存偏离度（|净持仓| / 总持仓，0-1）
  imbalanceRatio: number;
  // 是否需要再平衡
  needsRebalance: boolean;
  // 更新时间
  updatedAt: Timestamp;
}

// 再平衡操作
export interface RebalanceAction {
  // 操作类型
  type: 'open' | 'close' | 'reduce' | 'increase';
  // 交易所
  exchange: ExchangeId;
  // 交易对
  symbol: string;
  // 方向
  side: OrderSide;
  // 数量
  quantity: number;
  // 原因
  reason: string;
  // 优先级（1-10，10 最高）
  priority: number;
}

// ============================================================================
// 仓位管理类型
// ============================================================================

// 仓位大小计算参数
export interface PositionSizeParams {
  // 账户权益
  equity: number;
  // 可用余额
  availableBalance: number;
  // 当前使用的保证金
  usedMargin: number;
  // 套利机会
  opportunity: ArbitrageOpportunity;
  // 当前波动率
  volatility: number;
  // 风险系数（0-1，越高越保守）
  riskFactor: number;
}

// 仓位大小结果
export interface PositionSizeResult {
  // 建议仓位（USDT 价值）
  suggestedNotional: number;
  // 建议数量
  suggestedQuantity: number;
  // 最大允许仓位
  maxNotional: number;
  // 最小有效仓位
  minNotional: number;
  // 杠杆倍数
  leverage: number;
  // 所需保证金
  requiredMargin: number;
  // 仓位调整原因
  adjustmentReason?: string;
}

// 风险限制
export interface RiskLimits {
  // 单个套利对最大仓位（占权益比例）
  maxPositionPerPair: number;
  // 单个交易所最大仓位（占权益比例）
  maxPositionPerExchange: number;
  // 总仓位上限（占权益比例）
  maxTotalPosition: number;
  // 最大杠杆
  maxLeverage: number;
  // 最小套利利差（年化）
  minSpreadAnnualized: number;
  // 最大单笔亏损（占权益比例）
  maxSingleLoss: number;
  // 最大总回撤
  maxDrawdown: number;
  // 每日最大交易次数
  maxDailyTrades: number;
}

// 默认风险限制
export const DEFAULT_RISK_LIMITS: RiskLimits = {
  // 单个套利对最多占权益的 20%
  maxPositionPerPair: 0.20,
  // 单个交易所最多占权益的 40%
  maxPositionPerExchange: 0.40,
  // 总仓位最多占权益的 80%
  maxTotalPosition: 0.80,
  // 最大杠杆 5 倍
  maxLeverage: 5,
  // 最小年化利差 15%
  minSpreadAnnualized: 0.15,
  // 单笔最大亏损 2%
  maxSingleLoss: 0.02,
  // 最大回撤 8%
  maxDrawdown: 0.08,
  // 每日最多 50 笔交易
  maxDailyTrades: 50,
};

// ============================================================================
// 策略配置类型
// ============================================================================

// 资金费率套利策略配置
export interface FundingArbitrageConfig {
  // 交易对列表
  symbols: string[];
  // 最小年化利差（触发开仓）
  minSpreadToOpen: number;
  // 最小年化利差（维持仓位）
  minSpreadToHold: number;
  // 库存再平衡阈值（库存偏离度超过此值触发再平衡）
  rebalanceThreshold: number;
  // 最大库存占比（超过此值停止开仓）
  maxInventoryRatio: number;
  // 风险限制
  riskLimits: RiskLimits;
  // 资金费率预测窗口（小时）
  predictionWindow: number;
  // 是否启用动态仓位
  enableDynamicSizing: boolean;
  // 是否启用自动再平衡
  enableAutoRebalance: boolean;
  // 目标夏普比率
  targetSharpeRatio: number;
  // 目标最大回撤
  targetMaxDrawdown: number;
}

// 默认策略配置
export const DEFAULT_FUNDING_ARBITRAGE_CONFIG: FundingArbitrageConfig = {
  // 默认交易 BTC 和 ETH
  symbols: ['BTC/USDT:USDT', 'ETH/USDT:USDT'],
  // 年化利差 > 15% 开仓
  minSpreadToOpen: 0.15,
  // 年化利差 > 5% 维持仓位
  minSpreadToHold: 0.05,
  // 库存偏离 > 20% 再平衡
  rebalanceThreshold: 0.20,
  // 库存占比 > 30% 停止开仓
  maxInventoryRatio: 0.30,
  // 使用默认风险限制
  riskLimits: DEFAULT_RISK_LIMITS,
  // 预测窗口 24 小时
  predictionWindow: 24,
  // 启用动态仓位
  enableDynamicSizing: true,
  // 启用自动再平衡
  enableAutoRebalance: true,
  // 目标夏普 > 4.0
  targetSharpeRatio: 4.0,
  // 目标回撤 < 8%
  targetMaxDrawdown: 0.08,
};

// ============================================================================
// 策略状态类型
// ============================================================================

// 策略运行状态
export interface StrategyState {
  // 是否正在运行
  running: boolean;
  // 是否暂停
  paused: boolean;
  // 暂停原因
  pauseReason?: string;
  // 当前权益
  equity: number;
  // 初始权益
  initialEquity: number;
  // 累计盈亏
  totalPnl: number;
  // 累计资金费收益
  totalFundingPnl: number;
  // 累计交易手续费
  totalFees: number;
  // 当前回撤
  currentDrawdown: number;
  // 最大回撤
  maxDrawdown: number;
  // 峰值权益
  peakEquity: number;
  // 交易次数
  tradeCount: number;
  // 盈利交易次数
  winCount: number;
  // 亏损交易次数
  lossCount: number;
  // 夏普比率（滚动计算）
  sharpeRatio: number;
  // 启动时间
  startedAt: Timestamp;
  // 最后更新时间
  updatedAt: Timestamp;
}

// 策略性能指标
export interface StrategyMetrics {
  // 总收益率
  totalReturn: number;
  // 年化收益率
  annualizedReturn: number;
  // 夏普比率
  sharpeRatio: number;
  // 索提诺比率
  sortinoRatio: number;
  // 卡玛比率
  calmarRatio: number;
  // 最大回撤
  maxDrawdown: number;
  // 胜率
  winRate: number;
  // 盈亏比
  profitFactor: number;
  // 平均持仓时间（毫秒）
  avgHoldingTime: number;
  // 日均交易次数
  avgDailyTrades: number;
  // 资金费收益占比
  fundingPnlRatio: number;
}

// ============================================================================
// 信号类型
// ============================================================================

// 交易信号
export interface TradeSignal {
  // 信号 ID
  id: string;
  // 信号类型
  type: 'open' | 'close' | 'rebalance' | 'reduce';
  // 交易对
  symbol: string;
  // 套利机会（开仓信号）
  opportunity?: ArbitrageOpportunity;
  // 再平衡操作列表
  rebalanceActions?: RebalanceAction[];
  // 信号强度（0-1）
  strength: number;
  // 信号原因
  reason: string;
  // 生成时间
  generatedAt: Timestamp;
  // 有效期
  validUntil: Timestamp;
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 计算年化资金费率
 * @param rate - 单期费率（如 0.0001）
 * @param periodsPerDay - 每日结算次数（默认 3 次，每 8 小时一次）
 * @returns 年化费率
 */
export function annualizeFundingRate(rate: number, periodsPerDay: number = 3): number {
  // 年化 = 单期费率 * 每日次数 * 365 天
  return rate * periodsPerDay * 365;
}

/**
 * 计算资金费率利差
 * @param longRate - 做多交易所费率
 * @param shortRate - 做空交易所费率
 * @returns 利差（正数表示做多有利）
 */
export function calculateFundingSpread(longRate: number, shortRate: number): number {
  // 利差 = 做多费率 - 做空费率
  // 如果做多费率为负（收取费用），做空费率为正（支付费用），利差为正
  return longRate - shortRate;
}

/**
 * 生成套利 ID
 * @param symbol - 交易对
 * @param longExchange - 做多交易所
 * @param shortExchange - 做空交易所
 * @returns 唯一标识
 */
export function generateArbitrageId(
  symbol: string,
  longExchange: ExchangeId,
  shortExchange: ExchangeId
): string {
  // 格式：symbol_long_short
  return `${symbol}_${longExchange}_${shortExchange}`;
}

/**
 * 生成唯一 ID
 * @returns 唯一标识
 */
export function generateId(): string {
  // 使用时间戳 + 随机数
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}
