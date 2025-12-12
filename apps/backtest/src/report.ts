// ============================================================================
// 回测报告生成器
// 生成详细的回测报告
// ============================================================================

import fs from 'fs/promises';
import path from 'path';
import pino from 'pino';

import type { BacktestResult } from '@quant/backtest';

// ============================================================================
// 报告生成器
// ============================================================================

/**
 * 回测报告生成器
 *
 * 功能：
 * - 生成文本报告
 * - 生成 JSON 报告
 * - 生成 HTML 报告
 * - 交易记录导出
 */
export class ReportGenerator {
  // 日志记录器
  private readonly logger: pino.Logger;

  // 输出目录
  private readonly outputDir: string;

  /**
   * 构造函数
   */
  public constructor(outputDir: string = './reports') {
    this.outputDir = outputDir;

    // 初始化日志
    this.logger = pino({
      name: 'ReportGenerator',
      level: process.env['LOG_LEVEL'] ?? 'info',
    });
  }

  // ==========================================================================
  // 报告生成
  // ==========================================================================

  /**
   * 生成所有格式的报告
   */
  public async generateAll(
    result: BacktestResult,
    name: string
  ): Promise<{ text: string; json: string; html: string }> {
    // 确保输出目录存在
    await fs.mkdir(this.outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = `${name}_${timestamp}`;

    // 生成各格式报告
    const textPath = path.join(this.outputDir, `${baseName}.txt`);
    const jsonPath = path.join(this.outputDir, `${baseName}.json`);
    const htmlPath = path.join(this.outputDir, `${baseName}.html`);

    await Promise.all([
      this.generateTextReport(result, textPath),
      this.generateJSONReport(result, jsonPath),
      this.generateHTMLReport(result, htmlPath),
    ]);

    this.logger.info({ outputDir: this.outputDir, baseName }, 'Reports generated');

    return { text: textPath, json: jsonPath, html: htmlPath };
  }

  /**
   * 生成文本报告
   */
  public async generateTextReport(result: BacktestResult, filepath: string): Promise<void> {
    const stats = result.stats;
    const lines: string[] = [];

    lines.push('================================================================================');
    lines.push('                           回测报告 - Backtest Report');
    lines.push('================================================================================');
    lines.push('');
    lines.push(`生成时间: ${new Date().toLocaleString()}`);
    lines.push(`回测周期: ${new Date(result.startTime).toLocaleString()} - ${new Date(result.endTime).toLocaleString()}`);
    lines.push(`交易对: ${result.trades.length > 0 ? [...new Set(result.trades.map(t => t.symbol))].join(', ') : 'N/A'}`);
    lines.push('');
    lines.push('--------------------------------------------------------------------------------');
    lines.push('                              收益统计');
    lines.push('--------------------------------------------------------------------------------');
    lines.push('');
    lines.push(`初始资金:        ${stats.initialBalance.toFixed(2)}`);
    lines.push(`最终资金:        ${stats.finalBalance.toFixed(2)}`);
    lines.push(`总收益:          ${stats.totalReturn.toFixed(2)} (${stats.totalReturnPercent.toFixed(2)}%)`);
    lines.push(`年化收益率:      ${stats.annualizedReturn.toFixed(2)}%`);
    lines.push('');
    lines.push('--------------------------------------------------------------------------------');
    lines.push('                              风险指标');
    lines.push('--------------------------------------------------------------------------------');
    lines.push('');
    lines.push(`最大回撤:        ${stats.maxDrawdown.toFixed(2)}%`);
    lines.push(`夏普比率:        ${stats.sharpeRatio.toFixed(3)}`);
    lines.push(`索提诺比率:      ${stats.sortinoRatio.toFixed(3)}`);
    lines.push(`卡尔马比率:      ${stats.calmarRatio.toFixed(3)}`);
    lines.push(`波动率:          ${stats.volatility.toFixed(2)}%`);
    lines.push('');
    lines.push('--------------------------------------------------------------------------------');
    lines.push('                              交易统计');
    lines.push('--------------------------------------------------------------------------------');
    lines.push('');
    lines.push(`总交易次数:      ${stats.totalTrades}`);
    lines.push(`盈利交易:        ${stats.winningTrades}`);
    lines.push(`亏损交易:        ${stats.losingTrades}`);
    lines.push(`胜率:            ${stats.winRate.toFixed(2)}%`);
    lines.push(`盈亏比:          ${stats.profitFactor.toFixed(3)}`);
    lines.push('');
    lines.push(`平均盈利:        ${stats.avgWin.toFixed(2)}`);
    lines.push(`平均亏损:        ${stats.avgLoss.toFixed(2)}`);
    lines.push(`最大单笔盈利:    ${stats.maxWin.toFixed(2)}`);
    lines.push(`最大单笔亏损:    ${stats.maxLoss.toFixed(2)}`);
    lines.push('');
    lines.push(`平均持仓时间:    ${this.formatDuration(stats.avgHoldingPeriod)}`);
    lines.push(`最大连续盈利:    ${stats.maxConsecutiveWins} 次`);
    lines.push(`最大连续亏损:    ${stats.maxConsecutiveLosses} 次`);
    lines.push('');
    lines.push('--------------------------------------------------------------------------------');
    lines.push('                              费用统计');
    lines.push('--------------------------------------------------------------------------------');
    lines.push('');
    lines.push(`总手续费:        ${stats.totalFees.toFixed(2)}`);
    lines.push(`总滑点损失:      ${stats.totalSlippage.toFixed(2)}`);
    lines.push('');
    lines.push('================================================================================');
    lines.push('');

    // 最近交易记录
    if (result.trades.length > 0) {
      lines.push('--------------------------------------------------------------------------------');
      lines.push('                           最近 20 笔交易');
      lines.push('--------------------------------------------------------------------------------');
      lines.push('');
      lines.push('时间                    | 交易对      | 方向   | 价格        | 数量        | 盈亏');
      lines.push('------------------------|-------------|--------|-------------|-------------|------------');

      const recentTrades = result.trades.slice(-20);
      for (const trade of recentTrades) {
        const time = new Date(trade.timestamp).toLocaleString().padEnd(22);
        const symbol = trade.symbol.padEnd(11);
        const side = trade.side.padEnd(6);
        const price = trade.price.toFixed(2).padStart(11);
        const amount = trade.amount.toFixed(4).padStart(11);
        const pnl = trade.pnl.toFixed(2).padStart(10);

        lines.push(`${time} | ${symbol} | ${side} | ${price} | ${amount} | ${pnl}`);
      }
      lines.push('');
    }

    lines.push('================================================================================');

    const content = lines.join('\n');
    await fs.writeFile(filepath, content, 'utf-8');
  }

  /**
   * 生成 JSON 报告
   */
  public async generateJSONReport(result: BacktestResult, filepath: string): Promise<void> {
    const report = {
      generatedAt: new Date().toISOString(),
      period: {
        start: new Date(result.startTime).toISOString(),
        end: new Date(result.endTime).toISOString(),
        durationDays: (result.endTime - result.startTime) / (24 * 60 * 60 * 1000),
      },
      stats: {
        ...result.stats,
        // 转换 Decimal 为数字以便 JSON 序列化
        initialBalance: result.stats.initialBalance,
        finalBalance: result.stats.finalBalance,
        totalReturn: result.stats.totalReturn,
        totalReturnPercent: result.stats.totalReturnPercent,
      },
      trades: result.trades.map(t => ({
        ...t,
        price: t.price.toNumber(),
        amount: t.amount.toNumber(),
        fee: t.fee.toNumber(),
        pnl: t.pnl.toNumber(),
        timestamp: new Date(t.timestamp).toISOString(),
      })),
      equityCurve: result.equityCurve.map(e => ({
        timestamp: new Date(e.timestamp).toISOString(),
        equity: e.equity.toNumber(),
        drawdown: e.drawdown.toNumber(),
      })),
    };

    const content = JSON.stringify(report, null, 2);
    await fs.writeFile(filepath, content, 'utf-8');
  }

  /**
   * 生成 HTML 报告
   */
  public async generateHTMLReport(result: BacktestResult, filepath: string): Promise<void> {
    const stats = result.stats;

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>回测报告 - Backtest Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; line-height: 1.6; }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px; margin-bottom: 20px; }
    .header h1 { font-size: 28px; margin-bottom: 10px; }
    .header p { opacity: 0.9; }
    .card { background: white; border-radius: 10px; padding: 20px; margin-bottom: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .card h2 { font-size: 18px; color: #667eea; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 2px solid #f0f0f0; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
    .stat-item { background: #f8f9fa; padding: 15px; border-radius: 8px; }
    .stat-label { font-size: 12px; color: #666; text-transform: uppercase; }
    .stat-value { font-size: 24px; font-weight: bold; color: #333; }
    .stat-value.positive { color: #28a745; }
    .stat-value.negative { color: #dc3545; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f8f9fa; font-weight: 600; }
    tr:hover { background: #f8f9fa; }
    .positive { color: #28a745; }
    .negative { color: #dc3545; }
    .footer { text-align: center; color: #666; padding: 20px; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 回测报告</h1>
      <p>生成时间: ${new Date().toLocaleString()}</p>
      <p>回测周期: ${new Date(result.startTime).toLocaleDateString()} - ${new Date(result.endTime).toLocaleDateString()}</p>
    </div>

    <div class="card">
      <h2>📈 收益统计</h2>
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-label">初始资金</div>
          <div class="stat-value">$${stats.initialBalance.toFixed(2)}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">最终资金</div>
          <div class="stat-value">$${stats.finalBalance.toFixed(2)}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">总收益率</div>
          <div class="stat-value ${stats.totalReturnPercent >= 0 ? 'positive' : 'negative'}">${stats.totalReturnPercent >= 0 ? '+' : ''}${stats.totalReturnPercent.toFixed(2)}%</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">年化收益率</div>
          <div class="stat-value ${stats.annualizedReturn >= 0 ? 'positive' : 'negative'}">${stats.annualizedReturn >= 0 ? '+' : ''}${stats.annualizedReturn.toFixed(2)}%</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>⚠️ 风险指标</h2>
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-label">最大回撤</div>
          <div class="stat-value negative">${stats.maxDrawdown.toFixed(2)}%</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">夏普比率</div>
          <div class="stat-value">${stats.sharpeRatio.toFixed(3)}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">索提诺比率</div>
          <div class="stat-value">${stats.sortinoRatio.toFixed(3)}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">波动率</div>
          <div class="stat-value">${stats.volatility.toFixed(2)}%</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>📋 交易统计</h2>
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-label">总交易次数</div>
          <div class="stat-value">${stats.totalTrades}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">胜率</div>
          <div class="stat-value">${stats.winRate.toFixed(2)}%</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">盈亏比</div>
          <div class="stat-value">${stats.profitFactor.toFixed(3)}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">平均盈利</div>
          <div class="stat-value positive">$${stats.avgWin.toFixed(2)}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">平均亏损</div>
          <div class="stat-value negative">$${stats.avgLoss.toFixed(2)}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">总手续费</div>
          <div class="stat-value">$${stats.totalFees.toFixed(2)}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>📝 最近交易记录</h2>
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>交易对</th>
            <th>方向</th>
            <th>价格</th>
            <th>数量</th>
            <th>盈亏</th>
          </tr>
        </thead>
        <tbody>
          ${result.trades.slice(-20).map(t => `
          <tr>
            <td>${new Date(t.timestamp).toLocaleString()}</td>
            <td>${t.symbol}</td>
            <td>${t.side}</td>
            <td>$${t.price.toFixed(2)}</td>
            <td>${t.amount.toFixed(4)}</td>
            <td class="${t.pnl.greaterThanOrEqualTo(0) ? 'positive' : 'negative'}">$${t.pnl.toFixed(2)}</td>
          </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="footer">
      <p>Quant Trading System - Backtest Report</p>
    </div>
  </div>
</body>
</html>`;

    await fs.writeFile(filepath, html, 'utf-8');
  }

  /**
   * 格式化持续时间
   */
  private formatDuration(ms: number): string {
    if (ms < 60000) {
      return `${(ms / 1000).toFixed(1)} 秒`;
    } else if (ms < 3600000) {
      return `${(ms / 60000).toFixed(1)} 分钟`;
    } else if (ms < 86400000) {
      return `${(ms / 3600000).toFixed(1)} 小时`;
    } else {
      return `${(ms / 86400000).toFixed(1)} 天`;
    }
  }
}
