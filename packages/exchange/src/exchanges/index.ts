// ============================================================================
// 交易所适配器统一导出
// 提供所有交易所适配器的导出和工厂函数
// ============================================================================

// 导出基类
export { BaseExchange, ExchangeException } from './base-exchange.js';
export type { ExchangeEvents } from './base-exchange.js';

// 导出各交易所适配器
export { BinanceFutures } from './binance-futures.js';
export { BybitV5 } from './bybit-v5.js';
export { OKX } from './okx.js';

// 导入类型（用于工厂函数）
import { BaseExchange } from './base-exchange.js';
import { BinanceFutures } from './binance-futures.js';
import { BybitV5 } from './bybit-v5.js';
import { OKX } from './okx.js';
import type { ExchangeConfig } from '../schemas.js';

// ============================================================================
// 支持的交易所类型
// ============================================================================

/**
 * 支持的交易所名称枚举
 * 用于工厂函数创建对应的交易所实例
 */
export type ExchangeName =
  | 'binance_futures'  // 币安 USDT 永续合约
  | 'bybit_v5'         // Bybit V5 统一 API
  | 'okx';             // OKX V5 API

/**
 * 所有支持的交易所名称列表
 * 用于验证和枚举
 */
export const SUPPORTED_EXCHANGES: readonly ExchangeName[] = [
  'binance_futures',
  'bybit_v5',
  'okx',
] as const;

// ============================================================================
// 交易所工厂函数
// ============================================================================

/**
 * 交易所类映射
 * 将交易所名称映射到对应的类构造函数
 */
const exchangeClassMap: Record<
  ExchangeName,
  new (config: ExchangeConfig) => BaseExchange
> = {
  // 币安期货
  binance_futures: BinanceFutures,
  // Bybit V5
  bybit_v5: BybitV5,
  // OKX
  okx: OKX,
};

/**
 * 创建交易所实例的工厂函数
 *
 * 根据交易所名称创建对应的交易所适配器实例
 * 所有实例都继承自 BaseExchange，提供统一的接口
 *
 * @param exchangeName - 交易所名称
 * @param config - 交易所配置
 * @returns 交易所实例
 * @throws 当交易所名称不支持时抛出错误
 *
 * @example
 * ```typescript
 * // 创建币安期货实例
 * const binance = createExchange('binance_futures', {
 *   apiKey: 'your-api-key',
 *   apiSecret: 'your-api-secret',
 *   testnet: true,
 * });
 *
 * // 创建 OKX 实例（需要 passphrase）
 * const okx = createExchange('okx', {
 *   apiKey: 'your-api-key',
 *   apiSecret: 'your-api-secret',
 *   passphrase: 'your-passphrase',
 * });
 *
 * // 使用统一接口
 * await binance.loadMarkets();
 * const balance = await binance.getBalance();
 * const positions = await binance.getPositions();
 * ```
 */
export function createExchange(
  exchangeName: ExchangeName,
  config: ExchangeConfig
): BaseExchange {
  // 获取对应的交易所类
  const ExchangeClass = exchangeClassMap[exchangeName];

  // 检查是否支持该交易所
  if (!ExchangeClass) {
    // 构建支持的交易所列表字符串
    const supported = SUPPORTED_EXCHANGES.join(', ');

    // 抛出不支持错误
    throw new Error(
      `Unsupported exchange: "${exchangeName}". ` +
      `Supported exchanges: ${supported}`
    );
  }

  // 创建并返回交易所实例
  return new ExchangeClass(config);
}

/**
 * 检查交易所名称是否支持
 *
 * @param name - 待检查的名称
 * @returns 如果支持返回 true，否则返回 false
 *
 * @example
 * ```typescript
 * if (isExchangeSupported('binance_futures')) {
 *   // 创建交易所实例
 * }
 * ```
 */
export function isExchangeSupported(name: string): name is ExchangeName {
  // 检查名称是否在支持列表中
  return SUPPORTED_EXCHANGES.includes(name as ExchangeName);
}

/**
 * 获取交易所的默认配置模板
 *
 * 返回指定交易所的配置模板，包含必填字段说明
 * 注意：API 密钥需要用户自行填写
 *
 * @param exchangeName - 交易所名称
 * @returns 配置模板对象
 *
 * @example
 * ```typescript
 * const template = getExchangeConfigTemplate('okx');
 * // 返回：
 * // {
 * //   apiKey: '',
 * //   apiSecret: '',
 * //   passphrase: '',  // OKX 特有
 * //   testnet: false,
 * //   ...
 * // }
 * ```
 */
export function getExchangeConfigTemplate(
  exchangeName: ExchangeName
): Partial<ExchangeConfig> {
  // 基础配置模板（所有交易所通用）
  const baseConfig: Partial<ExchangeConfig> = {
    // API 密钥（必填）
    apiKey: '',
    // API 私钥（必填）
    apiSecret: '',
    // 是否使用测试网
    testnet: false,
    // 是否为沙盒环境
    sandbox: false,
    // 请求超时时间（毫秒）
    timeout: 30000,
    // 启用自动限速
    enableRateLimit: true,
    // WebSocket 自动重连
    wsAutoReconnect: true,
    // 最大重连次数
    wsReconnectMaxRetries: 10,
    // 重连基础延迟
    wsReconnectBaseDelay: 1000,
    // 重连最大延迟
    wsReconnectMaxDelay: 30000,
  };

  // 根据交易所添加特定配置
  switch (exchangeName) {
    case 'okx':
      // OKX 需要 passphrase
      return {
        ...baseConfig,
        passphrase: '', // OKX API 密码（必填）
      };

    case 'binance_futures':
    case 'bybit_v5':
    default:
      // 其他交易所使用基础配置
      return baseConfig;
  }
}

/**
 * 获取交易所的特性信息
 *
 * 返回指定交易所支持的功能特性
 * 用于在创建实例前了解交易所能力
 *
 * @param exchangeName - 交易所名称
 * @returns 特性信息对象
 */
export function getExchangeFeatures(exchangeName: ExchangeName): {
  // 交易所显示名称
  displayName: string;
  // 是否需要 passphrase
  requiresPassphrase: boolean;
  // 支持的产品类型
  products: string[];
  // WebSocket 认证方式
  wsAuthMethod: string;
  // 资金费率结算间隔（小时）
  fundingInterval: number;
  // 最大杠杆倍数
  maxLeverage: number;
} {
  // 根据交易所返回特性信息
  switch (exchangeName) {
    case 'binance_futures':
      return {
        displayName: 'Binance Futures (USDT-M)',
        requiresPassphrase: false,
        products: ['USDT 永续合约', 'USDC 永续合约'],
        wsAuthMethod: 'listenKey',
        fundingInterval: 8,
        maxLeverage: 125,
      };

    case 'bybit_v5':
      return {
        displayName: 'Bybit (V5 Unified)',
        requiresPassphrase: false,
        products: ['USDT 永续合约', 'USDC 永续合约', '反向永续合约'],
        wsAuthMethod: 'HMAC-SHA256',
        fundingInterval: 8,
        maxLeverage: 100,
      };

    case 'okx':
      return {
        displayName: 'OKX (V5)',
        requiresPassphrase: true,
        products: ['USDT 永续合约', 'USDC 永续合约', '币本位永续合约'],
        wsAuthMethod: 'HMAC-SHA256 + Base64',
        fundingInterval: 8,
        maxLeverage: 125,
      };

    default:
      // 不应该到达这里
      throw new Error(`Unknown exchange: ${exchangeName}`);
  }
}
