// ============================================================================
// 资金费率计算器
// 实时计算和预测各交易所的资金费率
// 支持 EMA、线性回归、集成预测
// ============================================================================

import {
  type ExchangeId,
  type Timestamp,
  type ExchangeFundingRate,
  type FundingRateHistory,
  type FundingRatePrediction,
  SUPPORTED_EXCHANGES,
  annualizeFundingRate,
} from './types.js';

// ============================================================================
// 配置常量
// ============================================================================

// 预测配置
interface PredictionConfig {
  // EMA 窗口（期数）
  emaWindow: number;
  // 线性回归窗口（期数）
  linearWindow: number;
  // 历史数据最大保留期数
  maxHistorySize: number;
  // 预测权重（EMA、线性、最近值）
  weights: {
    ema: number;
    linear: number;
    recent: number;
  };
}

// 默认预测配置
const DEFAULT_PREDICTION_CONFIG: PredictionConfig = {
  // EMA 使用 12 期（4 天）
  emaWindow: 12,
  // 线性回归使用 24 期（8 天）
  linearWindow: 24,
  // 最多保留 90 期历史（30 天）
  maxHistorySize: 90,
  // 集成预测权重
  weights: {
    ema: 0.4,      // EMA 权重 40%
    linear: 0.3,   // 线性回归权重 30%
    recent: 0.3,   // 最近值权重 30%
  },
};

// ============================================================================
// 资金费率计算器类
// ============================================================================

/**
 * 资金费率计算器
 * 负责收集、存储、计算和预测资金费率
 */
export class FundingCalculator {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // 预测配置
  private config: PredictionConfig;

  // 当前资金费率缓存（exchange:symbol -> rate）
  private currentRates: Map<string, ExchangeFundingRate> = new Map();

  // 历史资金费率（exchange:symbol -> history[]）
  private rateHistory: Map<string, FundingRateHistory[]> = new Map();

  // EMA 缓存（exchange:symbol -> ema value）
  private emaCache: Map<string, number> = new Map();

  // 预测结果缓存
  private predictionCache: Map<string, FundingRatePrediction> = new Map();

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param config - 预测配置（可选）
   */
  constructor(config?: Partial<PredictionConfig>) {
    // 合并配置
    this.config = { ...DEFAULT_PREDICTION_CONFIG, ...config };
  }

  // ========================================================================
  // 公共方法 - 数据更新
  // ========================================================================

  /**
   * 更新资金费率数据
   * @param exchange - 交易所
   * @param symbol - 交易对
   * @param rate - 当前费率
   * @param predictedRate - 预测费率（交易所提供）
   * @param markPrice - 标记价格
   * @param indexPrice - 指数价格
   * @param nextFundingTime - 下次结算时间
   */
  updateRate(
    exchange: ExchangeId,
    symbol: string,
    rate: number,
    predictedRate: number,
    markPrice: number,
    indexPrice: number,
    nextFundingTime: Timestamp
  ): void {
    // 生成缓存键
    const key = this.getKey(exchange, symbol);

    // 计算年化费率
    const currentAnnualized = annualizeFundingRate(rate);
    const predictedAnnualized = annualizeFundingRate(predictedRate);

    // 创建费率对象
    const fundingRate: ExchangeFundingRate = {
      exchange,
      symbol,
      currentRate: rate,
      predictedRate,
      currentAnnualized,
      predictedAnnualized,
      markPrice,
      indexPrice,
      nextFundingTime,
      updatedAt: Date.now(),
    };

    // 更新缓存
    this.currentRates.set(key, fundingRate);

    // 更新 EMA
    this.updateEma(key, rate);

    // 重新计算预测
    this.updatePrediction(exchange, symbol);
  }

  /**
   * 添加历史资金费率记录
   * @param exchange - 交易所
   * @param symbol - 交易对
   * @param fundingTime - 结算时间
   * @param fundingRate - 资金费率
   */
  addHistoryRecord(
    exchange: ExchangeId,
    symbol: string,
    fundingTime: Timestamp,
    fundingRate: number
  ): void {
    // 生成缓存键
    const key = this.getKey(exchange, symbol);

    // 获取或创建历史数组
    let history = this.rateHistory.get(key);
    if (!history) {
      history = [];
      this.rateHistory.set(key, history);
    }

    // 添加记录
    history.push({
      exchange,
      symbol,
      fundingTime,
      fundingRate,
      annualizedRate: annualizeFundingRate(fundingRate),
    });

    // 按时间排序（升序）
    history.sort((a, b) => a.fundingTime - b.fundingTime);

    // 限制历史大小
    if (history.length > this.config.maxHistorySize) {
      // 移除最旧的记录
      history.splice(0, history.length - this.config.maxHistorySize);
    }
  }

