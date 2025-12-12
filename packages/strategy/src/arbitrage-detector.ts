// ============================================================================
// 套利检测器
// 检测跨交易所资金费率套利机会
// 核心功能：费率差计算、机会评分、风险评估
// ============================================================================

import {
  type ExchangeId,
  type Timestamp,
  type ArbitrageOpportunity,
  type ArbitrageDirection,
  type ExchangeFundingRate,
  type FundingRatePrediction,
  generateArbitrageId,
  calculateFundingSpread,
} from './types';
import { type FundingCalculator } from './funding-calculator';

// ============================================================================
// 配置接口
// ============================================================================

// 套利检测配置
interface ArbitrageDetectorConfig {
  // 最小年化利差（触发检测）
  minSpreadAnnualized: number;
  // 最小置信度（预测置信度要求）
  minConfidence: number;
  // 机会有效期（毫秒）
  opportunityTtl: number;
  // 风险评分权重
  riskWeights: {
    // 利差稳定性权重
    spreadStability: number;
    // 预测置信度权重
    confidence: number;
    // 交易所风险权重
    exchangeRisk: number;
    // 流动性风险权重
    liquidityRisk: number;
  };
  // 交易所风险系数（0-1，越高风险越大）
  exchangeRiskScores: Record<ExchangeId, number>;
  // 最大风险评分（超过此值不开仓）
  maxRiskScore: number;
}

// 默认套利检测配置
const DEFAULT_ARBITRAGE_DETECTOR_CONFIG: ArbitrageDetectorConfig = {
  // 年化利差 > 15% 触发检测
  minSpreadAnnualized: 0.15,
  // 预测置信度 > 50%
  minConfidence: 0.5,
  // 机会有效期 30 分钟
  opportunityTtl: 30 * 60 * 1000,
  // 风险评分权重
  riskWeights: {
    spreadStability: 0.3,  // 利差稳定性 30%
    confidence: 0.3,       // 置信度 30%
    exchangeRisk: 0.2,     // 交易所风险 20%
    liquidityRisk: 0.2,    // 流动性风险 20%
  },
  // 交易所风险系数（越低越安全）
  exchangeRiskScores: {
    binance: 0.1,  // Binance 风险最低
    okx: 0.15,     // OKX 次之
    bybit: 0.2,    // Bybit 稍高
  },
  // 最大风险评分 70
  maxRiskScore: 70,
};

// ============================================================================
// 套利机会详情
// ============================================================================

// 套利机会详情（包含更多分析信息）
interface ArbitrageOpportunityDetails extends ArbitrageOpportunity {
  // 做多交易所费率详情
  longRateDetails: ExchangeFundingRate;
  // 做空交易所费率详情
  shortRateDetails: ExchangeFundingRate;
  // 做多交易所预测
  longPrediction?: FundingRatePrediction;
  // 做空交易所预测
  shortPrediction?: FundingRatePrediction;
  // 利差趋势（正数上升，负数下降）
  spreadTrend: number;
  // 利差标准差
  spreadStdDev: number;
  // 综合置信度
  combinedConfidence: number;
}

// ============================================================================
// 套利检测器类
// ============================================================================

/**
 * 套利检测器
 * 检测跨交易所资金费率套利机会
 */
export class ArbitrageDetector {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // 配置
  private config: ArbitrageDetectorConfig;

  // 资金费率计算器引用
  private fundingCalculator: FundingCalculator;

  // 当前有效机会（id -> opportunity）
  private opportunities: Map<string, ArbitrageOpportunityDetails> = new Map();

  // 历史利差记录（用于计算趋势）
  private spreadHistory: Map<string, { timestamp: Timestamp; spread: number }[]> = new Map();

  // 利差历史最大保留数量
  private maxSpreadHistorySize: number = 100;

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param fundingCalculator - 资金费率计算器
   * @param config - 配置（可选）
   */
  constructor(
    fundingCalculator: FundingCalculator,
    config?: Partial<ArbitrageDetectorConfig>
  ) {
    // 保存计算器引用
    this.fundingCalculator = fundingCalculator;

    // 合并配置
    this.config = { ...DEFAULT_ARBITRAGE_DETECTOR_CONFIG, ...config };
  }

  // ========================================================================
  // 公共方法 - 机会检测
  // ========================================================================

