#!/usr/bin/env node
/**
 * X Layer 交易解析脚本
 * 用于分析添加流动性交易的详细信息
 */

import { ethers } from 'ethers';

// X Layer RPC配置
const provider = new ethers.JsonRpcProvider('https://rpc.xlayer.tech', {
  chainId: 196,
  name: "X Layer"
});

// UniswapV2 Router ABI (addLiquidityETH函数)
const ROUTER_ABI = [
  "function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)"
];

// ERC20 ABI (获取代币信息)
const ERC20_ABI = [
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)"
];

/**
 * 解析交易input data
 */
function parseTransactionData(data) {
  try {
    const iface = new ethers.Interface(ROUTER_ABI);
    const decoded = iface.parseTransaction({ data });
    return {
      functionName: decoded.name,
      args: decoded.args
    };
  } catch (error) {
    console.log('❌ 无法解析交易数据:', error.message);
    return null;
  }
}

/**
 * 获取代币信息
 */
async function getTokenInfo(tokenAddress) {
  try {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const [name, symbol, decimals] = await Promise.all([
      tokenContract.name(),
      tokenContract.symbol(),
      tokenContract.decimals()
    ]);
    return { name, symbol, decimals };
  } catch (error) {
    console.log(`⚠️  无法获取代币信息 ${tokenAddress}:`, error.message);
    return { name: 'Unknown', symbol: 'UNKNOWN', decimals: 18 };
  }
}

/**
 * 格式化金额显示
 */
function formatAmount(amount, decimals, symbol = '') {
  const formatted = ethers.formatUnits(amount, decimals);
  return `${formatted} ${symbol}`;
}

/**
 * 分析交易详情
 */
async function analyzeTx(txHash) {
  try {
    console.log(`🔍 正在分析交易: ${txHash}\n`);
    
    // 获取交易详情
    const tx = await provider.getTransaction(txHash);
    if (!tx) {
      throw new Error('交易未找到');
    }
    
    console.log('📋 基本信息:');
    console.log(`  交易哈希: ${tx.hash}`);
    console.log(`  区块号: ${tx.blockNumber || '待确认'}`);
    console.log(`  发送者: ${tx.from}`);
    console.log(`  接收者: ${tx.to}`);
    console.log(`  ETH值: ${ethers.formatEther(tx.value)} OKB`);
    console.log(`  Gas限制: ${tx.gasLimit.toString()}`);
    console.log(`  Gas价格: ${ethers.formatUnits(tx.gasPrice, 'gwei')} Gwei`);
    
    // 获取交易收据
    let receipt = null;
    try {
      receipt = await provider.getTransactionReceipt(txHash);
      if (receipt) {
        console.log(`  Gas使用: ${receipt.gasUsed.toString()} (${(Number(receipt.gasUsed) / Number(tx.gasLimit) * 100).toFixed(1)}%)`);
        console.log(`  交易状态: ${receipt.status === 1 ? '✅ 成功' : '❌ 失败'}`);
      }
    } catch (error) {
      console.log('  交易状态: ⏳ 待确认');
    }
    
    console.log('\n📊 交易数据解析:');
    
    // 解析交易数据
    const parsed = parseTransactionData(tx.data);
    if (!parsed) {
      console.log('❌ 无法解析交易数据');
      return;
    }
    
    console.log(`  函数: ${parsed.functionName}`);
    
    if (parsed.functionName === 'addLiquidityETH') {
      const [token, amountTokenDesired, amountTokenMin, amountETHMin, to, deadline] = parsed.args;
      
      // 获取代币信息
      console.log('\n🪙 代币信息:');
      const tokenInfo = await getTokenInfo(token);
      console.log(`  代币地址: ${token}`);
      console.log(`  代币名称: ${tokenInfo.name}`);
      console.log(`  代币符号: ${tokenInfo.symbol}`);
      console.log(`  代币精度: ${tokenInfo.decimals}`);
      
      console.log('\n💰 流动性参数:');
      console.log(`  期望代币数量: ${formatAmount(amountTokenDesired, tokenInfo.decimals, tokenInfo.symbol)}`);
      console.log(`  最小代币数量: ${formatAmount(amountTokenMin, tokenInfo.decimals, tokenInfo.symbol)}`);
      console.log(`  发送OKB数量: ${ethers.formatEther(tx.value)} OKB`);
      console.log(`  最小OKB数量: ${ethers.formatEther(amountETHMin)} OKB`);
      console.log(`  接收地址: ${to}`);
      console.log(`  截止时间: ${new Date(Number(deadline) * 1000).toLocaleString()}`);
      
      // 计算滑点保护
      const tokenSlippage = ((Number(amountTokenDesired) - Number(amountTokenMin)) / Number(amountTokenDesired) * 100).toFixed(2);
      const ethSlippage = ((Number(tx.value) - Number(amountETHMin)) / Number(tx.value) * 100).toFixed(2);
      
      console.log('\n📈 滑点分析:');
      console.log(`  ${tokenInfo.symbol}滑点保护: ${tokenSlippage}%`);
      console.log(`  OKB滑点保护: ${ethSlippage}%`);
      
      // 计算价格比例
      const tokenAmount = Number(ethers.formatUnits(amountTokenDesired, tokenInfo.decimals));
      const ethAmount = Number(ethers.formatEther(tx.value));
      const priceRatio = tokenAmount / ethAmount;
      
      console.log('\n💱 价格比例:');
      console.log(`  1 OKB = ${priceRatio.toFixed(2)} ${tokenInfo.symbol}`);
      console.log(`  1 ${tokenInfo.symbol} = ${(1 / priceRatio).toFixed(6)} OKB`);
      
      // 分析交易收据中的事件
      if (receipt && receipt.logs.length > 0) {
        console.log('\n📝 交易日志:');
        console.log(`  产生了 ${receipt.logs.length} 个事件日志`);
        
        // 查找Mint事件 (添加流动性)
        receipt.logs.forEach((log, index) => {
          console.log(`  日志 ${index + 1}:`);
          console.log(`    合约: ${log.address}`);
          console.log(`    主题数: ${log.topics.length}`);
          console.log(`    数据长度: ${log.data.length}`);
        });
      }
    }
    
    // 原始数据
    console.log('\n📄 原始数据:');
    console.log(`  Input Data: ${tx.data}`);
    console.log(`  Data长度: ${tx.data.length} 字符`);
    
  } catch (error) {
    console.error('❌ 分析失败:', error.message);
    if (error.code === 'NETWORK_ERROR') {
      console.log('💡 建议: 检查网络连接或使用不同的RPC端点');
    }
  }
}

// 主函数
async function main() {
  const txHash = process.argv[2] || '0x79d24ee779fddd99f2d404ca06caacc1a37df075b04f4e9f4b8192c43ec6e902';
  
  console.log('🚀 X Layer 交易分析工具\n');
  console.log(`🌐 RPC: https://rpc.xlayer.tech`);
  console.log(`⛓️  链ID: 196\n`);
  
  await analyzeTx(txHash);
}

// 处理未捕获的Promise错误
process.on('unhandledRejection', (error) => {
  console.error('❌ 未处理的错误:', error.message);
  process.exit(1);
});

// 运行主函数
main().catch(console.error);

export { analyzeTx, parseTransactionData, getTokenInfo };