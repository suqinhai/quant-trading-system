// ============================================================================
// 回测统计计算器
// 计算回测的各种性能指标
// ============================================================================

import Decimal from 'decimal.js';

import type {
  BacktestConfig,
  BacktestResult,
  BacktestStats,
  ClosedTrade,
  EquityPoint,
} from './types';

// ============================================================================
// 常量定义
// ============================================================================

// 一年的交易天数（用于年化计算）
const TRADING_DAYS_PER_YEAR = 252;

// 无风险利率（用于夏普比率计算）
const RISK_FREE_RATE = new Decimal(0.02); // 2%

// ============================================================================
// 统计计算器
// ============================================================================

/**
 * 回测统计计算器
 *
 * 计算各种性能指标：
 * - 收益指标：总收益、年化收益
 * - 风险指标：最大回撤、波动率、夏普比率
 * - 交易统计：胜率、盈亏比、平均持仓时间
 */
export class StatsCalculator {
  /**
   * 计算完整的回测统计
   */
  public static calculate(
    config: BacktestConfig,
    equityCurve: EquityPoint[],
    trades: ClosedTrade[]
  ): BacktestStats {
    // 基础数据
    const initialCapital = config.initialCapital;
    const finalEquity =
      equityCurve.length > 0 ? equityCurve[equityCurve.length - 1]!.equity : initialCapital;

    // 时间范围
    const startTime = config.startTime;
    const endTime = config.endTime;
    const tradingDays = Math.ceil((endTime - startTime) / (24 * 60 * 60 * 1000));

    // 收益计算
    const totalReturn = finalEquity.minus(initialCapital);
    const totalReturnPercent = totalReturn.dividedBy(initialCapital).times(100);

    // 日收益率序列
    const dailyReturns = this.calculateDailyReturns(equityCurve);

    // 年化收益率
    const annualizedReturn = this.calculateAnnualizedReturn(totalReturnPercent, tradingDays);

    // 风险指标
    const maxDrawdownInfo = this.calculateMaxDrawdown(equityCurve);
    const volatility = this.calculateVolatility(dailyReturns);
    const sharpeRatio = this.calculateSharpeRatio(dailyReturns, volatility);
    const sortinoRatio = this.calculateSortinoRatio(dailyReturns);
    const calmarRatio = this.calculateCalmarRatio(annualizedReturn, maxDrawdownInfo.maxDrawdown);

    // 交易统计
    const tradeStats = this.calculateTradeStats(trades);

    // 手续费和滑点统计
    const totalCommission = trades.reduce(
      (sum, trade) => sum.plus(trade.commission),
      new Decimal(0)
    );

    return {
      // 基础指标
      initialCapital,
      finalEquity,
      totalReturn,
      totalReturnPercent,
      annualizedReturn,

      // 风险指标
      maxDrawdown: maxDrawdownInfo.maxDrawdown,
      maxDrawdownDuration: maxDrawdownInfo.maxDrawdownDuration,
      volatility,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,

      // 交易统计
      ...tradeStats,

      // 其他指标
      totalCommission,
      totalSlippage: new Decimal(0), // 滑点已包含在执行价格中
      startTime,
      endTime,
      tradingDays,
    };
  }

  /**
   * 计算日收益率序列
   */
  private static calculateDailyReturns(equityCurve: EquityPoint[]): Decimal[] {
    if (equityCurve.length < 2) {
      return [];
    }

    const returns: Decimal[] = [];

    for (let i = 1; i < equityCurve.length; i++) {
      const prevEquity = equityCurve[i - 1]!.equity;
      const currEquity = equityCurve[i]!.equity;

      if (!prevEquity.isZero()) {
        const dailyReturn = currEquity.minus(prevEquity).dividedBy(prevEquity);
        returns.push(dailyReturn);
      }
    }

    return returns;
  }

  /**
   * 计算年化收益率
   */
  private static calculateAnnualizedReturn(totalReturnPercent: Decimal, days: number): Decimal {
    if (days <= 0) {
      return new Decimal(0);
    }

    // 年化收益率 = (1 + 总收益率) ^ (365/天数) - 1
    const totalReturnRatio = totalReturnPercent.dividedBy(100).plus(1);
    const exponent = new Decimal(365).dividedBy(days);

    // 使用对数计算避免精度问题
    const annualized = Decimal.pow(totalReturnRatio, exponent).minus(1).times(100);

    return annualized;
  }

