import { ethers } from 'ethers';
import { randomBytes } from 'crypto';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 从环境变量读取配置
const config = {
  // 子钱包数量
  numberOfWallets: parseInt(process.env.NUMBER_OF_WALLETS || '2'),
  // 每个子钱包需要的OKB数量
  okbPerWallet: parseFloat(process.env.OKB_PER_WALLET || '0.08'),
  // 每个子钱包需要的USDT数量
  usdtPerWallet: parseFloat(process.env.USDT_PER_WALLET || '8'),
  // 滑点容忍度 (百分比, 例如: 5 = 5%)
  slippageTolerance: parseFloat(process.env.SLIPPAGE_TOLERANCE || '10'),
  // 安全缓冲区 (百分比, 例如: 10 = 10%)
  safetyBuffer: parseFloat(process.env.SAFETY_BUFFER || '10'),
  // 每次添加流动性的USDT数量
  usdtAmountPerLiquidity: parseFloat(process.env.USDT_AMOUNT_PER_LIQUIDITY || '3'),
  // 代币合约地址
  contracts: {
    // OKB是X Layer的原生代币，不需要合约地址
    usdt: process.env.USDT_CONTRACT || '0x1e4a5963abfd975d8c9021ce480b42188849d41d',
    potatoSwapRouter: process.env.POTATO_SWAP_ROUTER || '0x881fb2f98c13d521009464e7d1cbf16e1b394e8e',
    // WOKB (Wrapped OKB) 地址，用于查询池子比例
    wokb: process.env.WOKB_CONTRACT || '0xe538905cf8410324e03a5a23c1c177a474d59b2b',
    // WETH地址，用于价格计算
    weth: process.env.WETH_CONTRACT || '0x5A77f1443D16ee5761d310e38b62f77f726bC71c'
  },
  // RPC节点和链信息
  rpcUrl: process.env.RPC_URL || 'https://rpc.xlayer.tech',
  chainId: parseInt(process.env.CHAIN_ID || '196'),
  // 子钱包私钥
  subWalletPrivateKeys: (process.env.SUB_WALLET_PRIVATE_KEYS || '').split(',').filter(key => key.trim() !== '')
};

// 类型化接口定义
interface IERC20 {
  transfer(to: string, amount: bigint): Promise<ethers.ContractTransactionResponse>;
  approve(spender: string, amount: bigint): Promise<ethers.ContractTransactionResponse>;
  balanceOf(account: string): Promise<bigint>;
  allowance(owner: string, spender: string): Promise<bigint>;
}

interface IRouter {
  addLiquidity(
    tokenA: string,
    tokenB: string,
    amountADesired: bigint,
    amountBDesired: bigint,
    amountAMin: bigint,
    amountBMin: bigint,
    to: string,
    deadline: number
  ): Promise<ethers.ContractTransactionResponse>;
  factory(): Promise<string>;
}

interface IFactory {
  getPair(tokenA: string, tokenB: string): Promise<string>;
}

interface IPair {
  getReserves(): Promise<[bigint, bigint, number]>;
  token0(): Promise<string>;
  token1(): Promise<string>;
}

// ERC20 ABI
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
  "function decimals() external view returns (uint8)"
];

// UniswapV2 Router ABI (PotatoSwap兼容)
const ROUTER_ABI = [
  "function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint256 amountA, uint256 amountB, uint256 liquidity)",
  "function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)",
  "function factory() external pure returns (address)",
  "function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) external pure returns (uint256 amountB)",
  "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)"
];

// Factory ABI
const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)"
];

// Pair ABI
const PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)"
];

