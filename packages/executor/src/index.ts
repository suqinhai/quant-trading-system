// ============================================================================
// @quant/executor 包入口文件
// 导出所有公共 API
// ============================================================================

// === 类型导出 ===
export type {
  // 执行算法
  ExecutionAlgorithm,

  // 执行状态
  ExecutionStatus,

  // 执行请求
  ExecutionRequest,

  // 执行参数
  ExecutionParams,

  // 执行结果
  ExecutionResult,

  // 子订单
  ChildOrder,

  // 执行器事件
  ExecutorEvents,

  // 执行器配置
  ExecutorConfig,
} from './types';

// === 执行器导出 ===
export { OrderExecutor } from './executor';
