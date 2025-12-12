// ============================================================================
// 交易所工厂
// 根据配置创建对应的交易所适配器实例
// ============================================================================

import { BaseExchange } from './base';
import { BinanceExchange } from './exchanges/binance';
import { ExchangeError, ExchangeErrorCode, type ExchangeConfig, type ExchangeId } from './types';

// ============================================================================
// 支持的交易所注册表
// ============================================================================

/**
 * 交易所构造函数类型
 */
type ExchangeConstructor = new (config: ExchangeConfig) => BaseExchange;

/**
 * 已注册的交易所映射
 * 使用 Map 存储，方便动态注册新交易所
 */
const exchangeRegistry = new Map<ExchangeId, ExchangeConstructor>();

// 注册内置交易所
exchangeRegistry.set('binance', BinanceExchange);

// 未来可以添加更多交易所：
// exchangeRegistry.set('okx', OkxExchange);
// exchangeRegistry.set('bybit', BybitExchange);
// exchangeRegistry.set('coinbase', CoinbaseExchange);

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建交易所实例
 *
 * @param config - 交易所配置
 * @returns 交易所实例
 * @throws ExchangeError - 如果交易所不支持
 *
 * @example
 * ```typescript
 * const exchange = createExchange({
 *   exchangeId: 'binance',
 *   apiKey: 'your-api-key',
 *   apiSecret: 'your-api-secret',
 * });
 *
 * await exchange.connect();
 * ```
 */
export function createExchange(config: ExchangeConfig): BaseExchange {
  // 获取交易所构造函数
  const ExchangeClass = exchangeRegistry.get(config.exchangeId);

  // 如果交易所不存在，抛出错误
  if (!ExchangeClass) {
    throw new ExchangeError(
      ExchangeErrorCode.UNKNOWN_ERROR,
      `Unsupported exchange: ${config.exchangeId}. Supported exchanges: ${Array.from(exchangeRegistry.keys()).join(', ')}`,
      config.exchangeId
    );
  }

  // 创建并返回实例
  return new ExchangeClass(config);
}

/**
 * 注册自定义交易所
 *
 * 允许用户注册自己实现的交易所适配器
 *
 * @param exchangeId - 交易所标识
 * @param ExchangeClass - 交易所类（必须继承 BaseExchange）
 *
 * @example
 * ```typescript
 * class MyExchange extends BaseExchange {
 *   // 实现抽象方法...
 * }
 *
 * registerExchange('myexchange', MyExchange);
 * ```
 */
export function registerExchange(exchangeId: ExchangeId, ExchangeClass: ExchangeConstructor): void {
  exchangeRegistry.set(exchangeId, ExchangeClass);
}

/**
 * 获取支持的交易所列表
 *
 * @returns 支持的交易所 ID 数组
 */
export function getSupportedExchanges(): ExchangeId[] {
  return Array.from(exchangeRegistry.keys());
}

/**
 * 检查交易所是否支持
 *
 * @param exchangeId - 交易所标识
 * @returns 是否支持
 */
export function isExchangeSupported(exchangeId: ExchangeId): boolean {
  return exchangeRegistry.has(exchangeId);
}
