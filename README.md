# Quant Trading System

工业级加密货币量化交易系统 | Industrial-grade Cryptocurrency Quantitative Trading System

## 目录

- [项目概述](#项目概述)
- [系统架构](#系统架构)
- [功能特性](#功能特性)
- [包结构说明](#包结构说明)
- [快速开始](#快速开始)
- [详细教程](#详细教程)
- [部署指南](#部署指南)
- [配置说明](#配置说明)
- [API 文档](#api-文档)
- [开发指南](#开发指南)

---

## 项目概述

本项目是一个完整的工业级加密货币量化交易系统，采用 TypeScript 开发，支持：

- **多交易所支持**：Binance Futures、Bybit V5、OKX
- **实时行情**：WebSocket 实时行情订阅，Redis 缓存
- **历史数据**：ClickHouse 存储，支持增量下载
- **策略开发**：技术指标、资金费率套利、自定义策略
- **事件驱动回测**：Tick 级别精度，支持多策略
- **风险控制**：多层风控规则，实时监控
- **生产部署**：PM2 集群模式，零宕机重载，策略热加载

### 技术栈

| 类别 | 技术 |
|------|------|
| 语言 | TypeScript 5.4+, Node.js 20+ |
| 包管理 | pnpm (Monorepo) |
| 数据库 | ClickHouse (时序数据), Redis (缓存/消息) |
| 部署 | PM2 集群模式 |
| 监控 | Prometheus + Grafana + Telegram |
| 验证 | Zod (运行时类型验证) |

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Quant Trading System                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │   Binance   │  │    Bybit    │  │     OKX     │  │   更多...   │   │
│  │   Futures   │  │     V5      │  │             │  │             │   │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘   │
│         │                │                │                │          │
│         └────────────────┼────────────────┼────────────────┘          │
│                          ▼                                            │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │                    @quant/exchange                             │   │
│  │              统一交易所 API 接口层                               │   │
│  │         (REST API + WebSocket + Zod 验证)                      │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                          │                                            │
│         ┌────────────────┼────────────────┐                          │
│         ▼                ▼                ▼                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                   │
│  │@quant/market│  │@quant/data- │  │ @quant/     │                   │
│  │   -data     │  │ downloader  │  │ marketdata  │                   │
│  │  实时行情    │  │  历史下载    │  │  行情管理    │                   │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                   │
│         │                │                │                          │
│         ▼                ▼                ▼                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                   │
│  │    Redis    │  │ ClickHouse  │  │   Memory    │                   │
│  │  实时缓存    │  │  历史存储    │  │   内存缓存   │                   │
│  └─────────────┘  └─────────────┘  └─────────────┘                   │
│                          │                                            │
│         ┌────────────────┴────────────────┐                          │
│         ▼                                 ▼                          │
│  ┌───────────────────┐          ┌───────────────────┐                │
│  │  @quant/strategy  │          │  @quant/backtester│                │
│  │    策略引擎        │          │    回测引擎        │                │
│  │  - 技术指标        │          │  - 事件驱动        │                │
│  │  - 资金费率套利    │          │  - Tick 级精度     │                │
│  │  - 风险管理        │          │  - 多策略支持      │                │
│  │  - 订单执行        │          │  - 滑点模拟        │                │
│  └─────────┬─────────┘          └───────────────────┘                │
│            │                                                          │
│            ▼                                                          │
│  ┌───────────────────┐          ┌───────────────────┐                │
│  │  @quant/executor  │          │    @quant/risk    │                │
│  │    订单执行器      │◄────────►│     风控引擎       │                │
│  │  - TWAP/VWAP      │          │  - 仓位限制        │                │
│  │  - Post-Only      │          │  - 回撤控制        │                │
│  │  - 并行执行       │          │  - 熔断机制        │                │
│  └───────────────────┘          └───────────────────┘                │
│            │                                                          │
│            ▼                                                          │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │                      @quant/monitor                            │   │
│  │                        监控中心                                  │   │
│  │  - Prometheus 指标  - Telegram 通知  - Grafana 仪表盘           │   │
│  └───────────────────────────────────────────────────────────────┘   │
│            │                                                          │
│            ▼                                                          │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │                      @quant/deployer                           │   │
│  │                        部署模块                                  │   │
│  │  - PM2 集群部署  - 策略热加载  - 零宕机重载                       │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 功能特性

### 交易所支持

| 交易所 | REST API | WebSocket | 期货 | 现货 |
|--------|----------|-----------|------|------|
| Binance Futures | ✅ | ✅ | ✅ | - |
| Bybit V5 | ✅ | ✅ | ✅ | - |
| OKX | ✅ | ✅ | ✅ | - |

### 核心功能

- **统一 API**: 抽象不同交易所差异，提供一致的接口
- **实时行情**: WebSocket 推送，亚秒级延迟
- **历史数据**: 支持从交易所上市日开始下载完整历史
- **策略框架**: 内置技术指标、支持自定义策略
- **资金费率套利**: 跨交易所资金费率套利策略
- **事件驱动回测**: Tick 级别精度，真实模拟交易
- **风险控制**: 多层风控，自动止损/熔断
- **生产监控**: Prometheus 指标、Grafana 仪表盘、Telegram 告警

---

## 包结构说明

### 核心包

| 包名 | 说明 | 主要导出 |
|------|------|----------|
| `@quant/exchange` | 交易所适配器 | `createExchange()`, `BinanceFutures`, `BybitV5`, `OKX` |
| `@quant/market-data` | 实时行情引擎 | `MarketDataEngine`, `WsConnectionManager`, `RedisClient` |
| `@quant/data-downloader` | 历史数据下载 | `DataDownloader`, `ClickHouseDatabase`, `CheckpointManager` |
| `@quant/marketdata` | 行情数据管理 | `MarketDataEngine`, `OrderBookManager`, `KlineManager` |

### 策略包

| 包名 | 说明 | 主要导出 |
|------|------|----------|
| `@quant/strategy` | 策略引擎 | `BaseStrategy`, `FundingArbitrageStrategy`, `RiskManager`, `OrderExecutor` |
| `@quant/backtest` | 回测框架 | `BacktestEngine`, `SimulatedBroker`, `StatsCalculator` |
| `@quant/backtester` | 事件驱动回测 | `EventDrivenBacktester`, `MatchingEngine`, `AccountManager` |

### 风控与执行

| 包名 | 说明 | 主要导出 |
|------|------|----------|
| `@quant/risk` | 风控规则 | `RiskManager`, `PositionSizeRule`, `CircuitBreakerRule` |
| `@quant/executor` | 订单执行 | `OrderExecutor`, `ExecutionRequest`, `ExecutionResult` |

### 监控与部署

| 包名 | 说明 | 主要导出 |
|------|------|----------|
| `@quant/monitor` | 监控中心 | `MonitorOrchestrator`, `PrometheusCollector`, `TelegramBot` |
| `@quant/deployer` | 部署工具 | `HotReloadManager`, `PM2ConfigGenerator`, `ClusterManager` |

---

## 快速开始

### 环境要求

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- Redis (可选，用于实时行情)
- ClickHouse (可选，用于历史数据)

### 安装

```bash
# 克隆项目
git clone https://github.com/your-repo/quant-trading-system.git
cd quant-trading-system

# 安装依赖
pnpm install

# 构建所有包
pnpm build
```

### 基础示例

```typescript
import { createExchange } from '@quant/exchange';

// 创建 Binance 期货实例
const exchange = createExchange('binance_futures', {
  apiKey: 'YOUR_API_KEY',
  apiSecret: 'YOUR_API_SECRET',
  testnet: true,  // 使用测试网
});

// 加载市场信息
await exchange.loadMarkets();

// 获取账户余额
const balance = await exchange.getBalance();
console.log('总权益:', balance.totalEquity);

// 获取持仓
const positions = await exchange.getPositions();
positions.forEach(pos => {
  console.log(`${pos.symbol}: ${pos.side} ${pos.amount}`);
});

// 创建订单
const order = await exchange.createOrder({
  symbol: 'BTC/USDT:USDT',
  side: 'buy',
  type: 'limit',
  amount: 0.001,
  price: 50000,
});

console.log('订单创建成功:', order.id);
```

---

## 详细教程

### 1. 交易所适配器使用

#### 创建交易所实例

```typescript
import { createExchange, type ExchangeConfig } from '@quant/exchange';

// Binance 期货
const binance = createExchange('binance_futures', {
  apiKey: 'xxx',
  apiSecret: 'yyy',
  testnet: true,
});

// Bybit V5
const bybit = createExchange('bybit_v5', {
  apiKey: 'xxx',
  apiSecret: 'yyy',
  testnet: true,
});

// OKX (需要 passphrase)
const okx = createExchange('okx', {
  apiKey: 'xxx',
  apiSecret: 'yyy',
  passphrase: 'zzz',
  sandbox: true,
});
```

#### 订阅实时行情

```typescript
// 监听 Ticker 更新
exchange.on('ticker', (ticker) => {
  console.log(`${ticker.symbol}: ${ticker.last}`);
});

// 监听深度更新
exchange.on('orderbook', (orderbook) => {
  console.log(`买一: ${orderbook.bids[0]?.price}`);
  console.log(`卖一: ${orderbook.asks[0]?.price}`);
});

// 订阅行情
await exchange.subscribeTicker('BTC/USDT:USDT');
await exchange.subscribeOrderBook('BTC/USDT:USDT');
```

### 2. 实时行情引擎

```typescript
import { MarketDataEngine } from '@quant/market-data';

// 创建引擎
const engine = new MarketDataEngine({
  redis: {
    host: 'localhost',
    port: 6379,
  },
  enableTimeSeries: true,
  enablePubSub: true,
});

// 启动引擎
await engine.start();

// 订阅多交易所行情
engine.subscribeTicker('binance', ['BTC/USDT:USDT', 'ETH/USDT:USDT']);
engine.subscribeTicker('bybit', ['BTC/USDT:USDT']);
engine.subscribeDepth('binance', ['BTC/USDT:USDT'], 5);

// 监听数据
engine.on('ticker', (ticker) => {
  console.log(`[${ticker.exchange}] ${ticker.symbol}: ${ticker.last}`);
});

// 获取统计
const stats = engine.getStats();
console.log('消息速率:', stats.messages.perSecond);
```

### 3. 历史数据下载

```typescript
import { createDownloader } from '@quant/data-downloader';

// 创建下载器
const downloader = await createDownloader({
  exchanges: ['binance', 'bybit', 'okx'],
  symbols: ['BTC/USDT:USDT', 'ETH/USDT:USDT'],
  dataTypes: ['kline', 'funding_rate', 'agg_trade'],
  startTime: '2020-01-01',
}, {
  host: 'localhost',
  port: 8123,
  database: 'quant',
});

// 监听进度
downloader.on('progress', (event) => {
  console.log(`${event.exchange}/${event.symbol}: ${event.progress}%`);
});

// 开始下载
await downloader.start();

// 增量更新
await downloader.incrementalUpdate();
```

### 4. 策略开发

#### 基础策略

```typescript
import { BaseStrategy, type StrategyContext, type TradeEvent } from '@quant/backtester';

class MyStrategy extends BaseStrategy {
  readonly name = 'my-strategy';
  readonly version = '1.0.0';

  // 均线周期
  private shortPeriod = 10;
  private longPeriod = 30;
  private prices: number[] = [];

  onTrade(event: TradeEvent, context: StrategyContext) {
    // 记录价格
    this.prices.push(event.price);
    if (this.prices.length > this.longPeriod) {
      this.prices.shift();
    }

    // 计算均线
    if (this.prices.length < this.longPeriod) return;

    const shortMA = this.calcMA(this.shortPeriod);
    const longMA = this.calcMA(this.longPeriod);

    // 获取当前持仓
    const position = context.positions.get(`${event.exchange}:${event.symbol}`);

    // 金叉做多
    if (shortMA > longMA && (!position || position.side === 'none')) {
      return {
        orders: [{
          exchange: event.exchange,
          symbol: event.symbol,
          side: 'buy',
          type: 'market',
          quantity: 0.01,
        }],
      };
    }

    // 死叉平仓
    if (shortMA < longMA && position?.side === 'long') {
      return {
        orders: [{
          exchange: event.exchange,
          symbol: event.symbol,
          side: 'sell',
          type: 'market',
          quantity: position.quantity,
          reduceOnly: true,
        }],
      };
    }
  }

  private calcMA(period: number): number {
    const slice = this.prices.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  }
}
```

#### 资金费率套利策略

```typescript
import { createFundingArbitrageStrategy } from '@quant/strategy';

// 创建策略
const strategy = createFundingArbitrageStrategy({
  symbols: ['BTC/USDT:USDT', 'ETH/USDT:USDT'],
  minSpreadToOpen: 0.15,    // 年化利差 > 15% 开仓
  minSpreadToHold: 0.05,    // 年化利差 > 5% 维持
  targetSharpeRatio: 4.0,   // 目标夏普比率
  targetMaxDrawdown: 0.08,  // 目标最大回撤
});

// 启动策略
strategy.start(10000);

// 更新资金费率
strategy.updateFundingRate(
  'binance',
  'BTC/USDT:USDT',
  0.0001,    // 当前费率
  0.00012,   // 预测费率
  42000,     // 标记价格
  41990,     // 指数价格
  Date.now() + 8 * 60 * 60 * 1000  // 下次结算时间
);

// 生成交易信号
const signals = strategy.tick();
signals.forEach(signal => {
  console.log(`${signal.action}: ${signal.exchange} ${signal.symbol}`);
});

// 获取指标
const metrics = strategy.getMetrics();
console.log(`夏普比率: ${metrics.sharpeRatio.toFixed(2)}`);
console.log(`最大回撤: ${(metrics.maxDrawdown * 100).toFixed(2)}%`);
```

### 5. 回测系统

```typescript
import { createBacktester, BaseStrategy } from '@quant/backtester';

// 创建回测器
const backtester = createBacktester({
  config: {
    exchanges: ['binance'],
    symbols: ['BTC/USDT:USDT'],
    startTime: '2024-01-01',
    endTime: '2024-01-31',
    initialBalance: 10000,
    defaultLeverage: 10,
    feeConfig: {
      maker: 0.0002,  // 0.02%
      taker: 0.0004,  // 0.04%
    },
    slippageConfig: {
      type: 'dynamic',
      maxSlippage: 0.001,
      useDepth: true,
    },
    clickhouse: {
      host: 'localhost',
      port: 8123,
      database: 'quant',
    },
  },
  strategies: [new MyStrategy()],
  onProgress: (progress) => {
    console.log(`进度: ${progress.percent.toFixed(1)}%`);
    console.log(`权益: $${progress.equity.toFixed(2)}`);
  },
});

// 运行回测
const result = await backtester.run();

// 输出结果
console.log('=== 回测结果 ===');
console.log(`总收益: ${(result.stats.totalReturn * 100).toFixed(2)}%`);
console.log(`最大回撤: ${(result.stats.maxDrawdown * 100).toFixed(2)}%`);
console.log(`夏普比率: ${result.stats.sharpeRatio.toFixed(2)}`);
console.log(`胜率: ${(result.stats.winRate * 100).toFixed(2)}%`);
console.log(`交易次数: ${result.stats.totalTrades}`);
```

### 6. 风险管理

```typescript
import { getRiskManager, type Executor, type RiskEvent } from '@quant/strategy';

// 创建执行器实现
const executor: Executor = {
  async emergencyCloseAll() {
    console.log('紧急平仓所有持仓');
    // 实现紧急平仓逻辑
  },
  async reducePosition(exchange, symbol, ratio) {
    console.log(`减仓: ${exchange} ${symbol} ${ratio * 100}%`);
    // 实现减仓逻辑
  },
  pauseAllStrategies(reason) {
    console.log(`暂停策略: ${reason}`);
    // 实现暂停逻辑
  },
  resumeAllStrategies() {
    console.log('恢复策略');
    // 实现恢复逻辑
  },
};

// 获取风险管理器单例
const riskManager = getRiskManager({
  minMarginRatio: 0.35,      // 保证金率 < 35% 全平
  maxPositionRatio: 0.12,    // 单币种 > 12% 报警
  btcCrashThreshold: 0.06,   // BTC 10分钟跌幅 > 6%
  maxDailyDrawdown: 0.07,    // 当日回撤 > 7% 暂停
});

// 启动风控
riskManager.start(executor, 10000);

// 监听风控事件
riskManager.onRiskEvent((event: RiskEvent) => {
  console.log(`[风控] ${event.type}: ${event.message}`);
});

// 更新账户信息
riskManager.updateAccount({
  exchange: 'binance',
  totalEquity: 10000,
  availableBalance: 5000,
  totalMargin: 5000,
  totalNotional: 15000,
  marginRatio: 0.67,
  unrealizedPnl: 100,
  updatedAt: Date.now(),
});

// 更新 BTC 价格（用于崩盘检测）
riskManager.updateBtcPrice(42000);
```

### 7. 监控系统

```typescript
import { createMonitorOrchestrator } from '@quant/monitor';

// 创建监控协调器
const monitor = createMonitorOrchestrator({
  prometheus: {
    prefix: 'quant_',
  },
  telegram: {
    botToken: 'YOUR_BOT_TOKEN',
    chatId: 'YOUR_CHAT_ID',
    enabled: true,
  },
  enablePrometheus: true,
  enableTelegram: true,
  enableDailyReport: true,
  httpPort: 9090,
});

// 启动监控
await monitor.start(10000);  // 初始权益

// 更新数据
monitor.updateEquity(10100);

monitor.recordPnl({
  timestamp: Date.now(),
  strategy: 'funding-arbitrage',
  symbol: 'BTC/USDT:USDT',
  realizedPnl: 50,
  unrealizedPnl: 50,
  totalPnl: 100,
});

monitor.recordLatency({
  timestamp: Date.now(),
  exchange: 'binance',
  operation: 'create_order',
  latencyMs: 50,
});

// 生成每日报告
const report = await monitor.generateDailyReport();
console.log(`日报: ${JSON.stringify(report, null, 2)}`);

// 获取 Prometheus 指标
const metrics = monitor.getPrometheusMetrics();
console.log(metrics);
```

---

## 部署指南

### PM2 集群部署

#### 1. 配置文件

项目根目录已包含 `ecosystem.config.mjs`:

```javascript
// ecosystem.config.mjs (已自动生成)
export default {
  apps: [{
    name: 'quant-trading',
    script: './dist/index.js',
    instances: 4,  // 自动适应 4-8 核
    exec_mode: 'cluster',
    max_memory_restart: '2G',
    wait_ready: true,
    listen_timeout: 10000,
    kill_timeout: 15000,
    // ...
  }],
};
```

#### 2. 启动服务

```bash
# 构建项目
pnpm build

# 使用 PM2 启动
pm2 start ecosystem.config.mjs

# 查看状态
pm2 status

# 查看日志
pm2 logs quant-trading

# 零宕机重载
pm2 reload quant-trading
```

#### 3. 策略热加载

```typescript
import { createDeployer } from '@quant/deployer';

// 创建部署器
const deployer = createDeployer({
  hotReload: {
    watchDir: './strategies',
    debounceMs: 500,  // 防抖 500ms
  },
  cluster: {
    gracefulShutdownTimeout: 15000,
  },
});

// 启动
await deployer.start();

// 监听策略更新
deployer.hotReloadManager.on('moduleUpdated', (moduleId, oldModule, newModule) => {
  console.log(`策略已更新: ${moduleId}`);
  console.log(`  旧版本: ${oldModule.version}`);
  console.log(`  新版本: ${newModule.version}`);
});
```

### Docker 部署

```dockerfile
# Dockerfile
FROM node:20-alpine

WORKDIR /app

# 安装 pnpm
RUN npm install -g pnpm

# 复制依赖文件
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/*/package.json ./packages/

# 安装依赖
RUN pnpm install --frozen-lockfile

# 复制源码
COPY . .

# 构建
RUN pnpm build

# 启动
CMD ["pm2-runtime", "ecosystem.config.mjs"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  quant-trading:
    build: .
    restart: always
    environment:
      - NODE_ENV=production
      - REDIS_HOST=redis
      - CLICKHOUSE_HOST=clickhouse
    depends_on:
      - redis
      - clickhouse
    ports:
      - "9090:9090"

  redis:
    image: redis:7-alpine
    restart: always
    volumes:
      - redis-data:/data

  clickhouse:
    image: clickhouse/clickhouse-server:latest
    restart: always
    volumes:
      - clickhouse-data:/var/lib/clickhouse
    ports:
      - "8123:8123"

  grafana:
    image: grafana/grafana:latest
    restart: always
    ports:
      - "3000:3000"
    volumes:
      - grafana-data:/var/lib/grafana

  prometheus:
    image: prom/prometheus:latest
    restart: always
    ports:
      - "9091:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml

volumes:
  redis-data:
  clickhouse-data:
  grafana-data:
```

---

## 配置说明

### 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `NODE_ENV` | 运行环境 | `development` |
| `REDIS_HOST` | Redis 主机 | `localhost` |
| `REDIS_PORT` | Redis 端口 | `6379` |
| `CLICKHOUSE_HOST` | ClickHouse 主机 | `localhost` |
| `CLICKHOUSE_PORT` | ClickHouse 端口 | `8123` |
| `CLICKHOUSE_DATABASE` | ClickHouse 数据库 | `quant` |
| `TELEGRAM_BOT_TOKEN` | Telegram 机器人令牌 | - |
| `TELEGRAM_CHAT_ID` | Telegram 聊天 ID | - |
| `MONITOR_PORT` | 监控 HTTP 端口 | `9090` |

### 交易所 API 配置

创建 `.env` 文件：

```env
# Binance
BINANCE_API_KEY=your_api_key
BINANCE_API_SECRET=your_api_secret
BINANCE_TESTNET=true

# Bybit
BYBIT_API_KEY=your_api_key
BYBIT_API_SECRET=your_api_secret
BYBIT_TESTNET=true

# OKX
OKX_API_KEY=your_api_key
OKX_API_SECRET=your_api_secret
OKX_PASSPHRASE=your_passphrase
OKX_SANDBOX=true
```

---

## API 文档

### @quant/exchange

#### createExchange(name, config)

创建交易所实例。

```typescript
function createExchange(
  name: 'binance_futures' | 'bybit_v5' | 'okx',
  config: ExchangeConfig
): BaseExchange;
```

#### BaseExchange

交易所基类，所有适配器都继承此类。

```typescript
class BaseExchange {
  // 加载市场信息
  async loadMarkets(): Promise<Market[]>;

  // 获取账户余额
  async getBalance(): Promise<Balance>;

  // 获取持仓
  async getPositions(): Promise<Position[]>;

  // 创建订单
  async createOrder(request: CreateOrderRequest): Promise<OrderResult>;

  // 取消订单
  async cancelOrder(symbol: string, orderId: string): Promise<void>;

  // 获取资金费率
  async getFundingRate(symbol: string): Promise<FundingRate>;

  // 订阅 Ticker
  async subscribeTicker(symbol: string): Promise<void>;

  // 订阅订单簿
  async subscribeOrderBook(symbol: string, depth?: number): Promise<void>;
}
```

### @quant/backtester

#### createBacktester(options)

创建回测器实例。

```typescript
function createBacktester(options: {
  config: BacktestConfig;
  strategies?: Strategy[];
  onProgress?: (progress: BacktestProgress) => void;
  onEquityUpdate?: (equity: number) => void;
  onTrade?: (trade: TradeRecord) => void;
}): EventDrivenBacktester;
```

#### BacktestConfig

```typescript
interface BacktestConfig {
  exchanges: ExchangeId[];
  symbols: string[];
  startTime: string | number;
  endTime: string | number;
  initialBalance: number;
  defaultLeverage: number;
  feeConfig?: FeeConfig;
  slippageConfig?: SlippageConfig;
  clickhouse: ClickHouseConfig;
}
```

### @quant/monitor

#### createMonitorOrchestrator(config)

创建监控协调器。

```typescript
function createMonitorOrchestrator(
  config?: Partial<MonitorOrchestratorConfig>
): MonitorOrchestrator;
```

#### MonitorOrchestrator

```typescript
class MonitorOrchestrator {
  // 启动监控
  async start(initialEquity: number): Promise<void>;

  // 停止监控
  async stop(): Promise<void>;

  // 更新权益
  updateEquity(equity: number): void;

  // 记录 PnL
  recordPnl(record: PnlRecord): void;

  // 记录延迟
  recordLatency(record: LatencyRecord): void;

  // 生成每日报告
  async generateDailyReport(): Promise<PerformanceReport>;

  // 获取 Prometheus 指标
  getPrometheusMetrics(): string;
}
```

---

## 开发指南

### 项目结构

```
quant-trading-system/
├── packages/
│   ├── exchange/         # 交易所适配器
│   ├── market-data/      # 实时行情引擎
│   ├── marketdata/       # 行情数据管理
│   ├── data-downloader/  # 历史数据下载
│   ├── strategy/         # 策略引擎
│   ├── backtest/         # 回测框架
│   ├── backtester/       # 事件驱动回测
│   ├── risk/             # 风控规则
│   ├── executor/         # 订单执行
│   ├── monitor/          # 监控中心
│   └── deployer/         # 部署工具
├── ecosystem.config.mjs  # PM2 配置
├── tsconfig.json         # TypeScript 配置
├── package.json          # 项目配置
└── pnpm-workspace.yaml   # pnpm 工作区配置
```

### 开发命令

```bash
# 安装依赖
pnpm install

# 开发模式（监听文件变化）
pnpm dev

# 构建所有包
pnpm build

# 类型检查
pnpm typecheck

# 代码格式化
pnpm format

# 代码检查
pnpm lint

# 运行测试
pnpm test

# 清理构建产物
pnpm clean
```

### 添加新包

1. 在 `packages/` 下创建新目录
2. 添加 `package.json`:

```json
{
  "name": "@quant/your-package",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.build.json --noEmit"
  }
}
```

3. 添加 `tsconfig.build.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"]
}
```

4. 在根目录的 `tsconfig.json` 中添加路径映射

---

## License

MIT