  /**
   * 批量加载历史数据
   * @param records - 历史记录数组
   */
  loadHistory(records: FundingRateHistory[]): void {
    // 遍历所有记录
    for (const record of records) {
      this.addHistoryRecord(
        record.exchange,
        record.symbol,
        record.fundingTime,
        record.fundingRate
      );
    }

    // 重新计算所有 EMA
    this.recalculateAllEma();
  }

  // ========================================================================
  // 公共方法 - 数据查询
  // ========================================================================

  /**
   * 获取当前资金费率
   * @param exchange - 交易所
   * @param symbol - 交易对
   */
  getCurrentRate(exchange: ExchangeId, symbol: string): ExchangeFundingRate | undefined {
    const key = this.getKey(exchange, symbol);
    return this.currentRates.get(key);
  }

  /**
   * 获取所有交易所的当前资金费率
   * @param symbol - 交易对
   */
  getAllCurrentRates(symbol: string): Map<ExchangeId, ExchangeFundingRate> {
    // 结果映射
    const result = new Map<ExchangeId, ExchangeFundingRate>();

    // 遍历所有交易所
    for (const exchange of SUPPORTED_EXCHANGES) {
      const rate = this.getCurrentRate(exchange, symbol);
      if (rate) {
        result.set(exchange, rate);
      }
    }

    return result;
  }

  /**
   * 获取资金费率预测
   * @param exchange - 交易所
   * @param symbol - 交易对
   */
  getPrediction(exchange: ExchangeId, symbol: string): FundingRatePrediction | undefined {
    const key = this.getKey(exchange, symbol);
    return this.predictionCache.get(key);
  }

  /**
   * 获取所有交易所的预测费率
   * @param symbol - 交易对
   */
  getAllPredictions(symbol: string): Map<ExchangeId, FundingRatePrediction> {
    // 结果映射
    const result = new Map<ExchangeId, FundingRatePrediction>();

    // 遍历所有交易所
    for (const exchange of SUPPORTED_EXCHANGES) {
      const prediction = this.getPrediction(exchange, symbol);
      if (prediction) {
        result.set(exchange, prediction);
      }
    }

    return result;
  }

  /**
   * 获取历史资金费率
   * @param exchange - 交易所
   * @param symbol - 交易对
   * @param limit - 返回条数限制（可选）
   */
  getHistory(
    exchange: ExchangeId,
    symbol: string,
    limit?: number
  ): FundingRateHistory[] {
    const key = this.getKey(exchange, symbol);
    const history = this.rateHistory.get(key) ?? [];

    // 如果有限制，返回最近的记录
    if (limit && limit < history.length) {
      return history.slice(-limit);
    }

    return [...history];
  }

  // ========================================================================
  // 公共方法 - 费率计算
  // ========================================================================

  /**
   * 计算平均年化费率
   * @param exchange - 交易所
   * @param symbol - 交易对
   * @param periods - 计算周期数
   */
  calculateAverageAnnualized(
    exchange: ExchangeId,
    symbol: string,
    periods: number = 24
  ): number {
    // 获取历史数据
    const history = this.getHistory(exchange, symbol, periods);

    // 如果历史数据不足，返回当前值
    if (history.length === 0) {
      const current = this.getCurrentRate(exchange, symbol);
      return current?.currentAnnualized ?? 0;
    }

    // 计算平均值
    const sum = history.reduce((acc, record) => acc + record.annualizedRate, 0);
    return sum / history.length;
  }

  /**
   * 计算费率标准差
   * @param exchange - 交易所
   * @param symbol - 交易对
   * @param periods - 计算周期数
   */
  calculateStandardDeviation(
    exchange: ExchangeId,
    symbol: string,
    periods: number = 24
  ): number {
    // 获取历史数据
    const history = this.getHistory(exchange, symbol, periods);

    // 数据不足
    if (history.length < 2) {
      return 0;
    }

    // 计算平均值
    const mean = history.reduce((acc, r) => acc + r.fundingRate, 0) / history.length;

    // 计算方差
    const variance = history.reduce((acc, r) => {
      return acc + Math.pow(r.fundingRate - mean, 2);
    }, 0) / history.length;

    // 返回标准差
    return Math.sqrt(variance);
  }

