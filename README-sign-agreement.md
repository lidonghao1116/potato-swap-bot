# PotatoSwap 协议签名脚本

## 功能描述

这是一个用于自动签署 PotatoSwap 协议的 Node.js TypeScript 脚本。脚本会读取 `.env` 文件中的子钱包私钥，使用以太坊 `personal_sign` 方法对指定消息进行签名，然后提交到 PotatoSwap API，并自动验证签名状态。

## 核心功能

- ✅ 从 `.env` 读取子钱包私钥配置
- ✅ 使用 `personal_sign` 方法进行以太坊消息签名
- ✅ 自动调用 PotatoSwap API 提交签名
- ✅ 自动验证签名状态确认成功
- ✅ 完整日志记录到控制台和文件
- ✅ 跳过已签名的钱包（避免重复处理）

## 使用方法

### 1. 安装依赖
```bash
npm install
```

### 2. 配置环境变量
确保 `.env` 文件中包含子钱包私钥配置：
```env
SUB_WALLET_PRIVATE_KEYS=0x...
```
多个钱包用逗号分隔：
```env
SUB_WALLET_PRIVATE_KEYS=private_key_1,private_key_2,private_key_3
```

### 3. 运行脚本
```bash
# 开发模式运行
npm run sign

# 构建后运行
npm run sign:build
```

## 脚本流程

对每个钱包按顺序执行以下步骤：

1. **检查签名状态** - 调用 API 检查钱包是否已签名
2. **跳过已签名** - 如果已签名则跳过处理
3. **生成签名** - 使用 `personal_sign` 对指定消息进行签名
4. **提交签名** - 调用 PotatoSwap API 提交签名数据
5. **验证状态** - 等待3秒后再次检查签名状态确认成功

## API 接口

### 签名提交接口
```
POST https://api.potatoswap.finance/v1/agreement/sign
Content-Type: application/json

{
  "addr": "钱包地址",
  "message": "协议文本内容",
  "sign": "签名结果"
}
```

### 签名状态检查接口
```
GET https://api.potatoswap.finance/v1/agreement/signed?addr=钱包地址

{
  "code": 0,
  "msg": "OK", 
  "data": {
    "signed": true/false
  }
}
```

## 日志输出

脚本会同时输出到：
- **控制台** - 实时查看执行进度
- **日志文件** - `logs/sign-agreement.log` 持久化保存

日志包含：
- 🚀 脚本启动信息
- 📍 每个钱包的处理进度
- ✅ 成功操作的确认信息
- ❌ 错误信息和失败原因
- 📊 最终执行统计结果

## 安全说明

- 私钥仅用于本地签名，不会发送到任何服务器
- 签名使用标准的以太坊 `personal_sign` 方法
- 所有网络请求均为 HTTPS 加密传输
- 脚本会自动跳过已签名的钱包避免重复操作

## 错误处理

脚本包含完善的错误处理机制：
- 网络请求超时和重试
- API 响应错误检查
- 私钥格式验证
- 签名失败恢复
- 详细的错误日志记录

## 文件结构

```
potato-swap-bot/
├── sign-agreement.ts          # 主脚本文件
├── logs/
│   └── sign-agreement.log     # 日志输出文件
├── .env                       # 环境变量配置
└── package.json               # 项目依赖配置
```