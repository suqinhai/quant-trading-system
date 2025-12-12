// ============================================================================
// @quant/risk 包入口文件
// 导出所有公共 API
// ============================================================================

// === 类型导出 ===
export { RiskLevel } from './types';

export type {
  // 风控结果
  RiskCheckResult,
  OrderModification,

  // 配置
  PositionLimits,
  OrderLimits,
  LossLimits,
  RiskConfig,

  // 状态
  RiskState,

  // 事件
  RiskEvents,

  // 接口
  IRiskRule,
} from './types';

// === 规则导出 ===
export {
  PositionSizeRule,
  MaxPositionsRule,
  OrderFrequencyRule,
  OrderValueRule,
  DailyLossRule,
  MaxDrawdownRule,
  ConsecutiveLossesRule,
  CircuitBreakerRule,
  SymbolFilterRule,
  getBuiltInRules,
} from './rules';

// === 管理器导出 ===
export { RiskManager } from './manager';
