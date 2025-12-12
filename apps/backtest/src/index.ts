// ============================================================================
// 回测应用入口
// 命令行回测启动器
// ============================================================================

import 'dotenv/config';
import { Command } from 'commander';
import Decimal from 'decimal.js';
import pino from 'pino';

import { BacktestEngine } from '@quant/backtest';
import type { BacktestConfig, Kline } from '@quant/backtest';
import { DualMAStrategy, RSIStrategy } from '@quant/strategy';
import type { BaseStrategy } from '@quant/strategy';

import { DataLoader } from './data-loader.js';
import { ReportGenerator } from './report.js';

// ============================================================================
// 命令行程序
// ============================================================================

const program = new Command();

// 初始化日志
const logger = pino({
  name: 'BacktestApp',
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
    },
  },
});

// 程序信息
program
  .name('backtest')
  .description('量化交易回测工具 - Quant Trading Backtest Tool')
  .version('1.0.0');

// ============================================================================
// 运行回测命令
// ============================================================================

program
  .command('run')
  .description('运行回测')
  .requiredOption('-s, --strategy <type>', '策略类型 (dual-ma, rsi)')
  .requiredOption('-S, --symbol <symbol>', '交易对 (e.g., BTC/USDT)')
  .option('-t, --timeframe <timeframe>', 'K线周期', '1h')
  .option('--start <date>', '开始日期 (YYYY-MM-DD)')
  .option('--end <date>', '结束日期 (YYYY-MM-DD)')
  .option('-b, --balance <amount>', '初始资金', '10000')
  .option('-f, --fee <rate>', '手续费率', '0.001')
  .option('-d, --data-dir <path>', '数据目录', './data')
  .option('-o, --output <path>', '报告输出目录', './reports')
  .option('--fast-period <n>', '快线周期 (dual-ma)', '10')
  .option('--slow-period <n>', '慢线周期 (dual-ma)', '30')
  .option('--rsi-period <n>', 'RSI 周期', '14')
  .option('--overbought <n>', 'RSI 超买阈值', '70')
  .option('--oversold <n>', 'RSI 超卖阈值', '30')
  .option('--position-size <n>', '仓位比例', '0.1')
  .option('--mock', '使用模拟数据')
  .option('--mock-days <n>', '模拟数据天数', '30')
  .action(async (options) => {
    logger.info('========================================');
    logger.info('  Quant Trading System - Backtester');
    logger.info('========================================');
    logger.info('');

    try {
      // 解析参数
      const symbol = options.symbol as string;
      const timeframe = options.timeframe as string;
      const initialBalance = parseFloat(options.balance as string);
      const feeRate = parseFloat(options.fee as string);
      const positionSize = parseFloat(options.positionSize as string);

      logger.info({
        strategy: options.strategy,
        symbol,
        timeframe,
        initialBalance,
        feeRate,
      }, '回测参数');

      // 加载数据
      let klines: Kline[];

      if (options.mock) {
        // 生成模拟数据
        const days = parseInt(options.mockDays as string, 10);
        const endTime = Date.now();
        const startTime = endTime - days * 24 * 60 * 60 * 1000;

        // 根据 timeframe 计算间隔
        const intervalMs = parseTimeframe(timeframe);

        logger.info({ days, startTime: new Date(startTime), endTime: new Date(endTime) }, '生成模拟数据');

        klines = DataLoader.generateMockKlines(
          symbol,
          startTime,
          endTime,
          intervalMs,
          40000 // 初始价格
        );
      } else {
        // 从文件加载数据
        const dataLoader = new DataLoader({
          source: 'file',
          format: 'json',
          dataDir: options.dataDir as string,
        });

        const startTime = options.start ? new Date(options.start as string).getTime() : undefined;
        const endTime = options.end ? new Date(options.end as string).getTime() : undefined;

        klines = await dataLoader.loadKlines(symbol, timeframe, startTime, endTime);
      }

      logger.info({ count: klines.length }, 'K线数据加载完成');

      if (klines.length === 0) {
        logger.error('没有可用的K线数据');
        process.exit(1);
      }

      // 创建策略
      let strategy: BaseStrategy;

      switch (options.strategy) {
        case 'dual-ma':
          strategy = new DualMAStrategy(
            'backtest-dual-ma',
            [symbol],
            {
              fastPeriod: parseInt(options.fastPeriod as string, 10),
              slowPeriod: parseInt(options.slowPeriod as string, 10),
              positionSize,
            }
          );
          break;

        case 'rsi':
          strategy = new RSIStrategy(
            'backtest-rsi',
            [symbol],
            {
              period: parseInt(options.rsiPeriod as string, 10),
              overbought: parseInt(options.overbought as string, 10),
              oversold: parseInt(options.oversold as string, 10),
              positionSize,
            }
          );
          break;

        default:
          logger.error({ strategy: options.strategy }, '未知的策略类型');
          process.exit(1);
      }

      // 创建回测配置
      const config: BacktestConfig = {
        initialBalance: new Decimal(initialBalance),
        feeRate: new Decimal(feeRate),
        slippageRate: new Decimal(0.0005), // 0.05% 滑点
        symbols: [symbol],
        startTime: klines[0]!.timestamp,
        endTime: klines[klines.length - 1]!.timestamp,
      };

      // 创建回测引擎
      const engine = new BacktestEngine(config);

      // 初始化策略
      await strategy.initialize();

      logger.info('开始回测...');
      const startMs = Date.now();

      // 运行回测
      const result = await engine.run(strategy, klines);

      const durationMs = Date.now() - startMs;
      logger.info({ durationMs }, '回测完成');

      // 输出结果摘要
      logger.info('');
      logger.info('================== 回测结果 ==================');
      logger.info(`初始资金:     $${result.stats.initialBalance.toFixed(2)}`);
      logger.info(`最终资金:     $${result.stats.finalBalance.toFixed(2)}`);
      logger.info(`总收益率:     ${result.stats.totalReturnPercent >= 0 ? '+' : ''}${result.stats.totalReturnPercent.toFixed(2)}%`);
      logger.info(`年化收益率:   ${result.stats.annualizedReturn >= 0 ? '+' : ''}${result.stats.annualizedReturn.toFixed(2)}%`);
      logger.info(`最大回撤:     ${result.stats.maxDrawdown.toFixed(2)}%`);
      logger.info(`夏普比率:     ${result.stats.sharpeRatio.toFixed(3)}`);
      logger.info(`总交易次数:   ${result.stats.totalTrades}`);
      logger.info(`胜率:         ${result.stats.winRate.toFixed(2)}%`);
      logger.info(`盈亏比:       ${result.stats.profitFactor.toFixed(3)}`);
      logger.info('===============================================');
      logger.info('');

      // 生成报告
      const reportGenerator = new ReportGenerator(options.output as string);
      const reports = await reportGenerator.generateAll(result, `${options.strategy as string}_${symbol.replace('/', '_')}`);

      logger.info('报告已生成:');
      logger.info(`  文本报告: ${reports.text}`);
      logger.info(`  JSON报告: ${reports.json}`);
      logger.info(`  HTML报告: ${reports.html}`);

    } catch (error) {
      logger.error({ error }, '回测失败');
      process.exit(1);
    }
  });

