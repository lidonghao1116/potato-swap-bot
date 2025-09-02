import { ethers } from 'ethers';
import { randomBytes } from 'crypto';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 从环境变量读取配置
const config = {
  // 主钱包私钥
  mainWalletPrivateKey: process.env.MAIN_WALLET_PRIVATE_KEY || '',
  // 要创建的子钱包数量
  numberOfWallets: parseInt(process.env.NUMBER_OF_WALLETS || '2'),
  // 每个子钱包分配的OKB数量
  okbPerWallet: parseFloat(process.env.OKB_PER_WALLET || '0.01'),
  // 每个子钱包分配的USDT数量
  usdtPerWallet: parseFloat(process.env.USDT_PER_WALLET || '3'),
  // 代币合约地址
  contracts: {
    // OKB是X Layer的原生代币，不需要合约地址
    usdt: process.env.USDT_CONTRACT || '0x1e4a5963abfd975d8c9021ce480b42188849d41d',
    potatoSwapRouter: process.env.POTATO_SWAP_ROUTER || '0x881fb2f98c13d521009464e7d1cbf16e1b394e8e'
  },
  // RPC节点和链信息
  rpcUrl: process.env.RPC_URL || 'https://rpc.xlayer.tech',
  chainId: parseInt(process.env.CHAIN_ID || '196')
};

// ERC20 ABI
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)"
];

// 创建提供者
const provider = new ethers.JsonRpcProvider(config.rpcUrl, {
  chainId: config.chainId,
  name: "X Layer"
});

// 定义钱包接口
interface Wallet {
  privateKey: string;
  address: string;
  wallet: ethers.Wallet;
}

let mainWallet: ethers.Wallet;

// 验证配置
function validateConfig() {
  const requiredFields = [
    { field: 'mainWalletPrivateKey', value: config.mainWalletPrivateKey },
    { field: 'contracts.usdt', value: config.contracts.usdt },
    { field: 'contracts.potatoSwapRouter', value: config.contracts.potatoSwapRouter }
  ];

  for (const { field, value } of requiredFields) {
    if (!value || value.includes('Your') || value.includes('Address')) {
      throw new Error(`请在.env文件中设置实际的 ${field} 地址，当前值: ${value}`);
    }
  }

  // 验证主钱包私钥格式
  if (!config.mainWalletPrivateKey.match(/^0x[0-9a-fA-F]{64}$/)) {
    throw new Error(`主钱包私钥格式不正确，应为64位十六进制字符串，以0x开头`);
  }

  console.log('✅ 配置验证通过');
}

// 初始化主钱包
function initializeMainWallet() {
  mainWallet = new ethers.Wallet(config.mainWalletPrivateKey, provider);
  console.log(`主钱包地址: ${mainWallet.address}`);
}

// 批量创建子钱包
async function createSubWallets(count: number): Promise<Wallet[]> {
  const wallets: Wallet[] = [];
  for (let i = 0; i < count; i++) {
    // 生成随机私钥
    const privateKey = ethers.hexlify(randomBytes(32));
    const wallet = new ethers.Wallet(privateKey, provider);
    
    wallets.push({
      privateKey,
      address: wallet.address,
      wallet
    });
    console.log(`创建子钱包 ${i + 1}: ${wallet.address}`);
    console.log(`私钥: ${wallet.privateKey}`);
  }
  return wallets;
}

// 转账原生代币 (OKB)
async function transferOKB(to: string, amount: number) {
  try {
    const tx = await mainWallet.sendTransaction({
      to,
      value: ethers.parseEther(amount.toString())
    });
    
    console.log(`转账 ${amount} OKB 到 ${to}, 交易哈希: ${tx.hash}`);
    await tx.wait(); // 等待交易确认
    return tx.hash;
  } catch (error) {
    console.error(`转账OKB到${to}失败:`, error);
    throw error;
  }
}