  /**
   * 检测套利机会
   * @param symbol - 交易对
   */
  detectOpportunities(symbol: string): ArbitrageOpportunity[] {
    // 结果数组
    const opportunities: ArbitrageOpportunity[] = [];

    // 获取所有交易所的费率
    const rates = this.fundingCalculator.getAllCurrentRates(symbol);

    // 如果交易所数量不足，返回空
    if (rates.size < 2) {
      return opportunities;
    }

    // 获取所有预测
    const predictions = this.fundingCalculator.getAllPredictions(symbol);

    // 遍历所有交易所对
    const exchanges = Array.from(rates.keys());

    for (let i = 0; i < exchanges.length; i++) {
      for (let j = i + 1; j < exchanges.length; j++) {
        const exchange1 = exchanges[i]!;
        const exchange2 = exchanges[j]!;

        // 获取两个交易所的费率
        const rate1 = rates.get(exchange1)!;
        const rate2 = rates.get(exchange2)!;

        // 计算利差（正数表示 exchange1 费率更高）
        const spread = calculateFundingSpread(
          rate1.currentAnnualized,
          rate2.currentAnnualized
        );

        // 确定做多和做空方向
        // 做多低费率交易所（收取资金费），做空高费率交易所（支付资金费）
        const direction = this.determineDirection(
          exchange1,
          exchange2,
          rate1.currentAnnualized,
          rate2.currentAnnualized
        );

        // 计算年化利差（绝对值）
        const spreadAnnualized = Math.abs(spread);

        // 检查是否满足最小利差要求
        if (spreadAnnualized < this.config.minSpreadAnnualized) {
          continue;
        }

        // 获取详细费率信息
        const longRate = rates.get(direction.longExchange)!;
        const shortRate = rates.get(direction.shortExchange)!;

        // 获取预测信息
        const longPrediction = predictions.get(direction.longExchange);
        const shortPrediction = predictions.get(direction.shortExchange);

        // 检查预测置信度
        const combinedConfidence = this.calculateCombinedConfidence(
          longPrediction,
          shortPrediction
        );

        if (combinedConfidence < this.config.minConfidence) {
          continue;
        }

        // 记录利差历史
        this.recordSpreadHistory(symbol, direction, spreadAnnualized);

        // 计算利差趋势和标准差
        const { trend, stdDev } = this.calculateSpreadStats(symbol, direction);

        // 计算风险评分
        const riskScore = this.calculateRiskScore(
          spreadAnnualized,
          stdDev,
          combinedConfidence,
          direction.longExchange,
          direction.shortExchange
        );

        // 检查风险评分
        if (riskScore > this.config.maxRiskScore) {
          continue;
        }

        // 计算预期收益（考虑手续费后）
        const expectedReturn = this.calculateExpectedReturn(
          spreadAnnualized,
          riskScore
        );

        // 计算建议仓位比例
        const suggestedSize = this.calculateSuggestedSize(
          spreadAnnualized,
          riskScore,
          combinedConfidence
        );

        // 生成机会 ID
        const id = generateArbitrageId(
          symbol,
          direction.longExchange,
          direction.shortExchange
        );

        // 当前时间
        const now = Date.now();

        // 创建机会对象
        const opportunity: ArbitrageOpportunityDetails = {
          id,
          symbol,
          longExchange: direction.longExchange,
          shortExchange: direction.shortExchange,
          longAnnualized: longRate.currentAnnualized,
          shortAnnualized: shortRate.currentAnnualized,
          spreadAnnualized,
          spreadPercent: spreadAnnualized * 100,
          expectedReturn,
          riskScore,
          suggestedSize,
          detectedAt: now,
          validUntil: now + this.config.opportunityTtl,
          isValid: true,
          // 详细信息
          longRateDetails: longRate,
          shortRateDetails: shortRate,
          longPrediction,
          shortPrediction,
          spreadTrend: trend,
          spreadStdDev: stdDev,
          combinedConfidence,
        };

        // 保存机会
        this.opportunities.set(id, opportunity);

        // 添加到结果
        opportunities.push(opportunity);
      }
    }

    // 清理过期机会
    this.cleanupExpiredOpportunities();

    // 按利差排序（从高到低）
    opportunities.sort((a, b) => b.spreadAnnualized - a.spreadAnnualized);

    return opportunities;
  }

  /**
   * 获取最佳套利机会
   * @param symbol - 交易对
   */
  getBestOpportunity(symbol: string): ArbitrageOpportunity | undefined {
    // 检测所有机会
    const opportunities = this.detectOpportunities(symbol);

    // 返回第一个（利差最高的）
    return opportunities[0];
  }

