# 量化交易系统 - Quant Trading System

工业级加密货币量化交易系统，采用 TypeScript + Node.js 20 + pnpm workspace 构建的 monorepo 项目。

## 📦 项目结构

```
quant-trading-system/
├── packages/                    # 核心包
│   ├── exchange/               # @quant/exchange - 交易所抽象层
│   ├── marketdata/             # @quant/marketdata - 实时行情引擎
│   ├── backtest/               # @quant/backtest - 事件驱动回测引擎
│   ├── strategy/               # @quant/strategy - 策略基础包
│   ├── risk/                   # @quant/risk - 风控管理中心
│   ├── executor/               # @quant/executor - 智能订单执行器
│   └── monitor/                # @quant/monitor - 监控告警中心
├── apps/                       # 应用程序
│   ├── live/                   # 实盘交易应用
│   └── backtest/               # 回测启动器
├── pnpm-workspace.yaml         # pnpm 工作区配置
├── package.json                # 根包配置
├── tsconfig.json               # TypeScript 基础配置
├── .eslintrc.cjs               # ESLint 配置
├── .prettierrc                 # Prettier 配置
└── ecosystem.config.js         # PM2 部署配置
```

## 🚀 快速开始

### 环境要求

- Node.js >= 20.0.0
- pnpm >= 8.0.0

### 安装依赖

```bash
# 安装 pnpm (如果未安装)
npm install -g pnpm

# 安装项目依赖
pnpm install
```

### 构建项目

```bash
# 构建所有包
pnpm build

# 构建单个包
pnpm --filter @quant/exchange build
```

### 运行回测

```bash
# 生成模拟数据
pnpm --filter @quant/backtest-app backtest generate-data -S BTC/USDT -d 30

# 运行双均线策略回测
pnpm --filter @quant/backtest-app backtest run -s dual-ma -S BTC/USDT --mock

# 运行 RSI 策略回测
pnpm --filter @quant/backtest-app backtest run -s rsi -S BTC/USDT --mock
```

### 启动实盘交易

```bash
# 1. 复制环境配置
cp apps/live/.env.example apps/live/.env

# 2. 编辑 .env 文件，填写交易所 API 密钥

# 3. 启动（开发模式）
pnpm --filter @quant/live dev

# 4. 启动（生产模式 - 使用 PM2）
pnpm start:live
```

## 📚 包说明

### @quant/exchange - 交易所抽象层

统一的交易所 API 抽象，支持多交易所：

```typescript
import { createExchange } from '@quant/exchange';

const exchange = createExchange('binance', {
  apiKey: 'your-api-key',
  secret: 'your-secret',
  testnet: true,
});

await exchange.connect();
const balance = await exchange.fetchBalance();
```

### @quant/marketdata - 实时行情引擎

WebSocket 实时行情订阅：

```typescript
import { MarketDataEngine } from '@quant/marketdata';

const engine = new MarketDataEngine(exchange);

engine.on('kline', (symbol, kline) => {
  console.log(`${symbol}: ${kline.close}`);
});

await engine.subscribeKline('BTC/USDT', '1m');
```

### @quant/backtest - 事件驱动回测引擎

高性能回测引擎：

```typescript
import { BacktestEngine } from '@quant/backtest';

const engine = new BacktestEngine({
  initialBalance: new Decimal(10000),
  feeRate: new Decimal(0.001),
});

const result = await engine.run(strategy, klines);
console.log(`收益率: ${result.stats.totalReturnPercent}%`);
```

### @quant/strategy - 策略基础包

策略开发框架：

```typescript
import { BaseStrategy } from '@quant/strategy';

class MyStrategy extends BaseStrategy {
  protected onKlineData(symbol: string, klines: Kline[]): void {
    // 策略逻辑
    if (shouldBuy) {
      this.emitSignal({ symbol, side: 'buy', amount: 0.1 });
    }
  }
}
```

### @quant/risk - 风控管理中心

全面的风控规则：

```typescript
import { RiskManager } from '@quant/risk';

const riskManager = new RiskManager({
  positionLimits: { maxPositionSize: 100000 },
  lossLimits: { maxDailyLoss: 5000, maxDrawdown: 10 },
});

const check = riskManager.checkOrder(order);
if (!check.allowed) {
  console.log(`风控拦截: ${check.reason}`);
}
```

### @quant/executor - 智能订单执行器

多种执行算法：

```typescript
import { OrderExecutor } from '@quant/executor';

const executor = new OrderExecutor(exchange, config, riskManager);

// TWAP 执行
const result = await executor.execute(order, 'twap', {
  duration: 300000, // 5分钟
  slices: 10,
});
```

### @quant/monitor - 监控告警中心

系统监控和多渠道告警：

```typescript
import { MonitorCenter } from '@quant/monitor';

const monitor = new MonitorCenter({
  channels: [
    { type: 'telegram', enabled: true, config: { botToken, chatId } },
  ],
});

await monitor.alert('trading', 'warning', '滑点过大', '订单滑点超过 1%', 'executor');
```

## 🛠️ 开发

### 代码检查

```bash
# ESLint 检查
pnpm lint

# 类型检查
pnpm typecheck

# 格式化代码
pnpm format
```

### 测试

```bash
# 运行所有测试
pnpm test

# 运行单个包测试
pnpm --filter @quant/strategy test
```

### 清理构建

```bash
pnpm clean
```

## 🔧 配置

### 交易所配置

在 `.env` 文件中配置：

```env
EXCHANGE_TYPE=binance
EXCHANGE_API_KEY=your_api_key
EXCHANGE_API_SECRET=your_secret
EXCHANGE_TESTNET=true
```

### 风控配置

```typescript
const riskConfig = {
  positionLimits: {
    maxPositionSize: 1000000,    // 最大持仓金额
    maxPositionPerSymbol: 100000, // 单品种最大持仓
    maxTotalPositions: 10,        // 最大持仓数量
    maxLeverage: 3,               // 最大杠杆
  },
  lossLimits: {
    maxDailyLoss: 10000,          // 日最大亏损
    maxDrawdown: 20,              // 最大回撤 %
    maxConsecutiveLosses: 5,      // 最大连续亏损次数
  },
};
```

## 📊 回测报告

回测完成后自动生成：

- **文本报告** (.txt) - 命令行友好的摘要报告
- **JSON 报告** (.json) - 程序化处理的详细数据
- **HTML 报告** (.html) - 可视化的交互式报告

## ⚠️ 风险提示

本系统仅供学习和研究使用。加密货币交易具有高风险，可能导致全部本金损失。在实盘交易前，请：

1. 充分了解市场风险
2. 使用测试网进行充分测试
3. 从小资金开始
4. 严格设置风控参数

## 📄 许可证

MIT License
