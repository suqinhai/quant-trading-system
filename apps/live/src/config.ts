// ============================================================================
// 实盘交易应用配置
// ============================================================================

import type { ExecutorConfig } from '@quant/executor';
import type { RiskConfig } from '@quant/risk';
import type { MonitorConfig } from '@quant/monitor';

// ============================================================================
// 交易所配置
// ============================================================================

/**
 * 交易所配置
 */
export interface ExchangeSettings {
  // 交易所类型
  readonly type: 'binance' | 'okx' | 'bybit';

  // API 密钥
  readonly apiKey: string;

  // API 密钥密文
  readonly apiSecret: string;

  // 是否使用测试网
  readonly testnet: boolean;

  // API 请求超时（毫秒）
  readonly timeout: number;

  // 是否启用限速
  readonly enableRateLimit: boolean;
}

// ============================================================================
// 策略配置
// ============================================================================

/**
 * 策略配置
 */
export interface StrategySettings {
  // 策略名称
  readonly name: string;

  // 策略类型
  readonly type: 'dual-ma' | 'rsi' | 'custom';

  // 交易对列表
  readonly symbols: string[];

  // 策略参数
  readonly params: Record<string, unknown>;

  // 是否启用
  readonly enabled: boolean;
}

// ============================================================================
// 应用配置
// ============================================================================

/**
 * 应用配置
 */
export interface AppConfig {
  // 应用名称
  readonly name: string;

  // 环境
  readonly env: 'development' | 'production' | 'test';

  // 日志级别
  readonly logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

  // 交易所配置
  readonly exchange: ExchangeSettings;

  // 策略配置列表
  readonly strategies: StrategySettings[];

  // 风控配置
  readonly risk: Partial<RiskConfig>;

  // 执行器配置
  readonly executor: Partial<ExecutorConfig>;

  // 监控配置
  readonly monitor: Partial<MonitorConfig>;

  // 是否启用模拟交易
  readonly paperTrading: boolean;

  // 数据存储路径
  readonly dataPath: string;
}

// ============================================================================
// 默认配置
// ============================================================================

/**
 * 获取默认配置
 */
export function getDefaultConfig(): AppConfig {
  return {
    name: 'quant-live-trader',
    env: (process.env['NODE_ENV'] as AppConfig['env']) ?? 'development',
    logLevel: (process.env['LOG_LEVEL'] as AppConfig['logLevel']) ?? 'info',

    // 交易所配置（从环境变量读取）
    exchange: {
      type: (process.env['EXCHANGE_TYPE'] as ExchangeSettings['type']) ?? 'binance',
      apiKey: process.env['EXCHANGE_API_KEY'] ?? '',
      apiSecret: process.env['EXCHANGE_API_SECRET'] ?? '',
      testnet: process.env['EXCHANGE_TESTNET'] === 'true',
      timeout: 30000,
      enableRateLimit: true,
    },

    // 默认策略配置
    strategies: [
      {
        name: 'btc-dual-ma',
        type: 'dual-ma',
        symbols: ['BTC/USDT'],
        params: {
          fastPeriod: 10,
          slowPeriod: 30,
          positionSize: 0.1,
        },
        enabled: true,
      },
    ],

    // 风控配置
    risk: {
      positionLimits: {
        maxPositionSize: 1000000,
        maxPositionPerSymbol: 100000,
        maxTotalPositions: 10,
        maxLeverage: 3,
      },
      lossLimits: {
        maxDailyLoss: 10000,
        maxWeeklyLoss: 30000,
        maxMonthlyLoss: 50000,
        maxDrawdown: 20,
        maxConsecutiveLosses: 5,
      },
    },

    // 执行器配置
    executor: {
      defaultAlgorithm: 'market',
      maxConcurrentExecutions: 5,
      maxRetries: 3,
      enableRiskCheck: true,
    },

    // 监控配置
    monitor: {
      healthCheckInterval: 30000,
      metricsInterval: 10000,
      enableSystemMetrics: true,
      enableTradingMetrics: true,
      channels: [],
    },

    // 默认使用模拟交易
    paperTrading: process.env['PAPER_TRADING'] !== 'false',

    // 数据存储路径
    dataPath: process.env['DATA_PATH'] ?? './data',
  };
}

/**
 * 验证配置
 */
export function validateConfig(config: AppConfig): string[] {
  const errors: string[] = [];

  // 验证交易所配置
  if (!config.paperTrading) {
    if (!config.exchange.apiKey) {
      errors.push('Exchange API key is required for live trading');
    }
    if (!config.exchange.apiSecret) {
      errors.push('Exchange API secret is required for live trading');
    }
  }

  // 验证策略配置
  if (config.strategies.length === 0) {
    errors.push('At least one strategy must be configured');
  }

  for (const strategy of config.strategies) {
    if (!strategy.name) {
      errors.push('Strategy name is required');
    }
    if (strategy.symbols.length === 0) {
      errors.push(`Strategy ${strategy.name}: at least one symbol is required`);
    }
  }

  return errors;
}
