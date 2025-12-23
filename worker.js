// Cloudflare Worker / Pages Functions 上的联想刷机包查询 API 代理
// ----------------------------------------------------------------------
// 此 Worker 接收来自前端页面的 POST 请求，执行对联想 API 的查询，
// 并将结果返回给前端，从而避免前端的跨域和复杂 POST 请求问题。
// ----------------------------------------------------------------------

// 联想 API 地址
const API_URL_INFO = 'https://ptstpd.lenovo.com.cn/home/ConfigurationQuery/getMachineSequenceInfo?MachineNo=';
const API_URL_FLASH = 'https://ptstpd.lenovo.com.cn/home/ConfigurationQuery/getPadFlashingMachine';
const API_URL_OTA_BASE = 'https://ota.lenovo.com/engine/upgrade';

// --- API 请求函数 ---

/**
 * 步骤 1: 根据 SN 获取 MTM (使用 GET 请求)
 * 返回完整的机器信息对象
 */
async function getMachineMTM(sn) {
    const url = `${API_URL_INFO}${sn}`;
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) throw new Error(`设备信息查询失败，HTTP状态码: ${response.status}`);
    const result = await response.json();
    if (result.StatusCode !== 200 || !result.data) return null;
    return result.data;
}

/**
 * 步骤 2: 根据 MTM 获取完整刷机包数据 (使用 POST 请求)
 */
async function getFlashData(mtm) {
    const url = API_URL_FLASH; 
    const payload = { mtm: mtm };
    
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json;charset=UTF-8' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(`完整包查询失败，HTTP状态码: ${response.status}`);

    const result = await response.json();

    if (result.code !== 200 || !result.data) return [];
    
    return Array.isArray(result.data) ? result.data : [];
}

/**
 * 步骤 3: 获取 OTA 增量包下载链接 (使用 POST 请求)
 */
async function getOtaDownloadUrl(sn, productModel, currentFirmwareVersion) {
    // SN是必填的，即使是MTM查询，也需要SN（此时可传入MTM，但API返回结果不一定对）
    const deviceIdentifier = sn || productModel; 

    const pid = ''; 
    const ram = 8; 
    const devicemodel = productModel + '_CN'; 

    const queryParams = new URLSearchParams({
        curfirmwarever: currentFirmwareVersion,
        action: 'querynewfirmwar',
        pid: pid,
        locale: 'zh',
        deviceid: deviceIdentifier, // 使用 SN 或 ProductModel
        ChecksumType: 'sha256',
        nationcode: 'CN',
        devicemodel: devicemodel,
        ram: ram,
    });
    
    const url = `${API_URL_OTA_BASE}?${queryParams.toString()}`;
    const payload = { "update_packages": [], "update_packages_data": [] };

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

    if (!response.ok) throw new Error(`OTA查询失败，HTTP状态码: ${response.status}`);

    const xmlText = await response.text();
    const firmwareMatch = xmlText.match(/<firmware>([\s\S]*?)<\/firmware>/);

    if (!firmwareMatch) return null;

    const firmwareContent = firmwareMatch[1];
    const versionMatch = firmwareContent.match(/<object_to_name>(.*?)<\/object_to_name>/);
    const targetVersion = versionMatch ? versionMatch[1].trim() : 'N/A';

    const urlMatch = firmwareContent.match(/<downloadurl>\s*<!\[CDATA\[\s*(.*?)\s*\]\]>\s*<\/downloadurl>/);
    const downloadUrl = urlMatch ? urlMatch[1].trim() : 'N/A';
    
    if (downloadUrl === 'N/A' || targetVersion === 'N/A') return null;

    return { url: downloadUrl, version: targetVersion };
}


// --- 核心查询逻辑 ---
async function handleQuery(sn, mtm, currentFirmwareVersion) {
    let machineInfo = null;
    let finalMtm = mtm;
    let fullPackageData = null;
    let otaResult = null;

    try {
        // 1. 如果有 SN，先通过 SN 获取机器信息和 MTM (这是最可靠的)
        if (sn) {
            const info = await getMachineMTM(sn);
            if (info && info.MTM) {
                machineInfo = info;
                finalMtm = info.MTM;
            }
        }

        // 2. 如果通过 SN 没有拿到 MTM (SN无效) 并且用户输入了 MTM，则使用用户输入的 MTM
        if (!finalMtm && mtm) {
            finalMtm = mtm;
        }

        if (!finalMtm) {
             throw new Error(`未能查询到序列号/MTM 对应的产品型号 (MTM) 信息。`);
        }

        // 3. 根据最终 MTM 查询完整刷机包数据
        const flashData = await getFlashData(finalMtm);
        if (flashData.length === 0) {
            throw new Error(`根据 MTM ${finalMtm} 未找到可用的完整刷机包下载链接。`);
        }
        fullPackageData = flashData[0];

        // 4. (可选) 查询 OTA 增量包
        // 只有当有固件版本和产品型号时才查询
        if (currentFirmwareVersion && (machineInfo || fullPackageData.product_model)) {
            const productModel = (machineInfo && machineInfo.ProductModel) ? machineInfo.ProductModel : fullPackageData.product_model;
            
            // SN查询优先使用SN做 deviceid, MTM查询则使用 ProductModel 作为 deviceid
            const deviceId = (sn && machineInfo) ? sn : productModel; 

            otaResult = await getOtaDownloadUrl(
                deviceId, 
                productModel, 
                currentFirmwareVersion
            );
        }

        // 返回一个结构化的对象
        return {
            success: true,
            machineInfo: machineInfo, // SN查询时有完整数据，MTM查询时为 null
            fullPackage: {
                ...fullPackageData,
                mtm: finalMtm // 确保 MTM 字段返回
            },
            otaPackage: otaResult
        };

    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

// --- Worker 入口 ---
export default {
    /**
     * @param {Request} request
     */
    async fetch(request) {
        // 允许跨域请求 (CORS)
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*', // 生产环境请限制为您的 Pages 域名
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

        if (request.method !== 'POST') {
            return new Response("Method Not Allowed. Use POST.", { status: 405, headers: corsHeaders });
        }

        try {
            // 接收 SN, MTM 和 currentFirmwareVersion
            const { sn, mtm, currentFirmwareVersion } = await request.json();

            // 至少要有一个查询参数
            if (!sn && !mtm) {
                return new Response(JSON.stringify({ success: false, error: '缺少序列号 (SN) 或 MTM 编码。' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
            }

            // 调用核心查询逻辑
            const result = await handleQuery(
                sn ? sn.trim().toUpperCase() : null, 
                mtm ? mtm.trim().toUpperCase() : null, 
                currentFirmwareVersion ? currentFirmwareVersion.trim() : null
            );

            return new Response(JSON.stringify(result), {
                status: result.success ? 200 : 500,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });

        } catch (e) {
            return new Response(JSON.stringify({ success: false, error: `Worker 内部错误: ${e.message}` }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
        }
    }
};