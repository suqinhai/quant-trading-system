// ============================================================================
// 技术指标库
// 实现常用的技术分析指标
// ============================================================================

import Decimal from 'decimal.js';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 指标计算结果
 */
export interface IndicatorResult {
  // 指标值
  readonly value: Decimal;

  // 时间戳
  readonly timestamp: number;
}

/**
 * MACD 指标结果
 */
export interface MACDResult {
  // MACD 线（快线 - 慢线）
  readonly macd: Decimal;

  // 信号线（MACD 的 EMA）
  readonly signal: Decimal;

  // 柱状图（MACD - 信号线）
  readonly histogram: Decimal;

  // 时间戳
  readonly timestamp: number;
}

/**
 * 布林带结果
 */
export interface BollingerBandsResult {
  // 上轨
  readonly upper: Decimal;

  // 中轨（SMA）
  readonly middle: Decimal;

  // 下轨
  readonly lower: Decimal;

  // 带宽
  readonly bandwidth: Decimal;

  // %B 指标
  readonly percentB: Decimal;

  // 时间戳
  readonly timestamp: number;
}

/**
 * RSI 指标结果
 */
export interface RSIResult {
  // RSI 值（0-100）
  readonly value: Decimal;

  // 是否超买（> 70）
  readonly overbought: boolean;

  // 是否超卖（< 30）
  readonly oversold: boolean;

  // 时间戳
  readonly timestamp: number;
}

/**
 * ATR 指标结果
 */
export interface ATRResult {
  // ATR 值
  readonly value: Decimal;

  // ATR 百分比（ATR / 当前价格）
  readonly percent: Decimal;

  // 时间戳
  readonly timestamp: number;
}

// ============================================================================
// 技术指标实现
// ============================================================================

/**
 * 技术指标类
 *
 * 提供常用技术指标的计算方法
 * 所有方法都是静态的，使用 Decimal.js 保证精度
 */
export class Indicators {
  // ==========================================================================
  // 移动平均线
  // ==========================================================================

  /**
   * 简单移动平均线 (SMA)
   *
   * SMA = (P1 + P2 + ... + Pn) / n
   *
   * @param values - 价格数组
   * @param period - 周期
   * @returns SMA 值数组
   */
  public static SMA(values: Decimal[], period: number): Decimal[] {
    // 验证输入
    if (values.length < period) {
      return [];
    }

    const result: Decimal[] = [];

    for (let i = period - 1; i < values.length; i++) {
      // 计算窗口内的总和
      let sum = new Decimal(0);
      for (let j = 0; j < period; j++) {
        sum = sum.plus(values[i - j]!);
      }

      // 计算平均值
      result.push(sum.dividedBy(period));
    }

    return result;
  }

  /**
   * 指数移动平均线 (EMA)
   *
   * EMA = Price * k + EMA(prev) * (1 - k)
   * k = 2 / (period + 1)
   *
   * @param values - 价格数组
   * @param period - 周期
   * @returns EMA 值数组
   */
  public static EMA(values: Decimal[], period: number): Decimal[] {
    if (values.length < period) {
      return [];
    }

    const result: Decimal[] = [];

    // 计算乘数
    const multiplier = new Decimal(2).dividedBy(period + 1);
    const oneMinusMultiplier = new Decimal(1).minus(multiplier);

    // 第一个 EMA 使用 SMA
    let sum = new Decimal(0);
    for (let i = 0; i < period; i++) {
      sum = sum.plus(values[i]!);
    }
    let ema = sum.dividedBy(period);
    result.push(ema);

    // 后续使用 EMA 公式
    for (let i = period; i < values.length; i++) {
      ema = values[i]!.times(multiplier).plus(ema.times(oneMinusMultiplier));
      result.push(ema);
    }

    return result;
  }

  /**
   * 加权移动平均线 (WMA)
   *
   * WMA = (P1 * n + P2 * (n-1) + ... + Pn * 1) / (n * (n+1) / 2)
   *
   * @param values - 价格数组
   * @param period - 周期
   * @returns WMA 值数组
   */
  public static WMA(values: Decimal[], period: number): Decimal[] {
    if (values.length < period) {
      return [];
    }

    const result: Decimal[] = [];

    // 权重分母
    const denominator = new Decimal((period * (period + 1)) / 2);

    for (let i = period - 1; i < values.length; i++) {
      let weightedSum = new Decimal(0);

      for (let j = 0; j < period; j++) {
        // 权重从 period 递减到 1
        const weight = period - j;
        weightedSum = weightedSum.plus(values[i - j]!.times(weight));
      }

      result.push(weightedSum.dividedBy(denominator));
    }

    return result;
  }

