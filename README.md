# Lenovo Tablet Update Get

联想平板刷机包查询工具，支持通过序列号 (SN) 或产品型号 (MTM) 查询完整刷机包及 OTA 增量包信息。

> **声明**：本项目为非官方工具，仅供学习和研究使用。

## 项目结构

```
Lenovo_tablet_update_get/
├── cf-pages/                  # Cloudflare Pages 前端
│   └── index.html             # 前端查询页面
├── lenovo9008.js              # Telegram Bot 主程序
├── worker.js                  # Cloudflare Worker API 代理
├── lenovootacheck.py          # Python OTA 检查脚本 (独立工具)
├── package.json               # Node.js 项目配置
├── package-lock.json          # 依赖锁定文件
└── README.md                  # 项目说明文档
```

## 功能模块

### 1. Telegram Bot (`lenovo9008.js`)

基于 [Telegraf](https://github.com/telegraf/telegraf) 的 Telegram 机器人，支持通过命令查询联想平板刷机包信息。

**使用方法：**

```
/start                              - 显示帮助信息
/query <SN>                         - 查询完整刷机包
/query <SN> <当前固件版本>           - 查询完整包 + OTA 增量包
```

**示例：**

```
/query HA29117A
/query HA29117A TB710FU_CN_OPEN_USER_QSM8650_V_ZUI_17.0.04.279_ST_250808
```

### 2. Cloudflare Worker (`worker.js`)

部署在 Cloudflare Worker 上的 API 代理服务，用于处理前端的查询请求，解决跨域问题。

**API 接口：**

- **请求方式**：`POST`
- **请求体**：

```json
{
  "sn": "HA29117A",                    // 序列号 (8位)，与 mtm 二选一
  "mtm": "ZAG40004CN",                 // MTM 编码 (10位)，与 sn 二选一
  "currentFirmwareVersion": "..."      // 可选，用于查询 OTA 增量包
}
```

- **响应示例**：

```json
{
  "success": true,
  "machineInfo": { ... },
  "fullPackage": { ... },
  "otaPackage": { ... }
}
```

### 3. 前端页面 (`cf-pages/index.html`)

部署在 Cloudflare Pages 上的静态网页，提供友好的查询界面。

**功能特性：**

- 支持 SN (8位) 或 MTM (10位) 查询
- 可选填写当前固件版本以查询 OTA 增量包
- 响应式设计，支持移动端访问
- 显示产品信息、完整刷机包、OTA 增量包等详细信息

### 4. Python OTA 检查脚本 (`lenovootacheck.py`)

独立的 Python 脚本，通过逆向分析联想 OTA 应用的 Smali 代码，模拟设备向联想 OTA 服务器发送固件更新查询请求。

**用途：**

- 模拟联想平板设备的 OTA 更新检查流程
- 直接调用联想内部 OTA API (`ota.lenovo.com/ota-server/firmware/query/for-text-desc`)
- 解析服务器返回的 XML 响应，提取固件版本、下载链接、校验值等信息

**使用方法：**

1. 修改脚本中的 `DEVICE_INFO` 字典，填入目标设备信息：

```python
DEVICE_INFO = {
    "devicemodel": "TB710FU",           # 设备型号
    "deviceid": "HA29117A",             # 设备 SN/IMEI
    "curfirmwarever": "TB710FU_RF01_250925",  # 当前固件版本
    "locale": "zh_CN",                  # 语言代码
    "nationcode": "zh_CN",              # 国家代码
    "pid": "123456",                    # LSF PID
}
```

2. 运行脚本：

```bash
pip install requests
python lenovootacheck.py
```

**注意：** 此脚本使用的 API 端点与 Bot/Worker 不同，是基于逆向工程获取的内部接口，仅供研究参考。

## 部署指南

### Telegram Bot 部署

1. **安装依赖**

```bash
npm install
```

2. **配置环境变量**

创建 `.env` 文件：

```env
BOT_TOKEN=your_telegram_bot_token_here
```

3. **启动 Bot**

```bash
node lenovo9008.js
```

### Cloudflare Worker 部署

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 Workers & Pages
3. 创建新的 Worker
4. 将 `worker.js` 的内容粘贴到编辑器中
5. 部署并记录 Worker URL

### Cloudflare Pages 部署

1. 登录 Cloudflare Dashboard
2. 进入 Workers & Pages
3. 创建新的 Pages 项目
4. 上传 `cf-pages/` 目录
5. 修改 `index.html` 中的 `WORKER_URL` 为你的 Worker URL

```javascript
const WORKER_URL = "https://your-worker.your-subdomain.workers.dev/";
```

## 依赖项

**Node.js (Telegram Bot)：**

| 包名 | 版本 | 说明 |
|------|------|------|
| telegraf | ^4.16.3 | Telegram Bot 框架 |
| node-fetch | ^3.3.2 | HTTP 请求库 |
| dotenv | ^17.2.3 | 环境变量管理 |

**Python (OTA 检查脚本)：**

| 包名 | 说明 |
|------|------|
| requests | HTTP 请求库 |

## API 说明

本项目调用以下联想 API：

| API | 用途 | 使用模块 |
|-----|------|----------|
| `ptstpd.lenovo.com.cn/home/ConfigurationQuery/getMachineSequenceInfo` | 根据 SN 获取设备信息 | Bot, Worker |
| `ptstpd.lenovo.com.cn/home/ConfigurationQuery/getPadFlashingMachine` | 根据 MTM 获取刷机包信息 | Bot, Worker |
| `ota.lenovo.com/engine/upgrade` | 查询 OTA 增量更新 | Bot, Worker |
| `ota.lenovo.com/ota-server/firmware/query/for-text-desc` | 模拟设备查询 OTA 更新 (逆向接口) | Python 脚本 |

## 许可证

MIT License

## 免责声明

- 本项目仅供学习和研究使用
- 本项目与联想集团无任何关联
- 使用本项目下载的固件刷机存在风险，请自行承担后果
- 请遵守相关法律法规，合理使用本工具

