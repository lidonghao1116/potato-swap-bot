// INSUFFICIENT_A_AMOUNT 错误解决方案
const { ethers } = require('ethers');

class LiquidityFixer {
    constructor(provider, routerAddress, tokenAddress) {
        this.provider = provider;
        this.routerAddress = routerAddress;
        this.tokenAddress = tokenAddress;
    }

    // 1. 检查用户余额和授权
    async checkBalanceAndAllowance(userAddress, tokenAmountDesired) {
        const tokenContract = new ethers.Contract(
            this.tokenAddress,
            ['function balanceOf(address) view returns (uint256)',
             'function allowance(address,address) view returns (uint256)'],
            this.provider
        );

        const balance = await tokenContract.balanceOf(userAddress);
        const allowance = await tokenContract.allowance(userAddress, this.routerAddress);

        console.log(`用户余额: ${ethers.utils.formatEther(balance)}`);
        console.log(`授权额度: ${ethers.utils.formatEther(allowance)}`);
        console.log(`需要数量: ${ethers.utils.formatEther(tokenAmountDesired)}`);

        return {
            hasEnoughBalance: balance.gte(tokenAmountDesired),
            hasEnoughAllowance: allowance.gte(tokenAmountDesired),
            balance,
            allowance
        };
    }

    // 2. 修复授权问题
    async fixAllowance(signer, tokenAmountDesired) {
        const tokenContract = new ethers.Contract(
            this.tokenAddress,
            ['function approve(address,uint256) returns (bool)'],
            signer
        );

        console.log('修复授权中...');
        const tx = await tokenContract.approve(this.routerAddress, tokenAmountDesired);
        await tx.wait();
        console.log(`授权成功: ${tx.hash}`);
        return tx;
    }

    // 3. 获取最优流动性比率
    async getOptimalAmounts(ethAmount, tokenAmountDesired) {
        const routerContract = new ethers.Contract(
            this.routerAddress,
            ['function quote(uint256,uint256,uint256) view returns (uint256)'],
            this.provider
        );

        try {
            // 基于ETH数量计算需要的token数量
            const optimalTokenAmount = await routerContract.quote(
                ethAmount,
                ethers.utils.parseEther("1"), // 假设ETH储备
                tokenAmountDesired // 假设token储备
            );

            return {
                tokenAmount: optimalTokenAmount,
                ethAmount: ethAmount
            };
        } catch (error) {
            console.log('获取最优比率失败，使用用户指定数量');
            return {
                tokenAmount: tokenAmountDesired,
                ethAmount: ethAmount
            };
        }
    }

    // 4. 安全添加流动性
    async addLiquiditySafely(signer, tokenAmountDesired, ethAmountDesired, slippageTolerance = 5) {
        const userAddress = await signer.getAddress();
        
        // 步骤1: 检查余额和授权
        const check = await this.checkBalanceAndAllowance(userAddress, tokenAmountDesired);
        
        if (!check.hasEnoughBalance) {
            throw new Error(`余额不足！当前: ${ethers.utils.formatEther(check.balance)}, 需要: ${ethers.utils.formatEther(tokenAmountDesired)}`);
        }

        if (!check.hasEnoughAllowance) {
            await this.fixAllowance(signer, tokenAmountDesired);
        }

        // 步骤2: 计算滑点保护参数
        const slippageMultiplier = (100 - slippageTolerance) / 100;
        const tokenAmountMin = tokenAmountDesired.mul(Math.floor(slippageMultiplier * 100)).div(100);
        const ethAmountMin = ethAmountDesired.mul(Math.floor(slippageMultiplier * 100)).div(100);

        // 步骤3: 设置deadline (5分钟后)
        const deadline = Math.floor(Date.now() / 1000) + 300;

        // 步骤4: 执行添加流动性
        const routerContract = new ethers.Contract(
            this.routerAddress,
            ['function addLiquidityETH(address,uint256,uint256,uint256,address,uint256) payable returns (uint256,uint256,uint256)'],
            signer
        );

        console.log('添加流动性参数:');
        console.log(`Token地址: ${this.tokenAddress}`);
        console.log(`Token期望数量: ${ethers.utils.formatEther(tokenAmountDesired)}`);
        console.log(`Token最小数量: ${ethers.utils.formatEther(tokenAmountMin)}`);
        console.log(`ETH最小数量: ${ethers.utils.formatEther(ethAmountMin)}`);
        console.log(`ETH发送数量: ${ethers.utils.formatEther(ethAmountDesired)}`);

        const tx = await routerContract.addLiquidityETH(
            this.tokenAddress,
            tokenAmountDesired,
            tokenAmountMin,
            ethAmountMin,
            userAddress,
            deadline,
            { value: ethAmountDesired }
        );

        console.log(`交易提交: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`交易确认: ${receipt.transactionHash}`);
        
        return receipt;
    }
}

// 使用示例
async function fixInsufficientAmountError() {
    // 配置
    const provider = new ethers.providers.JsonRpcProvider('X_LAYER_RPC_URL');
    const wallet = new ethers.Wallet('YOUR_PRIVATE_KEY', provider);
    const routerAddress = '0xYOUR_ROUTER_ADDRESS';
    const tokenAddress = '0x1e4a5963abfd975d8c9021ce480b42188849d41d'; // 从正常交易中获取

    const fixer = new LiquidityFixer(provider, routerAddress, tokenAddress);

    try {
        const result = await fixer.addLiquiditySafely(
            wallet,
            ethers.utils.parseEther('100'), // token数量
            ethers.utils.parseEther('0.59'), // ETH数量
            5 // 5%滑点容忍度
        );
        
        console.log('✅ 流动性添加成功!');
        console.log(`交易哈希: ${result.transactionHash}`);
        
    } catch (error) {
        console.error('❌ 错误:', error.message);
        
        // 根据错误类型给出具体建议
        if (error.message.includes('余额不足')) {
            console.log('💡 建议: 增加token余额或降低添加数量');
        } else if (error.message.includes('INSUFFICIENT_A_AMOUNT')) {
            console.log('💡 建议: 增加滑点容忍度或稍后重试');
        }
    }
}

module.exports = { LiquidityFixer, fixInsufficientAmountError };