  /**
   * 计算最大回撤
   */
  private static calculateMaxDrawdown(equityCurve: EquityPoint[]): {
    maxDrawdown: Decimal;
    maxDrawdownDuration: number;
  } {
    if (equityCurve.length === 0) {
      return { maxDrawdown: new Decimal(0), maxDrawdownDuration: 0 };
    }

    let maxDrawdown = new Decimal(0);
    let maxDrawdownDuration = 0;
    let peak = equityCurve[0]!.equity;
    let peakTime = equityCurve[0]!.timestamp;
    let currentDrawdownStart = equityCurve[0]!.timestamp;

    for (const point of equityCurve) {
      if (point.equity.greaterThan(peak)) {
        // 新高点
        peak = point.equity;
        peakTime = point.timestamp;
        currentDrawdownStart = point.timestamp;
      } else {
        // 计算当前回撤
        const drawdown = peak.minus(point.equity).dividedBy(peak).times(100);

        if (drawdown.greaterThan(maxDrawdown)) {
          maxDrawdown = drawdown;
        }

        // 计算回撤持续时间
        const duration = Math.ceil(
          (point.timestamp - currentDrawdownStart) / (24 * 60 * 60 * 1000)
        );
        if (duration > maxDrawdownDuration) {
          maxDrawdownDuration = duration;
        }
      }
    }

    return { maxDrawdown, maxDrawdownDuration };
  }

  /**
   * 计算波动率（年化）
   */
  private static calculateVolatility(dailyReturns: Decimal[]): Decimal {
    if (dailyReturns.length < 2) {
      return new Decimal(0);
    }

    // 计算平均收益率
    const sum = dailyReturns.reduce((acc, r) => acc.plus(r), new Decimal(0));
    const mean = sum.dividedBy(dailyReturns.length);

    // 计算方差
    const squaredDiffs = dailyReturns.map(r => r.minus(mean).pow(2));
    const variance = squaredDiffs
      .reduce((acc, d) => acc.plus(d), new Decimal(0))
      .dividedBy(dailyReturns.length - 1);

    // 标准差
    const stdDev = variance.sqrt();

    // 年化波动率
    return stdDev.times(Decimal.sqrt(TRADING_DAYS_PER_YEAR)).times(100);
  }

  /**
   * 计算夏普比率
   */
  private static calculateSharpeRatio(dailyReturns: Decimal[], annualizedVol: Decimal): Decimal {
    if (dailyReturns.length === 0 || annualizedVol.isZero()) {
      return new Decimal(0);
    }

    // 计算年化收益率
    const sum = dailyReturns.reduce((acc, r) => acc.plus(r), new Decimal(0));
    const avgDailyReturn = sum.dividedBy(dailyReturns.length);
    const annualizedReturn = avgDailyReturn.times(TRADING_DAYS_PER_YEAR);

    // 夏普比率 = (年化收益率 - 无风险利率) / 年化波动率
    const excessReturn = annualizedReturn.minus(RISK_FREE_RATE);
    const sharpe = excessReturn.dividedBy(annualizedVol.dividedBy(100));

    return sharpe;
  }

  /**
   * 计算索提诺比率
   * 只考虑下行波动率
   */
  private static calculateSortinoRatio(dailyReturns: Decimal[]): Decimal {
    if (dailyReturns.length < 2) {
      return new Decimal(0);
    }

    // 计算平均收益率
    const sum = dailyReturns.reduce((acc, r) => acc.plus(r), new Decimal(0));
    const avgDailyReturn = sum.dividedBy(dailyReturns.length);
    const annualizedReturn = avgDailyReturn.times(TRADING_DAYS_PER_YEAR);

    // 只计算负收益的标准差（下行波动率）
    const negativeReturns = dailyReturns.filter(r => r.isNegative());

    if (negativeReturns.length === 0) {
      return new Decimal(Infinity); // 没有负收益
    }

    const negSquaredSum = negativeReturns.reduce((acc, r) => acc.plus(r.pow(2)), new Decimal(0));
    const downwardDeviation = negSquaredSum.dividedBy(dailyReturns.length).sqrt();
    const annualizedDownwardDev = downwardDeviation.times(Decimal.sqrt(TRADING_DAYS_PER_YEAR));

    if (annualizedDownwardDev.isZero()) {
      return new Decimal(0);
    }

    // 索提诺比率 = (年化收益率 - 无风险利率) / 年化下行波动率
    const excessReturn = annualizedReturn.minus(RISK_FREE_RATE);
    return excessReturn.dividedBy(annualizedDownwardDev);
  }

