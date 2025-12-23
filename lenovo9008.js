// bot.js (合并为单命令版本，新增 OTA 增量包查询)

// 导入依赖
require('dotenv').config();
const { Telegraf } = require('telegraf');
const fetch = require('node-fetch').default; 

// --- 日志辅助函数 (添加时间戳) ---

/**
 * 获取当前时间并格式化为 [YYYY-MM-DD HH:MM:SS]
 */
function getTimestamp() {
    const now = new Date();
    // 使用 ISO 格式简化，并移除毫秒部分
    const isoString = now.toISOString().replace('T', ' ').substring(0, 19);
    return `[${isoString}]`;
}

/**
 * 带有时间戳的日志输出
 */
function log(...args) {
    console.log(getTimestamp(), ...args);
}

/**
 * 带有时间戳的错误输出
 */
function error(...args) {
    console.error(getTimestamp(), ...args);
}

// --- 配置 ---
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    error("FATAL: BOT_TOKEN is not set in the .env file.");
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// 联想 API 地址
const API_URL_INFO = 'https://ptstpd.lenovo.com.cn/home/ConfigurationQuery/getMachineSequenceInfo?MachineNo=';
const API_URL_FLASH = 'https://ptstpd.lenovo.com.cn/home/ConfigurationQuery/getPadFlashingMachine';
const API_URL_OTA_BASE = 'https://ota.lenovo.com/engine/upgrade';

// --- Markdown 转义辅助函数 (防止 Telegram 解析错误) ---

/**
 * 转义 MarkdownV2 模式下的所有特殊字符。
 * @param {string} text 要转义的文本。
 * @returns {string} 转义后的文本。
 */
