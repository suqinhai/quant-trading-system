// ============================================================================
// 示例策略：RSI 超买超卖策略
// 基于 RSI 指标的均值回归策略
// ============================================================================

import Decimal from 'decimal.js';

import type { Symbol } from '@quant/exchange';
import type { Kline } from '@quant/marketdata';
import type { BacktestContext } from '@quant/backtest';

import { BaseStrategy, type StrategyParams } from '../base.js';

// ============================================================================
// 参数接口
// ============================================================================

/**
 * RSI 策略参数
 */
export interface RSIParams extends StrategyParams {
  // RSI 周期
  readonly period: number;

  // 超买阈值
  readonly overbought: number;

  // 超卖阈值
  readonly oversold: number;

  // 是否等待 RSI 回归中性区域才平仓
  readonly waitForNeutral?: boolean;

  // 中性区域下限
  readonly neutralLow?: number;

  // 中性区域上限
  readonly neutralHigh?: number;
}

// ============================================================================
// 策略实现
// ============================================================================

/**
 * RSI 超买超卖策略
 *
 * 交易逻辑：
 * - RSI 低于超卖阈值：做多（预期价格反弹）
 * - RSI 高于超买阈值：做空或平多（预期价格回落）
 *
 * 这是一个均值回归策略，适用于震荡市场
 */
export class RSIStrategy extends BaseStrategy {
  public readonly name = 'RSI';
  public readonly description = 'RSI Overbought/Oversold Mean Reversion Strategy';

  protected readonly params: RSIParams;

  // 上一根 K 线的 RSI 值
  private prevRSI: Map<Symbol, Decimal> = new Map();

  public constructor(params: RSIParams) {
    super(params);
    this.params = {
      period: 14,
      overbought: 70,
      oversold: 30,
      waitForNeutral: true,
      neutralLow: 40,
      neutralHigh: 60,
      ...params,
    };
  }

  protected override async onInitialize(context: BacktestContext): Promise<void> {
    this.logger.info(
      {
        period: this.params.period,
        overbought: this.params.overbought,
        oversold: this.params.oversold,
      },
      'RSI strategy initialized'
    );
  }

  protected override async processBar(
    symbol: Symbol,
    kline: Kline,
    context: BacktestContext
  ): Promise<void> {
    // 获取足够的历史数据
    const requiredBars = this.params.period + 2;
    const closes = this.getCloses(symbol, requiredBars);

    if (closes.length < requiredBars) {
      return;
    }

    // 计算 RSI
    const rsiValues = this.indicators.RSI(closes, this.params.period);

    if (rsiValues.length === 0) {
      return;
    }

    const currentRSI = rsiValues[rsiValues.length - 1]!;
    const prevRSI = this.prevRSI.get(symbol);

    // 更新状态
    this.prevRSI.set(symbol, currentRSI);

    if (!prevRSI) {
      return;
    }

    const position = this.getPosition(symbol);
    const currentPrice = kline.close;

    // 超卖信号：RSI 从下方穿越超卖线
    const oversoldCross =
      prevRSI.lessThanOrEqualTo(this.params.oversold) &&
      currentRSI.greaterThan(this.params.oversold);

    // 超买信号：RSI 从上方穿越超买线
    const overboughtCross =
      prevRSI.greaterThanOrEqualTo(this.params.overbought) &&
      currentRSI.lessThan(this.params.overbought);

    // 进入中性区域
    const enteredNeutralFromBelow =
      prevRSI.lessThan(this.params.neutralLow ?? 40) &&
      currentRSI.greaterThanOrEqualTo(this.params.neutralLow ?? 40);

    const enteredNeutralFromAbove =
      prevRSI.greaterThan(this.params.neutralHigh ?? 60) &&
      currentRSI.lessThanOrEqualTo(this.params.neutralHigh ?? 60);

    // 交易逻辑
    if (!position) {
      // 无仓位时
      if (currentRSI.lessThan(this.params.oversold)) {
        // RSI 超卖，做多
        const quantity = this.calculatePositionSize(symbol);
        const stopLoss = this.calculateStopLoss(currentPrice, 'long');
        const takeProfit = this.calculateTakeProfit(currentPrice, 'long');

        this.long(symbol, {
          price: currentPrice,
          quantity,
          stopLoss,
          takeProfit,
          strength: new Decimal(this.params.oversold).minus(currentRSI).dividedBy(this.params.oversold).toNumber(),
        });

        this.log('info', 'RSI oversold, going long', {
          symbol,
          rsi: currentRSI.toFixed(2),
          price: currentPrice.toFixed(2),
        });
      } else if (currentRSI.greaterThan(this.params.overbought) && this.params.allowShort) {
        // RSI 超买且允许做空
        const quantity = this.calculatePositionSize(symbol);
        const stopLoss = this.calculateStopLoss(currentPrice, 'short');
        const takeProfit = this.calculateTakeProfit(currentPrice, 'short');

        this.short(symbol, {
          price: currentPrice,
          quantity,
          stopLoss,
          takeProfit,
        });

        this.log('info', 'RSI overbought, going short', {
          symbol,
          rsi: currentRSI.toFixed(2),
        });
      }
    } else {
      // 有仓位时
      if (position.side === 'long') {
        // 多仓平仓条件
        let shouldExit = false;

        if (this.params.waitForNeutral) {
          // 等待 RSI 回归中性区域
          shouldExit = currentRSI.greaterThanOrEqualTo(this.params.neutralHigh ?? 60);
        } else {
          // RSI 超买就平仓
          shouldExit = currentRSI.greaterThan(this.params.overbought);
        }

        if (shouldExit) {
          this.exitLong(symbol);
          this.log('info', 'RSI recovered, closing long', {
            symbol,
            rsi: currentRSI.toFixed(2),
            pnl: position.unrealizedPnl.toFixed(2),
          });
        }
      } else if (position.side === 'short') {
        // 空仓平仓条件
        let shouldExit = false;

        if (this.params.waitForNeutral) {
          shouldExit = currentRSI.lessThanOrEqualTo(this.params.neutralLow ?? 40);
        } else {
          shouldExit = currentRSI.lessThan(this.params.oversold);
        }

        if (shouldExit) {
          this.exitShort(symbol);
          this.log('info', 'RSI recovered, closing short', {
            symbol,
            rsi: currentRSI.toFixed(2),
            pnl: position.unrealizedPnl.toFixed(2),
          });
        }
      }
    }
  }
}