  /**
   * 计算卡尔玛比率
   */
  private static calculateCalmarRatio(
    annualizedReturn: Decimal,
    maxDrawdown: Decimal
  ): Decimal {
    if (maxDrawdown.isZero()) {
      return new Decimal(0);
    }

    // 卡尔玛比率 = 年化收益率 / 最大回撤
    return annualizedReturn.dividedBy(maxDrawdown);
  }

  /**
   * 计算交易统计
   */
  private static calculateTradeStats(trades: ClosedTrade[]): {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: Decimal;
    avgWin: Decimal;
    avgLoss: Decimal;
    profitFactor: Decimal;
    avgHoldingPeriod: number;
    maxConsecutiveWins: number;
    maxConsecutiveLosses: number;
  } {
    const totalTrades = trades.length;

    if (totalTrades === 0) {
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: new Decimal(0),
        avgWin: new Decimal(0),
        avgLoss: new Decimal(0),
        profitFactor: new Decimal(0),
        avgHoldingPeriod: 0,
        maxConsecutiveWins: 0,
        maxConsecutiveLosses: 0,
      };
    }

    // 分离盈利和亏损交易
    const winningTrades = trades.filter(t => t.netPnl.isPositive());
    const losingTrades = trades.filter(t => t.netPnl.isNegative());

    // 胜率
    const winRate = new Decimal(winningTrades.length).dividedBy(totalTrades).times(100);

    // 平均盈利
    const totalWin = winningTrades.reduce((sum, t) => sum.plus(t.netPnl), new Decimal(0));
    const avgWin =
      winningTrades.length > 0 ? totalWin.dividedBy(winningTrades.length) : new Decimal(0);

    // 平均亏损
    const totalLoss = losingTrades.reduce((sum, t) => sum.plus(t.netPnl.abs()), new Decimal(0));
    const avgLoss =
      losingTrades.length > 0 ? totalLoss.dividedBy(losingTrades.length) : new Decimal(0);

    // 盈亏比
    const profitFactor = totalLoss.isZero() ? new Decimal(0) : totalWin.dividedBy(totalLoss);

    // 平均持仓时间
    const totalHoldingPeriod = trades.reduce((sum, t) => sum + t.holdingPeriod, 0);
    const avgHoldingPeriod = Math.round(totalHoldingPeriod / totalTrades);

    // 最大连续盈利/亏损
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    let currentWins = 0;
    let currentLosses = 0;

    for (const trade of trades) {
      if (trade.netPnl.isPositive()) {
        currentWins++;
        currentLosses = 0;
        maxConsecutiveWins = Math.max(maxConsecutiveWins, currentWins);
      } else if (trade.netPnl.isNegative()) {
        currentLosses++;
        currentWins = 0;
        maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLosses);
      }
    }

    return {
      totalTrades,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      avgHoldingPeriod,
      maxConsecutiveWins,
      maxConsecutiveLosses,
    };
  }

  /**
   * 生成权益曲线
   */
  public static generateEquityCurve(
    initialCapital: Decimal,
    trades: ClosedTrade[],
    startTime: number,
    endTime: number
  ): EquityPoint[] {
    const curve: EquityPoint[] = [];

    // 按时间排序交易
    const sortedTrades = [...trades].sort((a, b) => a.exitTime - b.exitTime);

    let currentEquity = initialCapital;
    let peakEquity = initialCapital;

    // 添加起始点
    curve.push({
      timestamp: startTime,
      equity: initialCapital,
      cash: initialCapital,
      positionValue: new Decimal(0),
      cumulativeReturn: new Decimal(0),
      drawdown: new Decimal(0),
    });

    // 按交易更新权益
    for (const trade of sortedTrades) {
      currentEquity = currentEquity.plus(trade.netPnl);

      // 更新峰值
      if (currentEquity.greaterThan(peakEquity)) {
        peakEquity = currentEquity;
      }

      // 计算回撤
      const drawdown = peakEquity.minus(currentEquity).dividedBy(peakEquity).times(100);

      // 计算累计收益
      const cumulativeReturn = currentEquity
        .minus(initialCapital)
        .dividedBy(initialCapital)
        .times(100);

      curve.push({
        timestamp: trade.exitTime,
        equity: currentEquity,
        cash: currentEquity, // 简化：假设平仓后全是现金
        positionValue: new Decimal(0),
        cumulativeReturn,
        drawdown,
      });
    }

    // 添加结束点（如果最后一笔交易不在结束时间）
    if (curve.length > 0 && curve[curve.length - 1]!.timestamp < endTime) {
      const lastPoint = curve[curve.length - 1]!;
      curve.push({
        ...lastPoint,
        timestamp: endTime,
      });
    }

    return curve;
  }
}