function escapeMarkdownV2(text) {
    if (text === null || text === undefined || text === '') return 'N/A';
    // 匹配 MarkdownV2 需要转义的字符：\_*[]()~`>#+-=|{}.!
    // 注意：这里的转义是针对最终输出到 Telegram 的消息内容。
    const escapeChars = /([\_*\[\]\(\)\~`>#+\-=|{}.!])/g;
    return String(text).replace(escapeChars, '\\$1');
}

// --- Bot 命令处理器 ---

bot.start((ctx) => {
    log(`[BOT START] Bot received /start command from user ${ctx.from.id}.`);
    ctx.reply(
        '欢迎使用联想刷机包查询Bot！\n' +
        '请发送 `/query 序列号 [当前固件版本]` 进行查询。\n\n' +
        '例如：\n' +
        '1\\. **查询完整包：** `/query HA29117A`\n' +
        '2\\. **查询增量包：** `/query HA29117A TB710FU\\_CN\\_OPEN\\_USER\\_QSM8650\\_V\\_ZUI\\_17\\.0\\.04\\.279\\_ST\\_250808`'
        , { parse_mode: 'MarkdownV2' }
    );
});


// 完整两步查询 (可选第三步 OTA): /query <SN> [CurrentFirmwareVersion]
bot.command('query', async (ctx) => {
    const userId = ctx.from.id;
    const fullCommand = ctx.message.text;
    log(`--- New Full Query ---`);
    log(`[QUERY] User ${userId} requested: ${fullCommand}`);
    
    const text = fullCommand.split(/\s+/);
    if (text.length < 2) {
        // 修复点 1：移除多余的 \\
        return ctx.reply('⚠️ 请提供序列号。格式: `/query 序列号 [当前固件版本]`', { parse_mode: 'MarkdownV2' });
    }
    
    // 提取原始参数，不带转义
    const sn = text[1].trim().toUpperCase();
    const currentFirmwareVersion = text[2] ? text[2].trim() : null;

    // 在发送第一个回复时，确保 SN 是转义的
    await ctx.reply(`🔍 正在执行完整查询 SN: **${escapeMarkdownV2(sn)}**\\.\\.\\.`, { parse_mode: 'MarkdownV2' });

    try {
        // 1. 获取机器信息 (包含 MTM)
        const machineInfo = await getMachineMTM(sn);

        if (!machineInfo || !machineInfo.MTM) { 
            error(`[QUERY FAIL] SN ${sn}: Failed to find MTM or machine info.`);
            // 修复点 2：移除多余的 \\
            return ctx.reply(`❌ 抱歉，未能查询到序列号 **${escapeMarkdownV2(sn)}** 对应的产品型号 \\(MTM\\) 信息。`, { parse_mode: 'MarkdownV2' });
        }
        
        const mtm = machineInfo.MTM;
        log(`[QUERY STEP 1 SUCCESS] SN ${sn} successfully retrieved MTM: ${mtm}`);

        // 2. 根据 MTM 查询完整刷机包数据
        const flashData = await getFlashData(mtm);

        if (flashData.length === 0) {
            error(`[QUERY FAIL] MTM ${mtm}: No flash package found.`);
            // 修复点 3：移除多余的 \\
            return ctx.reply(`❌ 根据 MTM **${escapeMarkdownV2(mtm)}** 未找到可用的完整刷机包下载链接。`, { parse_mode: 'MarkdownV2' });
        }

        // 假设只需要第一个完整包结果
        const fullPackageData = flashData[0]; 
        log(`[QUERY STEP 2 SUCCESS] MTM ${mtm} found full package URL: ${fullPackageData.download_url}`);
        
        // 3. (可选) 查询 OTA 增量包
        let otaResult = null;
        if (currentFirmwareVersion) {
            await ctx.reply(`⚙️ 正在执行第 3 步：查询增量包\\.\\.\\.`, { parse_mode: 'MarkdownV2' });
            // 使用 ProductModel（例如 TB710FU）和 SN 来查询 OTA
            otaResult = await getOtaDownloadUrl(
                sn, 
                machineInfo.ProductModel, 
                currentFirmwareVersion
            );
            
            if (otaResult) {
                log(`[QUERY STEP 3 SUCCESS] OTA update found: ${otaResult.url}`);
            } else {
                log(`[QUERY STEP 3] No OTA update found from version ${currentFirmwareVersion}.`);
            }
        }
        
        // --- 应用转义和数据提取 ---
        
        // API 1 字段 (Machine Info)
        const escapedSn = escapeMarkdownV2(sn);
        // MTM 也要转义，以防其中包含特殊字符
        const escapedMtm = escapeMarkdownV2(mtm); 
        const machineName = escapeMarkdownV2(machineInfo.MachineName);
        const productDate = escapeMarkdownV2(machineInfo.ProductDate);
        const scanDate = escapeMarkdownV2(machineInfo.ScanDate);
        const saleArea = escapeMarkdownV2(machineInfo.SaleArea);
        const productModel = escapeMarkdownV2(machineInfo.ProductModel);
        const productSeries = escapeMarkdownV2(machineInfo.ProductSeries);
        const productSmallClass = escapeMarkdownV2(machineInfo.ProductSmallClass);
        const productBigClass = escapeMarkdownV2(machineInfo.ProductBigClass);

        // API 2 字段 (Flash Data)
        const productName = escapeMarkdownV2(fullPackageData.product_name);
        const latestVersion = escapeMarkdownV2(fullPackageData.latest_version);
        const platform = escapeMarkdownV2(fullPackageData.platform);
        const flashingMethod = escapeMarkdownV2(fullPackageData.flashing_machine_method);
        const downloadUrlText = escapeMarkdownV2(fullPackageData.download_url);
        
        // 3. 构造并发送结果消息
        let message = `
**✅ 完整查询成功\\!**
\\-\\-\\-\\-\\-
**产品信息**
**序列号:** ${escapedSn}
**产品型号 \\(MTM\\):** ${escapedMtm}
**机器名称:** ${machineName}
**出厂日期:** ${productDate}
**扫描日期:** ${scanDate}
**销售区域:** ${saleArea}
**产品系列:** ${productSeries}
**产品大类:** ${productBigClass}
**产品小类:** ${productSmallClass}

\\-\\-\\-\\-\\-
**完整包固件信息**
**固件版本:** ${latestVersion}
**平台:** ${platform}
**产品名称:** ${productName}
**📥 下载链接:** [${downloadUrlText}](${fullPackageData.download_url || '#'})
\\-\\-\\-\\-\\-
**⚠️ 刷机方法:**
${flashingMethod}
`;
        
        // 追加 OTA 结果
        if (currentFirmwareVersion) {
            // 对用户输入的版本号进行转义
            const escapedCurVersion = escapeMarkdownV2(currentFirmwareVersion);
            
            message += `
\\-\\-\\-\\-\\-
**增量包 \\(OTA\\) 信息**
**当前版本:** ${escapedCurVersion}
`;

            if (otaResult) {
                const otaUrlText = escapeMarkdownV2(otaResult.url);
                const otaTargetVersion = escapeMarkdownV2(otaResult.version);
                
                message += `
**目标版本:** ${otaTargetVersion}
**📥 增量包链接:** [${otaUrlText}](${otaResult.url || '#'})
`;
            } else {
                message += `
**查询结果:** 未发现从版本 ${escapedCurVersion} 可用的增量更新包。
`;
            }
        }
        
        await ctx.reply(message, { parse_mode: 'MarkdownV2' });
        log(`[QUERY FINISH] SN ${sn}: Result sent to user ${userId}.`);

    } catch (error) {
        error(`[QUERY ERROR] SN ${sn} encountered an error: ${error.message}`);
        // 修复点 4：移除多余的 \\
        await ctx.reply(`系统发生错误，查询失败。错误信息: \`${escapeMarkdownV2(error.message)}\``, { parse_mode: 'MarkdownV2' });
    }
});

