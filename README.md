# Potato Swap Bot

一个用于在X-Layer上的PotatoSwap DEX自动添加流动性的工具。

## 功能特性

- ✅ 从环境变量读取配置，安全管理私钥
- ✅ 自动检查子钱包余额是否充足
- ✅ 智能价格计算 - 从现有流动池获取实时价格比例
- ✅ 并发控制 - 批量处理以提高效率
- ✅ 完整的错误处理和日志记录
- ✅ TypeScript类型安全

## 环境要求

- Node.js 18+
- npm 或 yarn

## 安装

```bash
npm install
```

## 配置

1. 复制环境变量模板：
```bash
cp .env.example .env
```

2. 编辑 `.env` 文件，填入实际值：

```env
# 网络配置
RPC_URL=https://rpc.xlayer.tech
CHAIN_ID=196

# 合约地址 (根据实际部署地址修改)
OKB_CONTRACT=0xe538905cf8410324e03a5a23c1c177a474d59b2b
USDT_CONTRACT=0x1e4a5963abfd975d8c9021ce480b42188849d41d
POTATO_SWAP_ROUTER=0x881fb2f98c13d521009464e7d1cbf16e1b394e8e

# 子钱包配置
NUMBER_OF_WALLETS=2
OKB_PER_WALLET=0.01
USDT_PER_WALLET=3

# 子钱包私钥 (用逗号分隔，请确保有足够余额)
SUB_WALLET_PRIVATE_KEYS=0x1234...,0x5678...
```

## 使用前准备

**重要**: 在运行脚本之前，请确保：

1. **子钱包余额充足**: 每个子钱包必须至少有配置中指定的OKB和USDT数量
2. **私钥数量匹配**: `SUB_WALLET_PRIVATE_KEYS` 中的私钥数量必须与 `NUMBER_OF_WALLETS` 相匹配
3. **合约地址正确**: 确认所有合约地址都是正确的X-Layer上的地址

## 运行

该项目包含两个主要功能：

### 1. 创建子钱包并分发代币 (distribute.ts)

**用途**: 从主钱包创建新的子钱包并向其分发OKB和USDT代币

**配置要求**:
- 需要设置 `MAIN_WALLET_PRIVATE_KEY` (主钱包私钥，需要有足够的OKB和USDT余额)

**运行命令**:
```bash
# 开发环境
npm run distribute

# 生产环境
npm run distribute:build
```

### 2. 添加流动性 (potato.ts)

**用途**: 使用现有子钱包在PotatoSwap上添加流动性

**配置要求**:
- 需要设置 `SUB_WALLET_PRIVATE_KEYS` (子钱包私钥列表，每个钱包需要有足够余额)

**运行命令**:
```bash
# 开发环境
npm run dev

# 生产环境
npm run build
npm start
```

## 完整工作流程

### 首次使用流程：
1. **分发代币**: 
   - 配置 `MAIN_WALLET_PRIVATE_KEY` 
   - 运行 `npm run distribute` 创建子钱包并分发代币
   - 记录输出的子钱包私钥

2. **添加流动性**:
   - 将上一步的子钱包私钥填入 `SUB_WALLET_PRIVATE_KEYS`
   - 运行 `npm run dev` 开始添加流动性

### 后续使用（已有子钱包）：
- 直接运行 `npm run dev` 使用现有子钱包添加流动性

## 各功能详细流程

### distribute.ts 流程
1. **配置验证**: 验证主钱包私钥和合约地址
2. **余额检查**: 确认主钱包有足够的代币进行分发
3. **创建钱包**: 生成指定数量的新子钱包
4. **代币分发**: 向每个子钱包转账OKB和USDT

### potato.ts 流程
1. **配置验证**: 验证子钱包私钥格式和数量
2. **加载钱包**: 从私钥创建钱包实例
3. **余额检查**: 验证每个钱包的OKB和USDT余额是否充足
4. **价格计算**: 从现有流动池获取实时价格比例
5. **添加流动性**: 根据池子价格智能计算最优资金分配
6. **批量处理**: 并发执行以提高效率

## 安全注意事项

- ⚠️ **永远不要提交 `.env` 文件到代码仓库**
- ⚠️ **私钥信息高度敏感，请妥善保管**
- ⚠️ **建议先在测试网上测试**
- ⚠️ **确保钱包余额充足以避免交易失败**

## 错误处理

脚本包含完善的错误处理：

- 配置验证失败时会给出明确提示
- 余额不足时会详细显示每个钱包的状态
- 网络错误会自动重试（在未来版本中实现）
- 所有错误都有详细的日志记录

## 开发

### 构建
```bash
npm run build
```

### 类型检查
```bash
npm run type-check
```

## 许可证

MIT License