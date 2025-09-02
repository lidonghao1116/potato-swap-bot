import { ethers } from 'ethers';
import axios from 'axios';
import winston from 'winston';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// ES模块路径解析
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载环境变量
dotenv.config();

// 配置日志
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}] ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ 
      filename: path.join(__dirname, 'logs', 'sign-agreement.log'),
      level: 'info'
    })
  ],
});

// API 配置
const SIGN_API_URL = 'https://api.potatoswap.finance/v1/agreement/sign';
const CHECK_API_URL = 'https://api.potatoswap.finance/v1/agreement/signed';

// 限流和重试配置
const REQUEST_RETRY_ATTEMPTS = 3;
const REQUEST_RETRY_DELAY = 3000; // 3秒
const WALLET_PROCESSING_DELAY = 5000; // 钱包间隔5秒
const VALIDATION_DELAY = 3000; // 验证等待3秒

// PotatoSwap 协议签名消息 (明文格式)
const SIGN_MESSAGE = `By accessing or using Interface (as defined in the Terms of Use) at https://potatoswap.finance/terms-of-service, I agree to be bound by the Terms of Use (https://potatoswap.finance/terms-of-service), the risks involved and confirm further that I have read and fully understood the Privacy Policy (https://potatoswap.finance/privacy-policy) .

    I hereby further represent and warrant that:

    I'm not a national of the United States of America, nor a resident of or located in the United States of America (including its territories: American Samoa, Guam, Puerto Rico, the Northern Mariana Islands and the U.S. Virgin Islands）, People's Republic of China (excluding the Hong Kong Special Administrative Region, Macau Special Administrative Region, and Taiwan), or any other Restricted Territory (as defined in the Terms of Service);

    I'm not a Sanctions List Person (as defined in the Terms of Use) nor acting on behalf of a Sanctions List Person;

    I acknowledge that my use of the PotatoSwap Interface has risks, including the disruption, suspension, inaccessibility of the functions on the Interface, that the PotatoSwap Interface and related platform, applications and software are experimental, and the use of experimental software may result in complete loss of my assets and funds.`;

// 重试包装函数
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxAttempts: number = REQUEST_RETRY_ATTEMPTS
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await operation();
      if (attempt > 1) {
        logger.info(`✅ ${operationName} 在第 ${attempt} 次尝试成功`);
      }
      return result;
    } catch (error: any) {
      const isLastAttempt = attempt === maxAttempts;
      const is502Error = error.response?.status === 502;
      const shouldRetry = is502Error && !isLastAttempt;
      
      if (shouldRetry) {
        logger.warn(`⚠️  ${operationName} 第 ${attempt} 次失败 (502错误), 将在 ${REQUEST_RETRY_DELAY/1000} 秒后重试...`);
        await new Promise(resolve => setTimeout(resolve, REQUEST_RETRY_DELAY));
      } else {
        if (isLastAttempt) {
          logger.error(`❌ ${operationName} 在 ${maxAttempts} 次尝试后最终失败: ${error.message}`);
        }
        throw error;
      }
    }
  }
  
  throw new Error(`Unreachable code: ${operationName} retries exhausted`);
}

// 检查钱包是否已签名
async function checkSignedStatus(address: string): Promise<boolean> {
  logger.info(`检查钱包 ${address} 的签名状态...`);
  
  try {
    const response = await withRetry(
      () => axios.get(`${CHECK_API_URL}?addr=${address}`),
      `检查钱包 ${address} 签名状态`
    );
    
    logger.info(`签名状态检查响应: ${JSON.stringify(response.data)}`);
    
    if (response.data.code === 0) {
      return response.data.data.signed === true;
    } else {
      logger.error(`检查签名状态失败: ${response.data.msg}`);
      return false;
    }
  } catch (error) {
    logger.error(`检查签名状态最终失败，假设未签名继续处理`);
    return false; // 默认假设未签名，让脚本继续执行
  }
}

// 执行钱包签名
async function signMessage(privateKey: string): Promise<{ address: string; signature: string } | null> {
  try {
    // 创建钱包实例
    const wallet = new ethers.Wallet(privateKey);
    const address = wallet.address;
    
    logger.info(`开始为钱包 ${address} 签名消息...`);
    logger.info(`消息内容 (前200字符): ${SIGN_MESSAGE.substring(0, 200)}...`);
    
    // 使用 personal_sign 方法签名明文消息
    const signature = await wallet.signMessage(SIGN_MESSAGE);
    
    logger.info(`钱包 ${address} 签名成功: ${signature}`);
    
    return { address, signature };
  } catch (error) {
    logger.error(`签名过程中发生错误: ${error}`);
    return null;
  }
}