// --- API 请求函数 ---

/**
 * 步骤 1: 根据 SN 获取 MTM (使用 GET 请求)
 * 返回完整的机器信息对象
 */
async function getMachineMTM(sn) {
    const url = `${API_URL_INFO}${sn}`;
    log(`[API 1 REQUEST] GET ${url}`);

    const response = await fetch(url, {
        method: 'GET',
    });

    if (!response.ok) {
        error(`[API 1 ERROR] HTTP Status: ${response.status}`);
        throw new Error(`设备信息查询失败，HTTP状态码: ${response.status}`);
    }

    const result = await response.json();
    log(`[API 1 RESPONSE] Status: ${result.StatusCode}, Message: ${result.Message}`);

    // 如果状态码不为 200 或 data 不存在，返回 null
    if (result.StatusCode !== 200 || !result.data) {
        return null;
    }

    // 返回整个 data 对象
    return result.data;
}

/**
 * 步骤 2: 根据 MTM 获取完整刷机包数据 (使用 POST 请求)
 */
async function getFlashData(mtm) {
    const url = API_URL_FLASH; 
    const payload = { mtm: mtm };
    
    log(`[API 2 REQUEST] POST ${url}, Payload: ${JSON.stringify(payload)}`);
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json;charset=UTF-8' 
        },
        body: JSON.stringify(payload) // 传递 JSON 请求体
    });

    if (!response.ok) {
        error(`[API 2 ERROR] HTTP Status: ${response.status}`);
        throw new Error(`完整包查询失败，HTTP状态码: ${response.status}`);
    }

    const result = await response.json();
    log(`[API 2 RESPONSE] Status: ${result.code}, Count: ${result.data ? result.data.length : 0}`);

    if (result.code !== 200 || !result.data) {
        return [];
    }
    
    return Array.isArray(result.data) ? result.data : [];
}