// 转账ERC20代币 (USDT)
async function transferERC20(contractAddress: string, to: string, amount: number, decimals: number = 18) {
  try {
    // 创建合约实例
    const contract = new ethers.Contract(contractAddress, ERC20_ABI, mainWallet);
    
    // 计算转账金额（考虑小数位）
    const value = ethers.parseUnits(amount.toString(), decimals);
    
    const tx = await (contract as any).transfer(to, value);
    
    console.log(`转账 ${amount} 代币到 ${to}, 交易哈希: ${tx.hash}`);
    await tx.wait(); // 等待交易确认
    return tx.hash;
  } catch (error) {
    console.error(`转账ERC20到${to}失败:`, error);
    throw error;
  }
}

// 检查主钱包余额
async function checkMainWalletBalance(): Promise<boolean> {
  console.log('\n检查主钱包余额...');
  
  try {
    // 检查OKB余额
    const okbBalance = await mainWallet.provider!.getBalance(mainWallet.address);
    const requiredOkb = ethers.parseEther((config.okbPerWallet * config.numberOfWallets).toString());
    
    // 检查USDT余额
    const usdtContract = new ethers.Contract(config.contracts.usdt, ERC20_ABI, mainWallet);
    const usdtBalance = await (usdtContract as any).balanceOf(mainWallet.address);
    const requiredUsdt = ethers.parseUnits((config.usdtPerWallet * config.numberOfWallets).toString(), 6);

    const okbBalanceFormatted = ethers.formatEther(okbBalance);
    const usdtBalanceFormatted = ethers.formatUnits(usdtBalance, 6);

    console.log(`主钱包 (${mainWallet.address}):`);
    console.log(`  OKB: ${okbBalanceFormatted} (需要: ${config.okbPerWallet * config.numberOfWallets})`);
    console.log(`  USDT: ${usdtBalanceFormatted} (需要: ${config.usdtPerWallet * config.numberOfWallets})`);

    const okbSufficient = okbBalance >= requiredOkb;
    const usdtSufficient = usdtBalance >= requiredUsdt;

    if (!okbSufficient) {
      console.log(`  ❌ OKB余额不足`);
      return false;
    } else {
      console.log(`  ✅ OKB余额充足`);
    }

    if (!usdtSufficient) {
      console.log(`  ❌ USDT余额不足`);
      return false;
    } else {
      console.log(`  ✅ USDT余额充足`);
    }

    return true;
  } catch (error) {
    console.error('主钱包余额检查失败:', (error as Error).message);
    return false;
  }
}

// 主函数
async function main() {
  try {
    // 0. 验证配置
    console.log('验证配置...');
    validateConfig();
    
    // 1. 初始化主钱包
    console.log('初始化主钱包...');
    initializeMainWallet();
    
    // 2. 检查主钱包余额
    console.log('检查主钱包余额...');
    const balanceValid = await checkMainWalletBalance();
    
    if (!balanceValid) {
      throw new Error('主钱包余额不足，请确保有足够的OKB和USDT余额');
    }
    
    // 3. 批量创建子钱包
    console.log('\n开始创建子钱包...');
    const subWallets = await createSubWallets(config.numberOfWallets);
    
    // 4. 向每个子钱包分发OKB和USDT
    console.log('\n开始分发代币...');
    for (const wallet of subWallets) {
      // 转账OKB
      await transferOKB(wallet.address, config.okbPerWallet);
      
      // 转账USDT (假设USDT是6位小数)
      await transferERC20(config.contracts.usdt, wallet.address, config.usdtPerWallet, 6);
      
      // 等待一下，避免交易拥堵
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    console.log('\n✅ 所有操作完成!');
    console.log('\n📋 子钱包信息汇总:');
    subWallets.forEach((wallet, index) => {
      console.log(`钱包 ${index + 1}:`);
      console.log(`  地址: ${wallet.address}`);
      console.log(`  私钥: ${wallet.privateKey}`);
    });
    
  } catch (error) {
    console.error('操作失败:', error);
  }
}

// 执行主函数
main();