  /**
   * 获取所有有效机会
   * @param symbol - 交易对（可选，不传则返回所有）
   */
  getValidOpportunities(symbol?: string): ArbitrageOpportunity[] {
    // 清理过期机会
    this.cleanupExpiredOpportunities();

    // 结果数组
    const result: ArbitrageOpportunity[] = [];

    // 当前时间
    const now = Date.now();

    // 遍历所有机会
    for (const opportunity of this.opportunities.values()) {
      // 检查是否有效
      if (!opportunity.isValid || opportunity.validUntil < now) {
        continue;
      }

      // 如果指定了交易对，检查是否匹配
      if (symbol && opportunity.symbol !== symbol) {
        continue;
      }

      result.push(opportunity);
    }

    // 按利差排序
    result.sort((a, b) => b.spreadAnnualized - a.spreadAnnualized);

    return result;
  }

  /**
   * 获取机会详情
   * @param id - 机会 ID
   */
  getOpportunityDetails(id: string): ArbitrageOpportunityDetails | undefined {
    return this.opportunities.get(id);
  }

  /**
   * 刷新机会状态
   * @param id - 机会 ID
   */
  refreshOpportunity(id: string): ArbitrageOpportunity | undefined {
    // 获取现有机会
    const existing = this.opportunities.get(id);

    // 如果不存在，返回 undefined
    if (!existing) {
      return undefined;
    }

    // 重新检测该交易对的机会
    const opportunities = this.detectOpportunities(existing.symbol);

    // 查找对应的机会
    return opportunities.find((o) => o.id === id);
  }

  /**
   * 使机会失效
   * @param id - 机会 ID
   */
  invalidateOpportunity(id: string): void {
    const opportunity = this.opportunities.get(id);
    if (opportunity) {
      opportunity.isValid = false;
    }
  }

  // ========================================================================
  // 公共方法 - 利差分析
  // ========================================================================

  /**
   * 获取当前利差
   * @param symbol - 交易对
   * @param longExchange - 做多交易所
   * @param shortExchange - 做空交易所
   */
  getCurrentSpread(
    symbol: string,
    longExchange: ExchangeId,
    shortExchange: ExchangeId
  ): number {
    return this.fundingCalculator.calculateSpread(
      symbol,
      longExchange,
      shortExchange
    );
  }

  /**
   * 获取最大利差
   * @param symbol - 交易对
   */
  getMaxSpread(symbol: string): ArbitrageDirection | undefined {
    // 使用资金费率计算器获取最大利差
    const maxSpread = this.fundingCalculator.getMaxSpread(symbol);

    // 如果没有利差，返回 undefined
    if (!maxSpread) {
      return undefined;
    }

    // 转换为套利方向
    // 做多低费率交易所，做空高费率交易所
    return {
      longExchange: maxSpread.lowExchange,
      shortExchange: maxSpread.highExchange,
      spread: maxSpread.spread,
    };
  }

  /**
   * 获取利差历史
   * @param symbol - 交易对
   * @param longExchange - 做多交易所
   * @param shortExchange - 做空交易所
   * @param limit - 返回条数
   */
  getSpreadHistory(
    symbol: string,
    longExchange: ExchangeId,
    shortExchange: ExchangeId,
    limit: number = 50
  ): { timestamp: Timestamp; spread: number }[] {
    // 生成历史键
    const key = this.getSpreadHistoryKey(symbol, { longExchange, shortExchange, spread: 0 });

    // 获取历史
    const history = this.spreadHistory.get(key) ?? [];

    // 返回最近的记录
    return history.slice(-limit);
  }

  // ========================================================================
  // 公共方法 - 清理
  // ========================================================================

  /**
   * 清空所有数据
   */
  clear(): void {
    this.opportunities.clear();
    this.spreadHistory.clear();
  }

  /**
   * 清空指定交易对的数据
   * @param symbol - 交易对
   */
  clearSymbol(symbol: string): void {
    // 删除该交易对的机会
    for (const [id, opportunity] of this.opportunities) {
      if (opportunity.symbol === symbol) {
        this.opportunities.delete(id);
      }
    }

    // 删除该交易对的利差历史
    for (const key of this.spreadHistory.keys()) {
      if (key.startsWith(symbol)) {
        this.spreadHistory.delete(key);
      }
    }
  }

  // ========================================================================
  // 私有方法 - 方向确定
  // ========================================================================