  // ==========================================================================
  // 动量指标
  // ==========================================================================

  /**
   * 相对强弱指标 (RSI)
   *
   * RSI = 100 - (100 / (1 + RS))
   * RS = 平均上涨 / 平均下跌
   *
   * @param values - 价格数组
   * @param period - 周期（通常为 14）
   * @returns RSI 值数组
   */
  public static RSI(values: Decimal[], period: number = 14): Decimal[] {
    if (values.length < period + 1) {
      return [];
    }

    const result: Decimal[] = [];

    // 计算价格变化
    const changes: Decimal[] = [];
    for (let i = 1; i < values.length; i++) {
      changes.push(values[i]!.minus(values[i - 1]!));
    }

    // 分离上涨和下跌
    const gains: Decimal[] = changes.map(c => (c.isPositive() ? c : new Decimal(0)));
    const losses: Decimal[] = changes.map(c => (c.isNegative() ? c.abs() : new Decimal(0)));

    // 第一个 RSI 使用简单平均
    let avgGain = new Decimal(0);
    let avgLoss = new Decimal(0);

    for (let i = 0; i < period; i++) {
      avgGain = avgGain.plus(gains[i]!);
      avgLoss = avgLoss.plus(losses[i]!);
    }

    avgGain = avgGain.dividedBy(period);
    avgLoss = avgLoss.dividedBy(period);

    // 计算第一个 RSI
    if (avgLoss.isZero()) {
      result.push(new Decimal(100));
    } else {
      const rs = avgGain.dividedBy(avgLoss);
      const rsi = new Decimal(100).minus(new Decimal(100).dividedBy(rs.plus(1)));
      result.push(rsi);
    }

    // 后续使用平滑方法
    for (let i = period; i < changes.length; i++) {
      avgGain = avgGain.times(period - 1).plus(gains[i]!).dividedBy(period);
      avgLoss = avgLoss.times(period - 1).plus(losses[i]!).dividedBy(period);

      if (avgLoss.isZero()) {
        result.push(new Decimal(100));
      } else {
        const rs = avgGain.dividedBy(avgLoss);
        const rsi = new Decimal(100).minus(new Decimal(100).dividedBy(rs.plus(1)));
        result.push(rsi);
      }
    }

    return result;
  }

  /**
   * MACD 指标
   *
   * MACD = EMA(12) - EMA(26)
   * Signal = EMA(MACD, 9)
   * Histogram = MACD - Signal
   *
   * @param values - 价格数组
   * @param fastPeriod - 快线周期（默认 12）
   * @param slowPeriod - 慢线周期（默认 26）
   * @param signalPeriod - 信号线周期（默认 9）
   * @returns MACD 结果数组
   */
  public static MACD(
    values: Decimal[],
    fastPeriod: number = 12,
    slowPeriod: number = 26,
    signalPeriod: number = 9
  ): { macd: Decimal[]; signal: Decimal[]; histogram: Decimal[] } {
    // 计算快线和慢线 EMA
    const fastEMA = this.EMA(values, fastPeriod);
    const slowEMA = this.EMA(values, slowPeriod);

    // 对齐数据（慢线比快线晚开始）
    const offset = slowPeriod - fastPeriod;
    const macdLine: Decimal[] = [];

    for (let i = 0; i < slowEMA.length; i++) {
      macdLine.push(fastEMA[i + offset]!.minus(slowEMA[i]!));
    }

    // 计算信号线
    const signalLine = this.EMA(macdLine, signalPeriod);

    // 对齐 MACD 和信号线
    const signalOffset = signalPeriod - 1;
    const histogram: Decimal[] = [];

    for (let i = 0; i < signalLine.length; i++) {
      histogram.push(macdLine[i + signalOffset]!.minus(signalLine[i]!));
    }

    return {
      macd: macdLine.slice(signalOffset),
      signal: signalLine,
      histogram,
    };
  }