// 验证配置
function validateConfig() {
  const requiredFields = [
    { field: 'contracts.usdt', value: config.contracts.usdt },
    { field: 'contracts.potatoSwapRouter', value: config.contracts.potatoSwapRouter },
    { field: 'contracts.wokb', value: config.contracts.wokb }
  ];

  for (const { field, value } of requiredFields) {
    if (!value || value.includes('Your') || value.includes('Address')) {
      throw new Error(`请在.env文件中设置实际的 ${field} 地址，当前值: ${value}`);
    }
  }

  // 验证滑点配置
  if (config.slippageTolerance < 0 || config.slippageTolerance > 50) {
    throw new Error(`滑点容忍度必须在0-50%之间，当前值: ${config.slippageTolerance}%`);
  }

  // 验证安全缓冲区配置
  if (config.safetyBuffer < 0 || config.safetyBuffer > 50) {
    throw new Error(`安全缓冲区必须在0-50%之间，当前值: ${config.safetyBuffer}%`);
  }

  // 验证子钱包私钥
  if (config.subWalletPrivateKeys.length === 0) {
    throw new Error('请在.env文件中设置SUB_WALLET_PRIVATE_KEYS，用逗号分隔多个私钥');
  }

  if (config.subWalletPrivateKeys.length !== config.numberOfWallets) {
    throw new Error(`子钱包私钥数量(${config.subWalletPrivateKeys.length})与配置的钱包数量(${config.numberOfWallets})不匹配`);
  }

  // 验证每个私钥格式
  for (let i = 0; i < config.subWalletPrivateKeys.length; i++) {
    const privateKey = config.subWalletPrivateKeys[i]?.trim();
    if (!privateKey?.match(/^0x[0-9a-fA-F]{64}$/)) {
      throw new Error(`子钱包私钥 ${i + 1} 格式不正确，应为64位十六进制字符串，以0x开头`);
    }
  }

  console.log('✅ 配置验证通过');
  console.log(`📊 当前配置: 滑点容忍度=${config.slippageTolerance}%, 安全缓冲区=${config.safetyBuffer}%`);
}

// 备用RPC端点列表
const rpcUrls = [
  'https://rpc.xlayer.tech',
  'https://xlayerrpc.okx.com',
  'https://endpoints.omniatech.io/v1/xlayer/mainnet/public'
];

// 创建带故障转移的提供者
function createProvider() {
  for (const rpcUrl of rpcUrls) {
    try {
      console.log(`尝试连接RPC: ${rpcUrl}`);
      return new ethers.JsonRpcProvider(rpcUrl, {
        chainId: config.chainId,
        name: "X Layer"
      });
    } catch (error) {
      console.log(`RPC ${rpcUrl} 连接失败，尝试下一个...`);
    }
  }
  throw new Error('所有RPC端点都不可用');
}

const provider = createProvider();

// 定义钱包接口
interface Wallet {
  privateKey: string;
  address: string;
  wallet: ethers.Wallet;
}

// 从环境变量加载子钱包
async function loadSubWallets(): Promise<Wallet[]> {
  const wallets: Wallet[] = [];
  
  for (let i = 0; i < config.subWalletPrivateKeys.length; i++) {
    const privateKey = config.subWalletPrivateKeys[i]!.trim();
    const wallet = new ethers.Wallet(privateKey, provider);
    
    wallets.push({
      privateKey,
      address: wallet.address,
      wallet
    });
    console.log(`加载子钱包 ${i + 1}: ${wallet.address}`);
  }
  return wallets;
}