// 提交签名到 API
async function submitSignature(address: string, signature: string): Promise<boolean> {
  logger.info(`向 PotatoSwap 提交钱包 ${address} 的签名...`);
  
  const payload = {
    addr: address,
    message: SIGN_MESSAGE,
    sign: signature
  };
  
  logger.info(`请求载荷: ${JSON.stringify({ ...payload, message: payload.message.substring(0, 100) + '...' })}`);
  
  try {
    const response = await withRetry(
      () => axios.post(SIGN_API_URL, payload, {
        headers: {
          'Content-Type': 'application/json'
        }
      }),
      `提交钱包 ${address} 签名`
    );
    
    logger.info(`API 响应: ${JSON.stringify(response.data)}`);
    
    if (response.data.code === 0 && response.data.data.success === true) {
      logger.info(`✅ 钱包 ${address} 签名提交成功！`);
      return true;
    } else {
      logger.error(`❌ 钱包 ${address} 签名提交失败: ${response.data.msg}`);
      return false;
    }
  } catch (error) {
    logger.error(`钱包 ${address} 签名提交最终失败`);
    return false;
  }
}

// 处理单个钱包的完整流程
async function processWallet(privateKey: string): Promise<boolean> {
  try {
    // 1. 生成钱包地址
    const wallet = new ethers.Wallet(privateKey);
    const address = wallet.address;
    
    logger.info(`\n=== 开始处理钱包: ${address} ===`);
    
    // 2. 检查是否已签名
    const alreadySigned = await checkSignedStatus(address);
    if (alreadySigned) {
      logger.info(`✅ 钱包 ${address} 已经签名过了，跳过处理`);
      return true;
    }
    
    // 3. 执行签名
    const signResult = await signMessage(privateKey);
    if (!signResult) {
      logger.error(`❌ 钱包 ${address} 签名失败`);
      return false;
    }
    
    // 4. 提交签名
    const submitSuccess = await submitSignature(signResult.address, signResult.signature);
    if (!submitSuccess) {
      logger.error(`❌ 钱包 ${address} 签名提交失败`);
      return false;
    }
    
    // 5. 验证签名状态
    logger.info(`等待${VALIDATION_DELAY/1000}秒后验证签名状态...`);
    await new Promise(resolve => setTimeout(resolve, VALIDATION_DELAY));
    
    const finalStatus = await checkSignedStatus(address);
    if (finalStatus) {
      logger.info(`✅ 钱包 ${address} 签名验证成功！`);
      return true;
    } else {
      logger.error(`❌ 钱包 ${address} 签名验证失败`);
      return false;
    }
    
  } catch (error) {
    logger.error(`处理钱包时发生未预期错误: ${error}`);
    return false;
  }
}

// 主函数
async function main() {
  try {
    // 创建日志目录
    const logsDir = path.join(__dirname, 'logs');
    await import('fs/promises').then(fs => fs.mkdir(logsDir, { recursive: true }));
    
    logger.info('🚀 开始执行 PotatoSwap 协议签名脚本...');
    logger.info(`签名消息长度: ${SIGN_MESSAGE.length} 字符`);
    
    // 从环境变量获取子钱包私钥
    const subWalletKeys = process.env.SUB_WALLET_PRIVATE_KEYS;
    if (!subWalletKeys) {
      logger.error('❌ 未找到 SUB_WALLET_PRIVATE_KEYS 环境变量');
      process.exit(1);
    }
    
    // 解析私钥列表
    const privateKeys = subWalletKeys.split(',').map(key => key.trim()).filter(key => key);
    logger.info(`📝 找到 ${privateKeys.length} 个钱包私钥`);
    
    // 处理每个钱包
    let successCount = 0;
    let failureCount = 0;
    
    for (let i = 0; i < privateKeys.length; i++) {
      const privateKey = privateKeys[i];
      logger.info(`\n📍 处理第 ${i + 1}/${privateKeys.length} 个钱包...`);
      
      const success = await processWallet(privateKey);
      if (success) {
        successCount++;
      } else {
        failureCount++;
      }
      
      // 钱包之间间隔防止限流
      if (i < privateKeys.length - 1) {
        logger.info(`等待${WALLET_PROCESSING_DELAY/1000}秒后处理下一个钱包...`);
        await new Promise(resolve => setTimeout(resolve, WALLET_PROCESSING_DELAY));
      }
    }
    
    // 输出最终结果
    logger.info(`\n🎯 执行完成！`);
    logger.info(`✅ 成功: ${successCount} 个钱包`);
    logger.info(`❌ 失败: ${failureCount} 个钱包`);
    logger.info(`📊 总计: ${privateKeys.length} 个钱包`);
    
    if (failureCount > 0) {
      logger.warn('⚠️  部分钱包处理失败，请检查日志文件');
      process.exit(1);
    } else {
      logger.info('🎉 所有钱包均处理成功！');
      process.exit(0);
    }
    
  } catch (error) {
    logger.error(`主程序执行错误: ${error}`);
    process.exit(1);
  }
}

// 运行主函数
main().catch((error) => {
  console.error('程序异常退出:', error);
  process.exit(1);
});