  /**
   * 随机指标 (Stochastic Oscillator)
   *
   * %K = (Close - Lowest Low) / (Highest High - Lowest Low) * 100
   * %D = SMA(%K, 3)
   *
   * @param highs - 最高价数组
   * @param lows - 最低价数组
   * @param closes - 收盘价数组
   * @param kPeriod - %K 周期（默认 14）
   * @param dPeriod - %D 周期（默认 3）
   * @returns { k, d } 数组
   */
  public static Stochastic(
    highs: Decimal[],
    lows: Decimal[],
    closes: Decimal[],
    kPeriod: number = 14,
    dPeriod: number = 3
  ): { k: Decimal[]; d: Decimal[] } {
    if (closes.length < kPeriod) {
      return { k: [], d: [] };
    }

    const kValues: Decimal[] = [];

    for (let i = kPeriod - 1; i < closes.length; i++) {
      // 找到窗口内的最高和最低价
      let highestHigh = highs[i - kPeriod + 1]!;
      let lowestLow = lows[i - kPeriod + 1]!;

      for (let j = i - kPeriod + 2; j <= i; j++) {
        if (highs[j]!.greaterThan(highestHigh)) {
          highestHigh = highs[j]!;
        }
        if (lows[j]!.lessThan(lowestLow)) {
          lowestLow = lows[j]!;
        }
      }

      // 计算 %K
      const range = highestHigh.minus(lowestLow);
      if (range.isZero()) {
        kValues.push(new Decimal(50)); // 无波动时返回中值
      } else {
        const k = closes[i]!.minus(lowestLow).dividedBy(range).times(100);
        kValues.push(k);
      }
    }

    // 计算 %D（%K 的 SMA）
    const dValues = this.SMA(kValues, dPeriod);

    return {
      k: kValues.slice(dPeriod - 1),
      d: dValues,
    };
  }

  // ==========================================================================
  // 波动率指标
  // ==========================================================================

  /**
   * 真实波动幅度 (True Range)
   *
   * TR = max(High - Low, |High - PrevClose|, |Low - PrevClose|)
   *
   * @param highs - 最高价数组
   * @param lows - 最低价数组
   * @param closes - 收盘价数组
   * @returns TR 值数组
   */
  public static TrueRange(highs: Decimal[], lows: Decimal[], closes: Decimal[]): Decimal[] {
    if (closes.length < 2) {
      return [];
    }

    const result: Decimal[] = [];

    for (let i = 1; i < closes.length; i++) {
      const highLow = highs[i]!.minus(lows[i]!);
      const highPrevClose = highs[i]!.minus(closes[i - 1]!).abs();
      const lowPrevClose = lows[i]!.minus(closes[i - 1]!).abs();

      const tr = Decimal.max(highLow, highPrevClose, lowPrevClose);
      result.push(tr);
    }

    return result;
  }

  /**
   * 平均真实波动幅度 (ATR)
   *
   * ATR = EMA(TR, period)
   *
   * @param highs - 最高价数组
   * @param lows - 最低价数组
   * @param closes - 收盘价数组
   * @param period - 周期（默认 14）
   * @returns ATR 值数组
   */
  public static ATR(
    highs: Decimal[],
    lows: Decimal[],
    closes: Decimal[],
    period: number = 14
  ): Decimal[] {
    const tr = this.TrueRange(highs, lows, closes);
    return this.EMA(tr, period);
  }

  /**
   * 布林带 (Bollinger Bands)
   *
   * Middle = SMA(Close, period)
   * Upper = Middle + stdDev * multiplier
   * Lower = Middle - stdDev * multiplier
   *
   * @param values - 价格数组
   * @param period - 周期（默认 20）
   * @param multiplier - 标准差乘数（默认 2）
   * @returns 布林带结果数组
   */
  public static BollingerBands(
    values: Decimal[],
    period: number = 20,
    multiplier: number = 2
  ): { upper: Decimal[]; middle: Decimal[]; lower: Decimal[] } {
    if (values.length < period) {
      return { upper: [], middle: [], lower: [] };
    }

    const middle = this.SMA(values, period);
    const upper: Decimal[] = [];
    const lower: Decimal[] = [];

    for (let i = 0; i < middle.length; i++) {
      // 计算标准差
      const windowStart = i;
      const windowEnd = i + period;
      const window = values.slice(windowStart, windowEnd);
      const mean = middle[i]!;

      let sumSquaredDiff = new Decimal(0);
      for (const val of window) {
        sumSquaredDiff = sumSquaredDiff.plus(val.minus(mean).pow(2));
      }

      const variance = sumSquaredDiff.dividedBy(period);
      const stdDev = variance.sqrt();

      // 计算上下轨
      const deviation = stdDev.times(multiplier);
      upper.push(mean.plus(deviation));
      lower.push(mean.minus(deviation));
    }

    return { upper, middle, lower };
  }

  // ==========================================================================
  // 趋势指标
  // ==========================================================================

