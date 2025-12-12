// ============================================================================
// @quant/backtest 包入口文件
// 导出所有公共 API
// ============================================================================

// === 类型导出 ===
export {
  // 事件类型枚举
  EventType,
} from './types';

export type {
  // 基础事件
  BaseEvent,
  MarketDataEvent,
  SignalEvent,
  SignalDirection,
  OrderEvent,
  PositionEvent,
  BacktestEvent,

  // 仓位和交易
  BacktestPosition,
  ClosedTrade,

  // 配置
  CommissionConfig,
  SlippageConfig,
  BacktestConfig,

  // 结果
  EquityPoint,
  BacktestStats,
  BacktestResult,

  // 接口
  IEventQueue,
  IBacktestStrategy,
  BacktestContext,
} from './types';

// === 核心组件导出 ===
export { EventQueue } from './event-queue';
export { SimulatedBroker } from './broker';
export { StatsCalculator } from './stats';
export { BacktestEngine } from './engine';

// 导出引擎事件类型
export type { BacktestEngineEvents } from './engine';