  /**
   * 确定套利方向
   * @param exchange1 - 交易所1
   * @param exchange2 - 交易所2
   * @param rate1 - 交易所1年化费率
   * @param rate2 - 交易所2年化费率
   */
  private determineDirection(
    exchange1: ExchangeId,
    exchange2: ExchangeId,
    rate1: number,
    rate2: number
  ): ArbitrageDirection {
    // 做多低费率交易所（收取资金费或少付）
    // 做空高费率交易所（支付资金费）
    if (rate1 > rate2) {
      // exchange1 费率更高，做空 exchange1，做多 exchange2
      return {
        longExchange: exchange2,
        shortExchange: exchange1,
        spread: rate1 - rate2,
      };
    } else {
      // exchange2 费率更高，做空 exchange2，做多 exchange1
      return {
        longExchange: exchange1,
        shortExchange: exchange2,
        spread: rate2 - rate1,
      };
    }
  }

  // ========================================================================
  // 私有方法 - 置信度计算
  // ========================================================================

  /**
   * 计算综合置信度
   * @param longPrediction - 做多交易所预测
   * @param shortPrediction - 做空交易所预测
   */
  private calculateCombinedConfidence(
    longPrediction?: FundingRatePrediction,
    shortPrediction?: FundingRatePrediction
  ): number {
    // 如果没有预测，使用默认值
    const longConfidence = longPrediction?.confidence ?? 0.5;
    const shortConfidence = shortPrediction?.confidence ?? 0.5;

    // 综合置信度 = 几何平均
    return Math.sqrt(longConfidence * shortConfidence);
  }

  // ========================================================================
  // 私有方法 - 利差统计
  // ========================================================================

  /**
   * 记录利差历史
   * @param symbol - 交易对
   * @param direction - 套利方向
   * @param spread - 利差
   */
  private recordSpreadHistory(
    symbol: string,
    direction: ArbitrageDirection,
    spread: number
  ): void {
    // 生成历史键
    const key = this.getSpreadHistoryKey(symbol, direction);

    // 获取或创建历史数组
    let history = this.spreadHistory.get(key);
    if (!history) {
      history = [];
      this.spreadHistory.set(key, history);
    }

    // 添加记录
    history.push({
      timestamp: Date.now(),
      spread,
    });

    // 限制历史大小
    if (history.length > this.maxSpreadHistorySize) {
      history.splice(0, history.length - this.maxSpreadHistorySize);
    }
  }

  /**
   * 计算利差统计
   * @param symbol - 交易对
   * @param direction - 套利方向
   */
  private calculateSpreadStats(
    symbol: string,
    direction: ArbitrageDirection
  ): { trend: number; stdDev: number } {
    // 生成历史键
    const key = this.getSpreadHistoryKey(symbol, direction);

    // 获取历史
    const history = this.spreadHistory.get(key);

    // 如果历史不足，返回默认值
    if (!history || history.length < 3) {
      return { trend: 0, stdDev: 0.01 };
    }

    // 提取利差值
    const spreads = history.map((h) => h.spread);

    // 计算平均值
    const mean = spreads.reduce((a, b) => a + b, 0) / spreads.length;

    // 计算标准差
    const variance = spreads.reduce((acc, s) => acc + Math.pow(s - mean, 2), 0) / spreads.length;
    const stdDev = Math.sqrt(variance);

    // 计算趋势（简单线性回归斜率）
    const n = spreads.length;
    const xMean = (n - 1) / 2;

    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (spreads[i]! - mean);
      denominator += Math.pow(i - xMean, 2);
    }

    const trend = denominator !== 0 ? numerator / denominator : 0;