// 检查子钱包余额是否满足要求
async function validateWalletBalances(wallets: Wallet[]): Promise<boolean> {
  console.log('\n检查子钱包余额...');
  let allValid = true;

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i]!;
    try {
      // 检查OKB余额
      const okbBalance = await wallet.wallet.provider!.getBalance(wallet.address);
      const requiredOkb = ethers.parseEther(config.okbPerWallet.toString());
      
      // 检查USDT余额
      const usdtContract = new ethers.Contract(config.contracts.usdt, ERC20_ABI, wallet.wallet) as unknown as IERC20;
      const usdtBalance = await usdtContract.balanceOf(wallet.address);
      const requiredUsdt = ethers.parseUnits(config.usdtPerWallet.toString(), 6);

      const okbBalanceFormatted = ethers.formatEther(okbBalance);
      const usdtBalanceFormatted = ethers.formatUnits(usdtBalance, 6);

      console.log(`钱包 ${i + 1} (${wallet.address}):`);
      console.log(`  OKB: ${okbBalanceFormatted} (需要: ${config.okbPerWallet})`);
      console.log(`  USDT: ${usdtBalanceFormatted} (需要: ${config.usdtPerWallet})`);

      const okbSufficient = okbBalance >= requiredOkb;
      const usdtSufficient = usdtBalance >= requiredUsdt;

      if (!okbSufficient) {
        console.log(`  ❌ OKB余额不足`);
        allValid = false;
      } else {
        console.log(`  ✅ OKB余额充足`);
      }

      if (!usdtSufficient) {
        console.log(`  ❌ USDT余额不足`);
        allValid = false;
      } else {
        console.log(`  ✅ USDT余额充足`);
      }

    } catch (error) {
      console.error(`钱包 ${i + 1} 余额检查失败:`, (error as Error).message);
      allValid = false;
    }
  }

  return allValid;
}