/**
 * 步骤 3: 获取 OTA 增量包下载链接 (使用 POST 请求)
 * @param {string} sn - 序列号 (deviceid)
 * @param {string} productModel - 产品型号 (例如: TB710FU)
 * @param {string} currentFirmwareVersion - 当前固件版本 (curfirmwarever)
 * @returns {Promise<Object|null>} 包含 url 和 version 的对象，或 null
 */
async function getOtaDownloadUrl(sn, productModel, currentFirmwareVersion) {
    // 构造 URL 查询参数。PID 和 RAM 使用经验值或假设值
    const pid = ''; 
    const ram = 8; // 假设 RAM 大小
    // 假设 devicemodel 格式为 ProductModel_CN
    const devicemodel = productModel + '_CN'; 

    const queryParams = new URLSearchParams({
        curfirmwarever: currentFirmwareVersion,
        action: 'querynewfirmwar',
        pid: pid,
        locale: 'zh',
        deviceid: sn,
        ChecksumType: 'sha256',
        nationcode: 'CN',
        devicemodel: devicemodel,
        ram: ram,
    });
    
    const url = `${API_URL_OTA_BASE}?${queryParams.toString()}`;
    const payload = { "update_packages": [], "update_packages_data": [] };

    log(`[API 3 REQUEST] POST ${url}, Payload: ${JSON.stringify(payload)}`);
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            // 模拟安卓设备 User-Agent，这是 API 要求的关键
            'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 15; TB710FU Build/AQ3A.250129.001)',
            'Connection': 'Keep-Alive',
            'Accept-Encoding': 'gzip',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        error(`[API 3 ERROR] HTTP Status: ${response.status}`);
        throw new Error(`OTA查询失败，HTTP状态码: ${response.status}`);
    }

    // 关键修复: API 返回 XML，需要使用 response.text() 获取字符串
    const xmlText = await response.text();
    log(`[API 3 RESPONSE] OTA API returned (XML): \n${xmlText}`); 

    // --- XML 解析逻辑 ---
    
    // 检查 XML 格式是否有效 (例如，是否包含 <firmware> 节点)
    const firmwareMatch = xmlText.match(/<firmware>([\s\S]*?)<\/firmware>/);

    if (!firmwareMatch) {
        // 检查是否有错误消息
        const errorMatch = xmlText.match(/<result_msg>(.*?)<\/result_msg>/);
        const errorMsg = errorMatch ? errorMatch[1].trim() : '未找到固件更新包';
        
        log(`[API 3 WARN] No <firmware> section found. Message: ${errorMsg}`);
        // 此时返回 null，表示没有可用的 OTA 更新包 (例如：已是最新)
        return null;
    }

    const firmwareContent = firmwareMatch[1];

    // 1. 提取目标版本 (object_to_name)
    const versionMatch = firmwareContent.match(/<object_to_name>(.*?)<\/object_to_name>/);
    const targetVersion = versionMatch ? versionMatch[1].trim() : 'N/A';

    // 2. 提取下载 URL (downloadurl)
    // 注意：downloadurl 包含 CDATA 块
    const urlMatch = firmwareContent.match(/<downloadurl>\s*<!\[CDATA\[\s*(.*?)\s*\]\]>\s*<\/downloadurl>/);
    const downloadUrl = urlMatch ? urlMatch[1].trim() : 'N/A';
    
    // 检查是否成功解析
    if (downloadUrl === 'N/A' || targetVersion === 'N/A') {
        log(`[API 3 WARN] Could not parse download URL or target version from XML.`);
        return null;
    }

    return {
        url: downloadUrl,
        version: targetVersion,
    };
}


// 启动 Bot
bot.launch()
    .then(() => {
        log('🎉 Telegram Bot 已成功启动并运行中...');
    })
    .catch((err) => {
        error('❌ Bot 启动失败:', err.message);
    });

// 优雅地停止 Bot
process.once('SIGINT', () => {
    log('🚨 SIGINT received, stopping Bot...');
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    log('🚨 SIGTERM received, stopping Bot...');
    bot.stop('SIGTERM');
});