// ============================================================================
// 生成模拟数据命令
// ============================================================================

program
  .command('generate-data')
  .description('生成模拟K线数据')
  .requiredOption('-S, --symbol <symbol>', '交易对')
  .option('-t, --timeframe <timeframe>', 'K线周期', '1h')
  .option('-d, --days <n>', '天数', '30')
  .option('-p, --start-price <n>', '起始价格', '100')
  .option('-o, --output <path>', '输出目录', './data')
  .action(async (options) => {
    try {
      const symbol = options.symbol as string;
      const timeframe = options.timeframe as string;
      const days = parseInt(options.days as string, 10);
      const startPrice = parseFloat(options.startPrice as string);
      const outputDir = options.output as string;

      const endTime = Date.now();
      const startTime = endTime - days * 24 * 60 * 60 * 1000;
      const intervalMs = parseTimeframe(timeframe);

      logger.info({ symbol, timeframe, days, startPrice }, '生成模拟数据');

      const klines = DataLoader.generateMockKlines(
        symbol,
        startTime,
        endTime,
        intervalMs,
        startPrice
      );

      const dataLoader = new DataLoader({
        source: 'file',
        format: 'json',
        dataDir: outputDir,
      });

      await dataLoader.saveKlines(symbol, timeframe, klines);

      logger.info({ count: klines.length, outputDir }, '数据已保存');

    } catch (error) {
      logger.error({ error }, '生成数据失败');
      process.exit(1);
    }
  });

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 解析时间周期为毫秒
 */
function parseTimeframe(timeframe: string): number {
  const unit = timeframe.slice(-1);
  const value = parseInt(timeframe.slice(0, -1), 10);

  switch (unit) {
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    case 'w':
      return value * 7 * 24 * 60 * 60 * 1000;
    default:
      return 60 * 60 * 1000; // 默认 1 小时
  }
}

// ============================================================================
// 运行程序
// ============================================================================

program.parse();
