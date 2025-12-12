// ============================================================================
// 示例策略：双均线交叉策略
// 经典的趋势跟踪策略
// ============================================================================

import Decimal from 'decimal.js';

import type { Symbol } from '@quant/exchange';
import type { Kline } from '@quant/marketdata';
import type { BacktestContext } from '@quant/backtest';

import { BaseStrategy, type StrategyParams } from '../base';

// ============================================================================
// 参数接口
// ============================================================================

/**
 * 双均线策略参数
 */
export interface DualMAParams extends StrategyParams {
  // 快线周期
  readonly fastPeriod: number;

  // 慢线周期
  readonly slowPeriod: number;

  // 使用 EMA 还是 SMA
  readonly useEMA?: boolean;
}

// ============================================================================
// 策略实现
// ============================================================================

/**
 * 双均线交叉策略
 *
 * 交易逻辑：
 * - 快线上穿慢线：做多
 * - 快线下穿慢线：平多（或做空）
 *
 * 风险控制：
 * - 固定百分比止损
 * - 固定百分比止盈
 */
export class DualMAStrategy extends BaseStrategy {
  // 策略名称
  public readonly name = 'DualMA';

  // 策略描述
  public readonly description = 'Dual Moving Average Crossover Strategy';

  // 策略参数（重新声明为具体类型）
  protected readonly params: DualMAParams;

  // 上一根 K 线的均线状态
  private prevFastMA: Map<Symbol, Decimal> = new Map();
  private prevSlowMA: Map<Symbol, Decimal> = new Map();

  /**
   * 构造函数
   * @param params - 策略参数
   */
  public constructor(params: DualMAParams) {
    super(params);
    this.params = {
      fastPeriod: 10,
      slowPeriod: 20,
      useEMA: true,
      ...params,
    };
  }

  /**
   * 初始化钩子
   */
  protected override async onInitialize(context: BacktestContext): Promise<void> {
    this.logger.info(
      {
        fastPeriod: this.params.fastPeriod,
        slowPeriod: this.params.slowPeriod,
        useEMA: this.params.useEMA,
      },
      'DualMA strategy initialized'
    );
  }

  /**
   * 处理单根 K 线
   */
  protected override async processBar(
    symbol: Symbol,
    kline: Kline,
    context: BacktestContext
  ): Promise<void> {
    // 获取足够的历史数据
    const requiredBars = this.params.slowPeriod + 1;
    const closes = this.getCloses(symbol, requiredBars);

    // 数据不足，跳过
    if (closes.length < requiredBars) {
      return;
    }

    // 计算均线
    const fastMA = this.params.useEMA
      ? this.indicators.EMA(closes, this.params.fastPeriod)
      : this.indicators.SMA(closes, this.params.fastPeriod);

    const slowMA = this.params.useEMA
      ? this.indicators.EMA(closes, this.params.slowPeriod)
      : this.indicators.SMA(closes, this.params.slowPeriod);

    // 获取最新的均线值
    const currentFastMA = fastMA[fastMA.length - 1];
    const currentSlowMA = slowMA[slowMA.length - 1];

    // 获取上一根 K 线的均线值
    const prevFast = this.prevFastMA.get(symbol);
    const prevSlow = this.prevSlowMA.get(symbol);

    // 更新状态
    if (currentFastMA) {
      this.prevFastMA.set(symbol, currentFastMA);
    }
    if (currentSlowMA) {
      this.prevSlowMA.set(symbol, currentSlowMA);
    }

    // 如果没有上一根 K 线的数据，跳过
    if (!prevFast || !prevSlow || !currentFastMA || !currentSlowMA) {
      return;
    }

    // 检测交叉
    const prevCross = prevFast.minus(prevSlow);
    const currentCross = currentFastMA.minus(currentSlowMA);

    // 金叉：快线从下往上穿越慢线
    const goldenCross = prevCross.isNegative() && currentCross.isPositive();

    // 死叉：快线从上往下穿越慢线
    const deathCross = prevCross.isPositive() && currentCross.isNegative();

    // 获取当前仓位
    const position = this.getPosition(symbol);

    // 交易逻辑
    if (goldenCross && !position) {
      // 金叉且无仓位：做多
      const quantity = this.calculatePositionSize(symbol);
      const currentPrice = kline.close;
      const stopLoss = this.calculateStopLoss(currentPrice, 'long');
      const takeProfit = this.calculateTakeProfit(currentPrice, 'long');

      this.long(symbol, {
        price: currentPrice,
        quantity,
        stopLoss,
        takeProfit,
        strength: currentCross.dividedBy(currentSlowMA).toNumber(), // 信号强度
      });

      this.log('info', 'Golden cross detected', {
        symbol,
        fastMA: currentFastMA.toFixed(2),
        slowMA: currentSlowMA.toFixed(2),
        price: currentPrice.toFixed(2),
      });
    } else if (deathCross && position?.side === 'long') {
      // 死叉且有多仓：平仓
      this.exitLong(symbol);

      this.log('info', 'Death cross detected, closing long', {
        symbol,
        fastMA: currentFastMA.toFixed(2),
        slowMA: currentSlowMA.toFixed(2),
        pnl: position.unrealizedPnl.toFixed(2),
      });
    } else if (deathCross && !position && this.params.allowShort) {
      // 死叉且无仓位且允许做空：做空
      const quantity = this.calculatePositionSize(symbol);
      const currentPrice = kline.close;
      const stopLoss = this.calculateStopLoss(currentPrice, 'short');
      const takeProfit = this.calculateTakeProfit(currentPrice, 'short');

      this.short(symbol, {
        price: currentPrice,
        quantity,
        stopLoss,
        takeProfit,
      });

      this.log('info', 'Death cross detected, going short', {
        symbol,
        fastMA: currentFastMA.toFixed(2),
        slowMA: currentSlowMA.toFixed(2),
      });
    } else if (goldenCross && position?.side === 'short') {
      // 金叉且有空仓：平仓
      this.exitShort(symbol);

      this.log('info', 'Golden cross detected, closing short', {
        symbol,
        pnl: position.unrealizedPnl.toFixed(2),
      });
    }
  }
}