  /**
   * 计算费率趋势（正数上升，负数下降）
   * @param exchange - 交易所
   * @param symbol - 交易对
   * @param periods - 计算周期数
   */
  calculateTrend(
    exchange: ExchangeId,
    symbol: string,
    periods: number = 12
  ): number {
    // 获取历史数据
    const history = this.getHistory(exchange, symbol, periods);

    // 数据不足
    if (history.length < 3) {
      return 0;
    }

    // 使用线性回归计算斜率
    const slope = this.linearRegressionSlope(
      history.map((r) => r.fundingRate)
    );

    return slope;
  }

  // ========================================================================
  // 公共方法 - 费率比较
  // ========================================================================

  /**
   * 获取费率最高的交易所
   * @param symbol - 交易对
   */
  getHighestRateExchange(symbol: string): { exchange: ExchangeId; rate: number } | undefined {
    // 获取所有费率
    const rates = this.getAllCurrentRates(symbol);

    // 找出最高的
    let highest: { exchange: ExchangeId; rate: number } | undefined;

    for (const [exchange, rate] of rates) {
      if (!highest || rate.currentAnnualized > highest.rate) {
        highest = { exchange, rate: rate.currentAnnualized };
      }
    }

    return highest;
  }

  /**
   * 获取费率最低的交易所
   * @param symbol - 交易对
   */
  getLowestRateExchange(symbol: string): { exchange: ExchangeId; rate: number } | undefined {
    // 获取所有费率
    const rates = this.getAllCurrentRates(symbol);

    // 找出最低的
    let lowest: { exchange: ExchangeId; rate: number } | undefined;

    for (const [exchange, rate] of rates) {
      if (!lowest || rate.currentAnnualized < lowest.rate) {
        lowest = { exchange, rate: rate.currentAnnualized };
      }
    }

    return lowest;
  }

  /**
   * 计算两个交易所之间的费率差
   * @param symbol - 交易对
   * @param exchange1 - 交易所1
   * @param exchange2 - 交易所2
   */
  calculateSpread(
    symbol: string,
    exchange1: ExchangeId,
    exchange2: ExchangeId
  ): number {
    // 获取两个交易所的费率
    const rate1 = this.getCurrentRate(exchange1, symbol);
    const rate2 = this.getCurrentRate(exchange2, symbol);

    // 如果任一不存在，返回 0
    if (!rate1 || !rate2) {
      return 0;
    }

    // 返回差值
    return rate1.currentAnnualized - rate2.currentAnnualized;
  }

  /**
   * 获取最大费率差
   * @param symbol - 交易对
   */
  getMaxSpread(symbol: string): {
    highExchange: ExchangeId;
    lowExchange: ExchangeId;
    spread: number;
  } | undefined {
    // 获取最高和最低
    const highest = this.getHighestRateExchange(symbol);
    const lowest = this.getLowestRateExchange(symbol);

    // 如果任一不存在，返回 undefined
    if (!highest || !lowest) {
      return undefined;
    }

    // 如果是同一个交易所，返回 undefined
    if (highest.exchange === lowest.exchange) {
      return undefined;
    }

    // 返回差值
    return {
      highExchange: highest.exchange,
      lowExchange: lowest.exchange,
      spread: highest.rate - lowest.rate,
    };
  }

