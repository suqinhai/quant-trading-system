// ============================================================================
// 实盘交易应用入口
// ============================================================================

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pino from 'pino';

// 加载环境变量
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { createExchange } from '@quant/exchange';
import { DualMAStrategy, RSIStrategy } from '@quant/strategy';
import type { BaseStrategy } from '@quant/strategy';

import { getDefaultConfig, validateConfig } from './config.js';
import type { AppConfig } from './config.js';
import { TradingEngine } from './engine.js';

// ============================================================================
// 主程序
// ============================================================================

/**
 * 创建策略实例
 */
function createStrategies(config: AppConfig): Map<string, BaseStrategy> {
  const strategies = new Map<string, BaseStrategy>();

  for (const strategyConfig of config.strategies) {
    if (!strategyConfig.enabled) {
      continue;
    }

    let strategy: BaseStrategy;

    switch (strategyConfig.type) {
      case 'dual-ma':
        strategy = new DualMAStrategy(
          strategyConfig.name,
          strategyConfig.symbols,
          {
            fastPeriod: (strategyConfig.params['fastPeriod'] as number) ?? 10,
            slowPeriod: (strategyConfig.params['slowPeriod'] as number) ?? 30,
            positionSize: (strategyConfig.params['positionSize'] as number) ?? 0.1,
          }
        );
        break;

      case 'rsi':
        strategy = new RSIStrategy(
          strategyConfig.name,
          strategyConfig.symbols,
          {
            period: (strategyConfig.params['period'] as number) ?? 14,
            overbought: (strategyConfig.params['overbought'] as number) ?? 70,
            oversold: (strategyConfig.params['oversold'] as number) ?? 30,
            positionSize: (strategyConfig.params['positionSize'] as number) ?? 0.1,
          }
        );
        break;

      default:
        console.warn(`Unknown strategy type: ${strategyConfig.type}`);
        continue;
    }

    strategies.set(strategyConfig.name, strategy);
  }

  return strategies;
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  // 初始化日志
  const logger = pino({
    name: 'LiveTrader',
    level: process.env['LOG_LEVEL'] ?? 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
      },
    },
  });

  logger.info('========================================');
  logger.info('  Quant Trading System - Live Trader');
  logger.info('========================================');

  // 加载配置
  const config = getDefaultConfig();

  // 验证配置
  const errors = validateConfig(config);
  if (errors.length > 0) {
    logger.error({ errors }, 'Configuration validation failed');
    process.exit(1);
  }

  // 显示配置信息
  logger.info({
    env: config.env,
    exchange: config.exchange.type,
    testnet: config.exchange.testnet,
    paperTrading: config.paperTrading,
    strategies: config.strategies.map(s => s.name),
  }, 'Configuration loaded');

  // 创建交易所实例
  const exchange = createExchange(config.exchange.type, {
    exchangeId: config.exchange.type,
    apiKey: config.exchange.apiKey,
    apiSecret: config.exchange.apiSecret,
    sandbox: config.exchange.testnet,
    timeout: config.exchange.timeout,
    rateLimit: config.exchange.enableRateLimit ? 10 : undefined,
  });

  // 创建策略实例
  const strategies = createStrategies(config);
  logger.info({ count: strategies.size }, 'Strategies created');

  // 创建交易引擎
  const engine = new TradingEngine(config, exchange, strategies);

  // 设置信号处理
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal');

    try {
      await engine.stop();
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error({ error }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // 监听引擎事件
  engine.on('started', () => {
    logger.info('Trading engine started');
  });

  engine.on('stopped', () => {
    logger.info('Trading engine stopped');
  });

  engine.on('signalReceived', (strategyName, signal) => {
    logger.info({ strategyName, signal }, 'Signal received');
  });

  engine.on('orderExecuted', (strategyName, order) => {
    logger.info({ strategyName, order }, 'Order executed');
  });

  engine.on('error', error => {
    logger.error({ error }, 'Engine error');
  });

  // 启动交易引擎
  try {
    await engine.start();

    // 保持进程运行
    logger.info('Trading engine is running. Press Ctrl+C to stop.');

    // 定期输出状态
    setInterval(() => {
      const stats = engine.getTradingStats();
      const health = engine.getHealth();

      logger.info({
        health: health.status,
        uptime: Math.round(health.uptime / 1000),
        orders: stats.totalOrders,
        pnl: stats.totalPnL.toString(),
      }, 'Status update');
    }, 60000); // 每分钟输出一次

  } catch (error) {
    logger.error({ error }, 'Failed to start trading engine');
    process.exit(1);
  }
}

// 运行主程序
main().catch(error => {
  const errorMsg = error instanceof Error ? error.message : String(error);
  console.error('Fatal error:', errorMsg);
  process.exit(1);
});