// 重试机制包装函数
async function retryOperation<T>(operation: () => Promise<T>, maxRetries: number = 3, delay: number = 2000): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error: any) {
      const isLastAttempt = i === maxRetries - 1;
      
      // 检查是否是网络相关错误
      if (error?.code === 'UNKNOWN_ERROR' && error?.error?.code === -32011) {
        console.log(`网络错误，尝试重试 (${i + 1}/${maxRetries}): ${error.error.message}`);
        
        if (!isLastAttempt) {
          console.log(`等待 ${delay}ms 后重试...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
      
      // 其他错误或最后一次尝试，直接抛出
      throw error;
    }
  }
  throw new Error('重试次数已用完');
}

// 批准代币用于流动性添加
async function approveTokenForSwap(wallet: ethers.Wallet, tokenAddress: string, spender: string, amount: bigint, decimals: number = 18) {
  return retryOperation(async () => {
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
    
    // 检查当前授权额度
    const currentAllowance = await (contract as any).allowance(wallet.address, spender);
    
    // 获取代币的总供应量作为最大授权数量
    const totalSupply = await (contract as any).totalSupply();
    
    console.log(`当前授权额度: ${ethers.formatUnits(currentAllowance, decimals)}, 需要: ${ethers.formatUnits(amount, decimals)}`);
    console.log(`代币总供应量: ${ethers.formatUnits(totalSupply, decimals)}`);
    
    // 检查是否已经有足够的授权（总供应量的一半以上视为充分授权）
    if (currentAllowance >= totalSupply / BigInt(2)) {
      console.log(`代币 ${tokenAddress} 已有充分授权额度，跳过授权`);
      return null;
    }
    
    // 如果有旧的授权，先重置为0（某些代币需要）
    if (currentAllowance > 0) {
      console.log(`重置旧授权额度...`);
      const resetTx = await (contract as any).approve(spender, 0);
      await resetTx.wait();
    }
    
    // 使用代币总供应量作为授权额度
    const tx = await (contract as any).approve(spender, totalSupply);
    
    console.log(`批准代币总供应量 ${ethers.formatUnits(totalSupply, decimals)} 给 ${spender}, 交易哈希: ${tx.hash}`);
    await tx.wait(); // 等待交易确认
    return tx.hash;
  });
}

// 使用DEX Router的getAmountsOut获取精确价格数据
async function getOkbAmountFromRouter(wallet: ethers.Wallet, usdtAmount: bigint): Promise<bigint | null> {
  try {
    const routerContract = new ethers.Contract(config.contracts.potatoSwapRouter, ROUTER_ABI, wallet);
    
    console.log('🔍 尝试通过DEX Router getAmountsOut获取价格信息...');
    
    // 方法1: 直接使用getAmountsOut进行USDT → WOKB的转换
    // 路径: [USDT, WOKB] (因为addLiquidityETH最终使用的是OKB，而WOKB=OKB在价值上)
    const path = [config.contracts.usdt, config.contracts.wokb];
    
    try {
      const amounts = await routerContract.getAmountsOut(usdtAmount, path);
      const okbAmount = amounts[1]; // 第二个元素是输出数量
      
      console.log(`✅ getAmountsOut结果:`);
      console.log(`  输入USDT: ${ethers.formatUnits(usdtAmount, 6)}`);
      console.log(`  输出WOKB: ${ethers.formatEther(okbAmount)}`);
      console.log(`  路径: USDT → WOKB`);
      console.log(`  计算价格: 1 OKB = ${(Number(ethers.formatUnits(usdtAmount, 6)) / Number(ethers.formatEther(okbAmount))).toFixed(2)} USDT`);
      
      return okbAmount;
      
    } catch (routerError) {
      console.log('⚠️  getAmountsOut失败，尝试查询池子储备:', (routerError as Error).message);
    }
    
    // 方法2: 备用方案 - 直接查询池子储备计算价格
    const factoryAddress = await routerContract.factory();
    const factoryContract = new ethers.Contract(factoryAddress, FACTORY_ABI, wallet);
    
    // 查找USDT/WOKB配对
    const pairAddress = await factoryContract.getPair(config.contracts.usdt, config.contracts.wokb);
    
    if (pairAddress === ethers.ZeroAddress) {
      console.log('⚠️  未找到USDT/WOKB配对池');
      return null;
    }
    
    // 获取配对池储备
    const pairContract = new ethers.Contract(pairAddress, PAIR_ABI, wallet);
    const [reserve0, reserve1] = await pairContract.getReserves();
    const token0 = await pairContract.token0();
    
    let usdtReserve, wokbReserve;
    if (token0.toLowerCase() === config.contracts.usdt.toLowerCase()) {
      usdtReserve = reserve0;
      wokbReserve = reserve1;
    } else {
      usdtReserve = reserve1;
      wokbReserve = reserve0;
    }
    
    // 检查储备是否合理
    if (wokbReserve < ethers.parseEther("0.1")) {
      console.log('⚠️  WOKB池子储备过低，可能不是主要交易池');
      return null;
    }
    
    // 使用路由器的quote函数计算精确数量  
    const okbAmount = await routerContract.quote(usdtAmount, usdtReserve, wokbReserve);
    
    console.log(`✅ 池子Quote结果:`);
    console.log(`  池子USDT储备: ${ethers.formatUnits(usdtReserve, 6)}`);
    console.log(`  池子WOKB储备: ${ethers.formatEther(wokbReserve)}`);
    console.log(`  投入USDT: ${ethers.formatUnits(usdtAmount, 6)}`);
    console.log(`  需要OKB: ${ethers.formatEther(okbAmount)}`);
    console.log(`  计算价格: 1 OKB = ${(Number(ethers.formatUnits(usdtAmount, 6)) / Number(ethers.formatEther(okbAmount))).toFixed(2)} USDT`);
    
    return okbAmount;
    
  } catch (error) {
    console.log('❌ DEX价格获取完全失败:', (error as Error).message);
    return null;
  }
}

// 获取流动池当前价格比例的辅助函数 (USDT/WOKB池子) - 保留作为备用
async function getPoolRatio(wallet: ethers.Wallet, usdtAddress: string): Promise<{okbReserve: bigint, usdtReserve: bigint} | null> {
  try {
    // 直接使用独立的合约实例，避免 contract runner 问题
    const routerContract = new ethers.Contract(config.contracts.potatoSwapRouter, ROUTER_ABI, wallet);
    const factoryAddress = await (routerContract as any).factory();
    const factoryContract = new ethers.Contract(
      factoryAddress,
      FACTORY_ABI,
      wallet
    ) as unknown as IFactory;
    
    // 查询WOKB/USDT池子比例（用于addLiquidityETH的价格参考）
    const pairAddress = await factoryContract.getPair(config.contracts.wokb, usdtAddress);
    
    if (pairAddress === ethers.ZeroAddress) {
      console.log('WOKB/USDT 流动池不存在，使用配置的默认比例');
      return null;
    }
    
    // 使用独立的 provider 实例来查询池子信息
    const pairContract = new ethers.Contract(pairAddress, PAIR_ABI, wallet) as unknown as IPair;
    
    const [reserve0, reserve1] = await pairContract.getReserves();
    const token0 = await pairContract.token0();
    
    // 确定WOKB和USDT在池子中的位置
    let okbReserve, usdtReserve;
    if (token0.toLowerCase() === config.contracts.wokb.toLowerCase()) {
      okbReserve = reserve0;
      usdtReserve = reserve1;
    } else {
      okbReserve = reserve1;
      usdtReserve = reserve0;
    }
    
    console.log(`池子储备量 - WOKB: ${ethers.formatEther(okbReserve)}, USDT: ${ethers.formatUnits(usdtReserve, 6)}`);
    return { okbReserve, usdtReserve };
  } catch (error) {
    console.log('获取池子信息失败，使用配置的默认比例:', (error as Error).message);
    return null;
  }
}

// 在PotatoSwap添加流动性 (OKB/USDT)
async function addLiquidityETH(
  wallet: ethers.Wallet, 
  routerAddress: string,
  usdtAddress: string, 
  usdtAmount: bigint,
  okbAmount: bigint
) {
  return retryOperation(async () => {
    // 只需要批准USDT，OKB作为原生代币不需要批准
    await approveTokenForSwap(wallet, usdtAddress, routerAddress, usdtAmount, 6);
    
    // 添加最终验证：确认余额和授权都足够
    console.log(`\n最终验证 - 准备添加流动性:`);
    console.log(`  需要 OKB: ${ethers.formatEther(okbAmount)}`);
    console.log(`  需要 USDT: ${ethers.formatUnits(usdtAmount, 6)}`);
    
    // 验证余额
    const finalOkbBalance = await wallet.provider!.getBalance(wallet.address);
    const usdtContract = new ethers.Contract(usdtAddress, ERC20_ABI, wallet);
    const finalUsdtBalance = await (usdtContract as any).balanceOf(wallet.address);
    
    console.log(`  实际 OKB余额: ${ethers.formatEther(finalOkbBalance)}`);
    console.log(`  实际 USDT余额: ${ethers.formatUnits(finalUsdtBalance, 6)}`);
    
    // 验证USDT授权
    const finalUsdtAllowance = await (usdtContract as any).allowance(wallet.address, routerAddress);
    console.log(`  USDT授权额度: ${ethers.formatUnits(finalUsdtAllowance, 6)}`);
    
    // 检查是否一切就绪
    if (finalOkbBalance < okbAmount) {
      throw new Error(`OKB余额不足: 需要${ethers.formatEther(okbAmount)}, 实际${ethers.formatEther(finalOkbBalance)}`);
    }
    if (finalUsdtBalance < usdtAmount) {
      throw new Error(`USDT余额不足: 需要${ethers.formatUnits(usdtAmount, 6)}, 实际${ethers.formatUnits(finalUsdtBalance, 6)}`);
    }
    // 检查USDT授权是否足够（需要获取总供应量进行比较）
    const usdtTotalSupply = await (usdtContract as any).totalSupply();
    if (finalUsdtAllowance < usdtAmount && finalUsdtAllowance < usdtTotalSupply / BigInt(2)) {
      throw new Error(`USDT授权不足: 需要${ethers.formatUnits(usdtAmount, 6)}, 实际${ethers.formatUnits(finalUsdtAllowance, 6)}`);
    }
    
    console.log(`✅ 所有检查通过，开始添加流动性...`);
    
    // 创建路由器合约实例
    const router = new ethers.Contract(routerAddress, ROUTER_ABI, wallet);
    
    // 使用极保守的滑点策略 - 至少5%的缓冲
    const conservativeSlippage = Math.max(config.slippageTolerance, 5); // 至少5%滑点保护
    const slippageMultiplier = BigInt(100 - conservativeSlippage);
    const usdtAmountMin = (usdtAmount * slippageMultiplier) / BigInt(100);
    const okbAmountMin = (okbAmount * slippageMultiplier) / BigInt(100);
    
    console.log(`⚠️  使用超保守滑点: ${conservativeSlippage}% (配置${config.slippageTolerance}%)`);
    console.log(`最小接收 USDT: ${ethers.formatUnits(usdtAmountMin, 6)}, OKB: ${ethers.formatEther(okbAmountMin)}`);
    
    // 设置截止时间为10分钟后
    const deadline = Math.floor(Date.now() / 1000) + 600;
    
    // 使用addLiquidityETH函数，OKB作为ETH发送
    const tx = await (router as any).addLiquidityETH(
      usdtAddress,
      usdtAmount,
      usdtAmountMin,
      okbAmountMin,
      wallet.address,
      deadline,
      { value: okbAmount } // OKB作为value发送
    );
    
    console.log(`添加流动性成功, 交易哈希: ${tx.hash}`);
    await tx.wait(); // 等待交易确认
    return tx.hash;
  });
}

// 主函数
async function main() {
  try {
    // 0. 验证配置
    console.log('验证配置...');
    validateConfig();
    
    // 1. 加载子钱包
    console.log('加载子钱包...');
    const subWallets = await loadSubWallets();
    
    // 2. 检查子钱包余额
    console.log('验证子钱包余额...');
    const balancesValid = await validateWalletBalances(subWallets);
    
    if (!balancesValid) {
      throw new Error('部分子钱包余额不足，请确保所有子钱包都有足够的OKB和USDT余额');
    }
    
    console.log('✅ 所有子钱包余额充足，可以开始添加流动性');
    
    // 4. 每个子钱包在PotatoSwap添加流动性
    console.log('\n开始添加流动性...');
    
    const liquidityPromises = [];
    const maxConcurrent = 3; // 限制并发数量以避免网络拥堵
    
    // 分批处理钱包以控制并发
    for (let i = 0; i < subWallets.length; i += maxConcurrent) {
      const batch = subWallets.slice(i, i + maxConcurrent);
      
      const batchPromises = batch.map(async (walletInfo, index) => {
        const globalIndex = i + index;
        
        try {
          console.log(`[钱包 ${globalIndex + 1}] 开始添加流动性...`);
          
          // routerContract 变量已移除，直接在 getPoolRatio 中创建
          
          // 获取流动池当前比例
          const poolRatio = await getPoolRatio(
            walletInfo.wallet,
            config.contracts.usdt
          );
          
          let okbAmount, usdtAmount;
          
          // 🚀 新策略：以USDT为基准，计算对应的WOKB数量
          // 使用配置的固定USDT投入量，应用安全缓冲区
          const targetUsdtAmount = config.usdtAmountPerLiquidity * (100 - config.safetyBuffer) / 100;
          usdtAmount = ethers.parseUnits(targetUsdtAmount.toString(), 6);
          
          // 🚀 使用DEX Router获取实时价格
          console.log(`[钱包 ${globalIndex + 1}] 🔍 获取DEX实时价格...`);
          
          // 尝试从DEX获取精确的OKB数量 
          const quotedOkbAmount = await getOkbAmountFromRouter(walletInfo.wallet, usdtAmount);
          
          if (quotedOkbAmount && quotedOkbAmount > 0) {
            console.log(`[钱包 ${globalIndex + 1}] ✅ 使用DEX实时价格`);
            okbAmount = quotedOkbAmount;
            
            const dexPrice = Number(ethers.formatUnits(usdtAmount, 6)) / Number(ethers.formatEther(okbAmount));
            console.log(`  📊 投入USDT: ${ethers.formatUnits(usdtAmount, 6)}`);
            console.log(`  ⚖️  需要OKB: ${ethers.formatEther(okbAmount)}`);
            console.log(`  💱 DEX实时价格: 1 OKB = ${dexPrice.toFixed(2)} USDT`);
            console.log(`  🔗 使用正确的WOKB地址: ${config.contracts.wokb}`);
            
          } else {
            console.log(`[钱包 ${globalIndex + 1}] ⚠️  DEX价格获取失败，使用参考价格`);
            // 备用方案：使用验证的价格比例
            const referencePrice = 168.44; // 基于成功交易0x79d24ee779fddd99f2d404ca06caacc1a37df075b04f4e9f4b8192c43ec6e902
            const okbNeeded = Number(ethers.formatUnits(usdtAmount, 6)) / referencePrice;
            okbAmount = ethers.parseEther(okbNeeded.toString());
            
            console.log(`  📊 投入USDT: ${ethers.formatUnits(usdtAmount, 6)}`);
            console.log(`  ⚖️  需要OKB: ${ethers.formatEther(okbAmount)}`);
            console.log(`  💱 参考价格: 1 OKB = ${referencePrice} USDT`);
            console.log(`  🔗 基于成功交易: 0x79d24ee779fddd99f2d404ca06caacc1a37df075b04f4e9f4b8192c43ec6e902`);
          }
          
          // 验证钱包余额是否足够
          const okbBalance = await walletInfo.wallet.provider!.getBalance(walletInfo.wallet.address);
          const usdtContract = new ethers.Contract(config.contracts.usdt, ERC20_ABI, walletInfo.wallet) as unknown as IERC20;
          const usdtBalance = await usdtContract.balanceOf(walletInfo.wallet.address);
          
          if (okbBalance < okbAmount) {
            throw new Error(`OKB余额不足: 需要 ${ethers.formatEther(okbAmount)}, 当前 ${ethers.formatEther(okbBalance)}`);
          }
          
          if (usdtBalance < usdtAmount) {
            throw new Error(`USDT余额不足: 需要 ${ethers.formatUnits(usdtAmount, 6)}, 当前 ${ethers.formatUnits(usdtBalance, 6)}`);
          }
          
          // 添加流动性 - 使用正确的addLiquidityETH函数
          const txHash = await addLiquidityETH(
            walletInfo.wallet,
            config.contracts.potatoSwapRouter,
            config.contracts.usdt,
            usdtAmount,
            okbAmount
          );
          
          console.log(`[钱包 ${globalIndex + 1}] 流动性添加成功，交易哈希: ${txHash}`);
          return { walletIndex: globalIndex, success: true, txHash };
          
        } catch (error) {
          console.error(`[钱包 ${globalIndex + 1}] 添加流动性失败:`, (error as Error).message);
          return { walletIndex: globalIndex, success: false, error: (error as Error).message };
        }
      });
      
      // 等待当前批次完成
      const batchResults = await Promise.allSettled(batchPromises);
      liquidityPromises.push(...batchResults);
      
      // 批次间添加延迟
      if (i + maxConcurrent < subWallets.length) {
        console.log('等待下一批次...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // 统计结果
    const successCount = liquidityPromises.filter(result => 
      result.status === 'fulfilled' && result.value.success
    ).length;
    
    console.log(`\n流动性添加完成: 成功 ${successCount}/${subWallets.length}`);
    
    console.log('\n所有操作完成!');
  } catch (error) {
    console.error('操作失败:', error);
  }
}

// 执行主函数
main();