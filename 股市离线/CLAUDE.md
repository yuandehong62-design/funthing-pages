# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

异环二创模拟股票交易平台（海洛易 / HailuoYi），纯 HTML 前端实现。用户在虚构经济体系中体验股票交易博弈。

- **入口文件**: `index.html`（单文件应用，约 2300 行 CSS + HTML + JS 全部内联）
- **在线演示**: https://gp.starsky.icu
- **许可证**: GPL-3.0
- **Android 包名**: `icu.starsky.bank`

## 项目结构

```
htlgpbank/
├── index.html    # 单文件应用（CSS + HTML + JS 内联）
├── logo.png      # Logo 图片（也用作 Android 图标）
├── open.png      # 开屏动画图片
├── README.md     # 中文说明
└── README.en.md  # 英文说明

../ (上级目录)
├── base(1)..apk           # 旧版 APK（WebCat 壳，构建新 APK 时以此为模板）
├── build_apk.py           # APK 构建脚本（自动解压壳 → 注入 html → 自签）
├── hailuoyi_key.pem       # APK 签名密钥（保留用于后续版本升级）
├── hailuoyi_cert.pem      # APK 签名证书
└── hailuoyi_v1.3_AI.apk   # 最新 APK 安装包
```

## 开发命令

### 本地预览
```bash
# 在项目目录启动 HTTP 服务器
cd htlgpbank && python -m http.server 8080
# 然后浏览器打开 http://localhost:8080
```

### 构建 Android APK
```bash
# 依赖: Python 3 + cryptography 库
# 在上级目录执行，自动读取 htlgpbank/index.html 打包
PYTHONIOENCODING=utf-8 python build_apk.py
# 输出: hailuoyi_v1.3_AI.apk
```

构建脚本流程：读取 `htlgpbank/index.html` → 注入 WebCat APK 壳 → PKCS#7 自签 → 输出 APK。
签名密钥为自签证书，安装时需开启"允许未知来源"。与旧版证书不同，需卸载旧版后安装。

## 技术架构

### CSS 层
- 变量定义在 `:root` 中，核心颜色：`--red: #e2233e`（涨）、`--green: #00a800`（跌）
- 响应式断点：1200px / 900px / 768px（竖屏手机适配）
- 滚动条、Toast、模态框均有独立样式

### JS 模块架构

代码按功能划分为独立对象，通过全局变量互相调用：

| 模块 | 职责 |
|------|------|
| `utils` | 工具函数：DOM查询(`$`)、数值格式化(`fmt`)、涨跌样式类(`cls`)、Toast提示 |
| `CONFIG` | 静态配置：14只股票定义、初始资金(500万)、新闻/公告模板 |
| `AI_ACCOUNTS_DEF` | AI 账户定义：25个预定义账户（庄家/私募/游资/散户） |
| `AI_PRESETS` | AI API 预设：DeepSeek / OpenAI / 千问 / Claude 的默认端点 |
| `aiEngine` | AI 智能市场引擎核心（约400行） |
| `state` | 全局运行时状态：玩家资金、持仓、自选、当前股票等 |
| `core` | 核心数据引擎：K线生成、市场初始化、行情更新 |
| `chart` | Canvas 图表渲染：分时图、日K/周K/月K、十字光标交互 |
| `trade` | 交易系统：买入/卖出/持仓/记录、资产计算、市价委托 |
| `ui` | 界面渲染：股票列表、报价面板、盘口、信息面板 |
| `sys` | 系统控制：切换股票、自选管理、重置、设置弹窗 |

### 数据持久化

| localStorage Key | 内容 |
|-----------------|------|
| `helios_terminal_v2` | 玩家资金、持仓、委托记录、自选列表 |
| `helios_ai_config_v2` | AI 配置：API地址/Key/模型/间隔/温度/账户数 |
| `helios_ai_accounts_v2` | AI 账户运行时状态：资金、持仓、盈亏 |

### 行情更新循环（1秒/次）

```
setInterval 1s
  └─ core.updateMarket()
       ├─ AI 开启: 应用买卖压力 + 微噪音 + 极低概率黑天鹅
       └─ AI 关闭: 原随机引擎（0.5%异动大波 + 10%中波 + 其余小波）
       └─ 更新K线、刷新UI、重绘图表
```

### AI 引擎工作流程

```
每15秒（可配置5-60s）:
  1. buildMarketSnapshot()  → 提取公开市场数据（不含玩家隐私）
  2. buildSystemPrompt()    → 构造角色化 System Prompt
  3. buildUserPrompt()      → 含所有AI账户状态 + 市场数据
  4. 调用 AI API（兼容 OpenAI 格式）
  5. _parseDecisions()      → 解析 JSON 决策数组
  6. _validateAndExecute()  → 风控校验（资金/持仓限制）+ 执行订单
  7. _applyPricePressure()  → 汇总买卖压力 → 分散到每个tick

每秒:
  noiseTrade() → 散户随机买卖（30%概率/tick）
  updateMarket() tick → 压力释放到价格
```

### 价格形成机制（AI 模式下）

```
净买压 = Σ买入成交额 - Σ卖出成交额
价格变动% = 净买压 / 流通市值(总市值×0.7) × 弹性系数(1.5)
```

- 单周期涨跌限制 ±2%，叠加涨跌停 ±10%
- 压力逐秒衰减（×0.7），趋势需持续订单维持
- 玩家大单产生即时冲击（弹性系数 2.0）

### AI 隐私保护设计

AI 只能看到公开市场数据，**绝对不能**包含：
- 玩家持仓、资金、成本价
- 玩家委托记录
- 玩家交易历史

AI 通过量价变化感知玩家操作，通过下单参与市场博弈。

## 代码约定

- 货币单位：方斯
- 交易单位：100股（1手）的整数倍
- A股规则：红涨绿跌、±10%涨跌停、K线红空心/绿实心
- 函数命名：驼峰式，事件处理用 `模块.方法()` 模式
- DOM 查询统一用 `utils.$('id')`
- Toast 级别：`'info'` / `'error'` / `'green'`

## 关键 DOM ID

| ID | 用途 |
|----|------|
| `aiModal` | AI 配置独立弹窗 |
| `settingsModal` | 系统设置弹窗 |
| `aiGlobalDot` / `aiGlobalLabel` | 底部导航 AI 状态指示 |
| `i-tab-ai` | 信息面板"AI动态"标签 |
| `dom-info-content` | 信息面板内容容器 |
| `dom-stock-list` | 左侧股票列表 |
| `tradePanel` | 右侧交易面板 |
| `mainCanvas` / `volCanvas` | 图表画布 |
| `toast` | 浮动提示 |