  /**
   * 平均趋向指数 (ADX)
   *
   * 衡量趋势的强度（不区分方向）
   *
   * @param highs - 最高价数组
   * @param lows - 最低价数组
   * @param closes - 收盘价数组
   * @param period - 周期（默认 14）
   * @returns { adx, plusDI, minusDI } 数组
   */
  public static ADX(
    highs: Decimal[],
    lows: Decimal[],
    closes: Decimal[],
    period: number = 14
  ): { adx: Decimal[]; plusDI: Decimal[]; minusDI: Decimal[] } {
    if (closes.length < period + 1) {
      return { adx: [], plusDI: [], minusDI: [] };
    }

    // 计算 +DM 和 -DM
    const plusDM: Decimal[] = [];
    const minusDM: Decimal[] = [];

    for (let i = 1; i < highs.length; i++) {
      const upMove = highs[i]!.minus(highs[i - 1]!);
      const downMove = lows[i - 1]!.minus(lows[i]!);

      if (upMove.greaterThan(downMove) && upMove.isPositive()) {
        plusDM.push(upMove);
      } else {
        plusDM.push(new Decimal(0));
      }

      if (downMove.greaterThan(upMove) && downMove.isPositive()) {
        minusDM.push(downMove);
      } else {
        minusDM.push(new Decimal(0));
      }
    }

    // 计算 TR 和 ATR
    const tr = this.TrueRange(highs, lows, closes);
    const atr = this.EMA(tr, period);

    // 计算平滑的 +DM 和 -DM
    const smoothedPlusDM = this.EMA(plusDM, period);
    const smoothedMinusDM = this.EMA(minusDM, period);

    // 计算 +DI 和 -DI
    const plusDI: Decimal[] = [];
    const minusDI: Decimal[] = [];
    const dx: Decimal[] = [];

    for (let i = 0; i < atr.length && i < smoothedPlusDM.length; i++) {
      const pdi = atr[i]!.isZero()
        ? new Decimal(0)
        : smoothedPlusDM[i]!.dividedBy(atr[i]!).times(100);
      const mdi = atr[i]!.isZero()
        ? new Decimal(0)
        : smoothedMinusDM[i]!.dividedBy(atr[i]!).times(100);

      plusDI.push(pdi);
      minusDI.push(mdi);

      // 计算 DX
      const diSum = pdi.plus(mdi);
      const diDiff = pdi.minus(mdi).abs();
      const dxValue = diSum.isZero() ? new Decimal(0) : diDiff.dividedBy(diSum).times(100);
      dx.push(dxValue);
    }

    // 计算 ADX（DX 的 EMA）
    const adx = this.EMA(dx, period);

    // 对齐数据
    const offset = period - 1;
    return {
      adx,
      plusDI: plusDI.slice(offset),
      minusDI: minusDI.slice(offset),
    };
  }

  // ==========================================================================
  // 成交量指标
  // ==========================================================================

  /**
   * 成交量加权平均价格 (VWAP)
   *
   * VWAP = Σ(Price * Volume) / Σ(Volume)
   *
   * @param highs - 最高价数组
   * @param lows - 最低价数组
   * @param closes - 收盘价数组
   * @param volumes - 成交量数组
   * @returns VWAP 值数组
   */
  public static VWAP(
    highs: Decimal[],
    lows: Decimal[],
    closes: Decimal[],
    volumes: Decimal[]
  ): Decimal[] {
    const result: Decimal[] = [];

    let cumulativePV = new Decimal(0);
    let cumulativeVolume = new Decimal(0);

    for (let i = 0; i < closes.length; i++) {
      // 典型价格 = (H + L + C) / 3
      const typicalPrice = highs[i]!.plus(lows[i]!).plus(closes[i]!).dividedBy(3);

      // 累计
      cumulativePV = cumulativePV.plus(typicalPrice.times(volumes[i]!));
      cumulativeVolume = cumulativeVolume.plus(volumes[i]!);

      // VWAP
      if (cumulativeVolume.isZero()) {
        result.push(typicalPrice);
      } else {
        result.push(cumulativePV.dividedBy(cumulativeVolume));
      }
    }

    return result;
  }

  /**
   * 能量潮指标 (OBV)
   *
   * 根据价格涨跌累加/减成交量
   *
   * @param closes - 收盘价数组
   * @param volumes - 成交量数组
   * @returns OBV 值数组
   */
  public static OBV(closes: Decimal[], volumes: Decimal[]): Decimal[] {
    if (closes.length === 0) {
      return [];
    }

    const result: Decimal[] = [volumes[0]!];

    for (let i = 1; i < closes.length; i++) {
      const prevOBV = result[i - 1]!;

      if (closes[i]!.greaterThan(closes[i - 1]!)) {
        // 价格上涨，OBV 增加
        result.push(prevOBV.plus(volumes[i]!));
      } else if (closes[i]!.lessThan(closes[i - 1]!)) {
        // 价格下跌，OBV 减少
        result.push(prevOBV.minus(volumes[i]!));
      } else {
        // 价格不变，OBV 不变
        result.push(prevOBV);
      }
    }

    return result;
  }
}