    return { trend, stdDev };
  }

  /**
   * 生成利差历史键
   * @param symbol - 交易对
   * @param direction - 套利方向
   */
  private getSpreadHistoryKey(symbol: string, direction: ArbitrageDirection): string {
    return `${symbol}_${direction.longExchange}_${direction.shortExchange}`;
  }

  // ========================================================================
  // 私有方法 - 风险计算
  // ========================================================================

  /**
   * 计算风险评分
   * @param spread - 年化利差
   * @param spreadStdDev - 利差标准差
   * @param confidence - 综合置信度
   * @param longExchange - 做多交易所
   * @param shortExchange - 做空交易所
   */
  private calculateRiskScore(
    spread: number,
    spreadStdDev: number,
    confidence: number,
    longExchange: ExchangeId,
    shortExchange: ExchangeId
  ): number {
    // 风险评分 = 各因子加权求和（0-100）

    // 1. 利差稳定性风险（标准差越大风险越高）
    // 假设标准差 > 5% 年化为高风险
    const stabilityRisk = Math.min(100, (spreadStdDev / 0.05) * 100);

    // 2. 置信度风险（置信度越低风险越高）
    const confidenceRisk = (1 - confidence) * 100;

    // 3. 交易所风险
    const longExchangeRisk = this.config.exchangeRiskScores[longExchange] * 100;
    const shortExchangeRisk = this.config.exchangeRiskScores[shortExchange] * 100;
    const exchangeRisk = (longExchangeRisk + shortExchangeRisk) / 2;

    // 4. 流动性风险（简化：假设利差越大流动性风险越高，因为可能是流动性差导致的）
    // 正常利差 15-30% 风险低，超过 50% 风险高
    const liquidityRisk = spread > 0.5 ? 80 : spread > 0.3 ? 50 : 20;

    // 加权计算
    const weights = this.config.riskWeights;
    const riskScore =
      stabilityRisk * weights.spreadStability +
      confidenceRisk * weights.confidence +
      exchangeRisk * weights.exchangeRisk +
      liquidityRisk * weights.liquidityRisk;

    // 限制在 0-100 范围
    return Math.max(0, Math.min(100, riskScore));
  }

  // ========================================================================
  // 私有方法 - 收益和仓位计算
  // ========================================================================

  /**
   * 计算预期收益
   * @param spread - 年化利差
   * @param riskScore - 风险评分
   */
  private calculateExpectedReturn(spread: number, riskScore: number): number {
    // 预期收益 = 利差 - 预估成本
    // 预估成本包括：滑点（0.05%）+ 手续费（0.05%）+ 资金成本（基于风险调整）

    // 固定成本
    const slippageCost = 0.0005; // 0.05%
    const feeCost = 0.0005;      // 0.05%

    // 风险调整成本（风险越高，预期收益折扣越大）
    const riskDiscount = (riskScore / 100) * 0.02; // 风险评分 100 时折扣 2%

    // 年化预期收益
    const expectedReturn = spread - slippageCost - feeCost - riskDiscount;

    return Math.max(0, expectedReturn);
  }

  /**
   * 计算建议仓位比例
   * @param spread - 年化利差
   * @param riskScore - 风险评分
   * @param confidence - 置信度
   */
  private calculateSuggestedSize(
    spread: number,
    riskScore: number,
    confidence: number
  ): number {
    // 基础仓位 = 50%
    let baseSize = 0.5;

    // 利差调整（利差越大，仓位越大，但有上限）
    // 15% 利差 -> 1.0x，30% 利差 -> 1.5x，50%+ 利差 -> 2.0x
    const spreadMultiplier = Math.min(2.0, 1.0 + (spread - 0.15) / 0.15);

    // 风险调整（风险越高，仓位越小）
    // 风险 0 -> 1.0x，风险 50 -> 0.5x，风险 100 -> 0.0x
    const riskMultiplier = Math.max(0, 1 - riskScore / 100);

    // 置信度调整（置信度越高，仓位越大）
    const confidenceMultiplier = 0.5 + confidence * 0.5; // 0.5x - 1.0x

    // 计算建议仓位比例
    const suggestedSize = baseSize * spreadMultiplier * riskMultiplier * confidenceMultiplier;

    // 限制在 0.1 - 1.0 范围
    return Math.max(0.1, Math.min(1.0, suggestedSize));
  }

  // ========================================================================
  // 私有方法 - 清理
  // ========================================================================

  /**
   * 清理过期机会
   */
  private cleanupExpiredOpportunities(): void {
    // 当前时间
    const now = Date.now();

    // 遍历所有机会
    for (const [id, opportunity] of this.opportunities) {
      // 检查是否过期
      if (opportunity.validUntil < now) {
        this.opportunities.delete(id);
      }
    }
  }
}

// ============================================================================
// 导出工厂函数
// ============================================================================

/**
 * 创建套利检测器
 * @param fundingCalculator - 资金费率计算器
 * @param config - 配置（可选）
 */
export function createArbitrageDetector(
  fundingCalculator: FundingCalculator,
  config?: Partial<ArbitrageDetectorConfig>
): ArbitrageDetector {
  return new ArbitrageDetector(fundingCalculator, config);
}

// 导出默认配置和类型
export { DEFAULT_ARBITRAGE_DETECTOR_CONFIG };
export type { ArbitrageDetectorConfig, ArbitrageOpportunityDetails };
