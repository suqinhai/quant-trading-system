// ============================================================================
// 订单执行器类型定义
// ============================================================================

import type Decimal from 'decimal.js';

import type { Order, OrderRequest, Symbol } from '@quant/exchange';

// ============================================================================
// 执行类型
// ============================================================================

/**
 * 执行算法类型
 */
export type ExecutionAlgorithm =
  | 'market' // 市价单直接执行
  | 'limit' // 限价单
  | 'twap' // 时间加权平均价格
  | 'vwap' // 成交量加权平均价格
  | 'iceberg' // 冰山订单
  | 'sniper'; // 狙击执行（等待最优价格）

/**
 * 执行状态
 */
export type ExecutionStatus =
  | 'pending' // 等待执行
  | 'executing' // 执行中
  | 'partial' // 部分完成
  | 'completed' // 完成
  | 'cancelled' // 已取消
  | 'failed'; // 失败

/**
 * 执行请求
 */
export interface ExecutionRequest {
  // 唯一标识
  readonly id: string;

  // 原始订单请求
  readonly orderRequest: OrderRequest;

  // 执行算法
  readonly algorithm: ExecutionAlgorithm;

  // 算法参数
  readonly params?: ExecutionParams;

  // 创建时间
  readonly createdAt: number;

  // 超时时间（毫秒）
  readonly timeout?: number;
}

/**
 * 执行参数
 */
export interface ExecutionParams {
  // === TWAP 参数 ===
  // 执行时间段（毫秒）
  readonly duration?: number;

  // 分割数量
  readonly slices?: number;

  // === 冰山订单参数 ===
  // 显示数量
  readonly displaySize?: Decimal;

  // 价格偏移
  readonly priceOffset?: Decimal;

  // === 通用参数 ===
  // 最大滑点容忍度（百分比）
  readonly maxSlippage?: Decimal;

  // 是否允许部分成交
  readonly allowPartial?: boolean;

  // 最小成交数量
  readonly minFillSize?: Decimal;
}

/**
 * 执行结果
 */
export interface ExecutionResult {
  // 执行请求 ID
  readonly requestId: string;

  // 执行状态
  readonly status: ExecutionStatus;

  // 所有订单
  readonly orders: Order[];

  // 总成交数量
  readonly filledAmount: Decimal;

  // 平均成交价格
  readonly avgPrice: Decimal;

  // 总手续费
  readonly totalFee: Decimal;

  // 实际滑点
  readonly slippage: Decimal;

  // 开始时间
  readonly startTime: number;

  // 结束时间
  readonly endTime?: number;

  // 执行耗时
  readonly duration?: number;

  // 失败原因
  readonly failReason?: string;
}

/**
 * 子订单
 */
export interface ChildOrder {
  // 父执行请求 ID
  readonly parentId: string;

  // 子订单序号
  readonly sequence: number;

  // 订单信息
  readonly order: Order;

  // 计划执行时间
  readonly scheduledTime: number;

  // 实际执行时间
  readonly executedTime?: number;
}

// ============================================================================
// 执行器事件
// ============================================================================

/**
 * 执行器事件
 */
export interface ExecutorEvents {
  // 执行开始
  executionStarted: (request: ExecutionRequest) => void;

  // 子订单创建
  childOrderCreated: (childOrder: ChildOrder) => void;

  // 子订单成交
  childOrderFilled: (childOrder: ChildOrder) => void;

  // 执行进度
  executionProgress: (requestId: string, progress: number, filledAmount: Decimal) => void;

  // 执行完成
  executionCompleted: (result: ExecutionResult) => void;

  // 执行失败
  executionFailed: (result: ExecutionResult) => void;

  // 执行取消
  executionCancelled: (requestId: string, reason: string) => void;

  // 错误
  error: (error: Error) => void;
}

// ============================================================================
// 执行器配置
// ============================================================================

/**
 * 执行器配置
 */
export interface ExecutorConfig {
  // 默认执行算法
  readonly defaultAlgorithm: ExecutionAlgorithm;

  // 默认超时时间（毫秒）
  readonly defaultTimeout: number;

  // 最大并发执行数
  readonly maxConcurrentExecutions: number;

  // 重试次数
  readonly maxRetries: number;

  // 重试延迟（毫秒）
  readonly retryDelay: number;

  // 是否启用风控检查
  readonly enableRiskCheck: boolean;

  // 订单确认超时（毫秒）
  readonly orderConfirmTimeout: number;

  // 是否模拟执行（用于测试）
  readonly simulationMode: boolean;
}