  // ========================================================================
  // 公共方法 - 清理
  // ========================================================================

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.currentRates.clear();
    this.rateHistory.clear();
    this.emaCache.clear();
    this.predictionCache.clear();
  }

  /**
   * 清空指定交易对的数据
   * @param symbol - 交易对
   */
  clearSymbol(symbol: string): void {
    // 遍历所有交易所
    for (const exchange of SUPPORTED_EXCHANGES) {
      const key = this.getKey(exchange, symbol);
      this.currentRates.delete(key);
      this.rateHistory.delete(key);
      this.emaCache.delete(key);
      this.predictionCache.delete(key);
    }
  }

  // ========================================================================
  // 私有方法 - EMA 计算
  // ========================================================================

  /**
   * 更新 EMA 值
   * @param key - 缓存键
   * @param newValue - 新值
   */
  private updateEma(key: string, newValue: number): void {
    // 获取当前 EMA
    const currentEma = this.emaCache.get(key);

    // 计算平滑系数
    const alpha = 2 / (this.config.emaWindow + 1);

    // 如果没有历史 EMA，使用新值
    if (currentEma === undefined) {
      this.emaCache.set(key, newValue);
      return;
    }

    // 计算新的 EMA
    const newEma = alpha * newValue + (1 - alpha) * currentEma;
    this.emaCache.set(key, newEma);
  }

  /**
   * 重新计算所有 EMA
   */
  private recalculateAllEma(): void {
    // 遍历所有历史数据
    for (const [key, history] of this.rateHistory) {
      // 如果历史数据为空，跳过
      if (history.length === 0) {
        continue;
      }

      // 初始化 EMA 为第一个值
      let ema = history[0]!.fundingRate;
      const alpha = 2 / (this.config.emaWindow + 1);

      // 遍历计算 EMA
      for (let i = 1; i < history.length; i++) {
        ema = alpha * history[i]!.fundingRate + (1 - alpha) * ema;
      }

      // 保存 EMA
      this.emaCache.set(key, ema);
    }
  }

  // ========================================================================
  // 私有方法 - 预测计算
  // ========================================================================

  /**
   * 更新预测结果
   * @param exchange - 交易所
   * @param symbol - 交易对
   */
  private updatePrediction(exchange: ExchangeId, symbol: string): void {
    const key = this.getKey(exchange, symbol);

    // 获取历史数据
    const history = this.getHistory(exchange, symbol);

    // 如果历史数据不足，使用当前值作为预测
    if (history.length < 3) {
      const current = this.getCurrentRate(exchange, symbol);
      if (current) {
        this.predictionCache.set(key, {
          exchange,
          symbol,
          nextRate: current.predictedRate,
          nextAnnualized: current.predictedAnnualized,
          confidence: 0.3, // 低置信度
          method: 'recent',
          predictedAt: Date.now(),
        });
      }
      return;
    }

    // 获取 EMA 预测
    const emaPrediction = this.emaCache.get(key) ?? 0;

    // 获取线性回归预测
    const rates = history.map((r) => r.fundingRate);
    const linearPrediction = this.linearRegressionPredict(rates);

    // 获取最近值
    const recentValue = history[history.length - 1]!.fundingRate;

    // 集成预测（加权平均）
    const weights = this.config.weights;
    const ensemblePrediction =
      weights.ema * emaPrediction +
      weights.linear * linearPrediction +
      weights.recent * recentValue;

    // 计算置信度（基于历史波动率）
    const stdDev = this.calculateStandardDeviation(exchange, symbol, 24);
    const avgRate = this.calculateAverageAnnualized(exchange, symbol, 24);
    const cv = avgRate !== 0 ? Math.abs(stdDev / avgRate) : 1; // 变异系数
    const confidence = Math.max(0.1, Math.min(0.9, 1 - cv));

    // 保存预测
    this.predictionCache.set(key, {
      exchange,
      symbol,
      nextRate: ensemblePrediction,
      nextAnnualized: annualizeFundingRate(ensemblePrediction),
      confidence,
      method: 'ensemble',
      predictedAt: Date.now(),
    });
  }

  /**
   * 线性回归预测下一个值
   * @param values - 历史值数组
   */
  private linearRegressionPredict(values: number[]): number {
    // 取最近 N 个值
    const n = Math.min(values.length, this.config.linearWindow);
    const recentValues = values.slice(-n);

    // 计算线性回归
    const xMean = (n - 1) / 2;
    const yMean = recentValues.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (recentValues[i]! - yMean);
      denominator += Math.pow(i - xMean, 2);
    }

    // 计算斜率和截距
    const slope = denominator !== 0 ? numerator / denominator : 0;
    const intercept = yMean - slope * xMean;

    // 预测下一个值
    return slope * n + intercept;
  }

  /**
   * 计算线性回归斜率
   * @param values - 历史值数组
   */
  private linearRegressionSlope(values: number[]): number {
    const n = values.length;
    if (n < 2) return 0;

    const xMean = (n - 1) / 2;
    const yMean = values.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (values[i]! - yMean);
      denominator += Math.pow(i - xMean, 2);
    }

    return denominator !== 0 ? numerator / denominator : 0;
  }

  // ========================================================================
  // 私有方法 - 工具
  // ========================================================================

  /**
   * 生成缓存键
   * @param exchange - 交易所
   * @param symbol - 交易对
   */
  private getKey(exchange: ExchangeId, symbol: string): string {
    return `${exchange}:${symbol}`;
  }
}

// ============================================================================
// 导出工厂函数
// ============================================================================

/**
 * 创建资金费率计算器
 * @param config - 配置（可选）
 */
export function createFundingCalculator(
  config?: Partial<PredictionConfig>
): FundingCalculator {
  return new FundingCalculator(config);
}
