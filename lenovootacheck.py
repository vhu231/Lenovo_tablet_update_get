import requests
import xml.etree.ElementTree as ET
import json
import logging

# 启用日志记录
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- 服务器 API URL (来自 Smali 代码) ---
UPDATE_SERVLET_URL_QUERY = "https://ota.lenovo.com/ota-server/firmware/query/for-text-desc"

# --- 模拟设备信息 (你需要根据你的设备信息修改这些值) ---
DEVICE_INFO = {
    # 例如：
    "devicemodel": "TB710FU",  # Smali: getmOtaModel()
    "deviceid": "HA29117A",           # Smali: getmDeviceId() - 通常是设备的IMEI/SN/UUID
    "curfirmwarever": "TB710FU_RF01_250925", # Smali: getmOtaVersion() - 当前固件版本
    "locale": "zh_CN",                     # Smali: getmLanguageCode() - 语言代码
    "nationcode": "zh_CN",                    # Smali: getCountryCode() - 国家代码
    "pid": "123456",                       # Smali: getmLsfPid()
}

def check_for_new_version(device_info):
    """
    模拟 doQueryNewVersion 方法，检查是否有新的固件版本。
    
    Args:
        device_info (dict): 设备的详细信息。

    Returns:
        dict: 包含新版本信息的字典，如果无更新则返回 None。
    """
    logging.info(f"正在向 {UPDATE_SERVLET_URL_QUERY} 检查固件更新...")
    
    # 构造 POST 请求参数 (基于 Smali 代码中的 Properties)
    payload = {
        "action": "querynewfirmware",
        "devicemodel": device_info.get("devicemodel"),
        "deviceid": device_info.get("deviceid"),
        "curfirmwarever": device_info.get("curfirmwarever"),
        "locale": device_info.get("locale"),
        "pid": device_info.get("pid"),
        "ChecksumType": "sha256"
        # 只有在 nationcode 不为空时才添加
    }
    if device_info.get("nationcode"):
        payload["nationcode"] = device_info.get("nationcode")

    try:
        # 发送 HTTP POST 请求
        response = requests.post(UPDATE_SERVLET_URL_QUERY, data=payload, timeout=10)
        
        # 模拟 geServerResponseOrThrowError 中的 HTTP 状态码检查 (HTTP 200)
        if response.status_code != 200:
            logging.error(f"服务器错误或请求失败，HTTP Code: {response.status_code}")
            return None

        # 服务器响应内容 (预期是 XML)
        xml_data = response.text
        logging.info("成功接收服务器响应。")

        # 尝试解析 XML 响应
        # ⚠️ 注意: Smali代码中使用了 OtaPackageInfo.parseXml，我们这里进行简单的解析
        return parse_ota_package_xml(xml_data)

    except requests.exceptions.RequestException as e:
        # 模拟 OtaExceptionNetwork 
        logging.error(f"网络请求失败 (OtaExceptionNetwork): {e}")
        return None
    except Exception as e:
        # 模拟 OtaExceptionServerResponseParseError
        logging.error(f"响应解析失败 (OtaExceptionServerResponseParseError): {e}")
        return None


def parse_ota_package_xml(xml_string):
    """
    解析服务器返回的固件信息 XML。
    """
    if not xml_string.strip():
        logging.info("响应为空，可能没有新版本。")
        return None

    try:
        root = ET.fromstring(xml_string)
        
        # 检查是否有错误信息 (Smali代码中没有明确的错误检查，但这是推荐的最佳实践)
        if root.tag == 'Error' or root.find('ErrorCode') is not None:
             error_code = root.findtext('ErrorCode', 'N/A')
             error_msg = root.findtext('ErrorMsg', '未知错误')
             if error_code == '1000':
                 # 假设 1000 是 "没有新版本" 的代码
                 logging.info("服务器响应：没有检测到新固件版本。")
                 return None
             else:
                 logging.error(f"服务器返回错误: Code={error_code}, Msg={error_msg}")
                 return None

        # 提取关键信息 (根据常见的 OTA XML 结构猜测)
        package_info = {
            "version": root.findtext("Version"),
            "size": root.findtext("PackageSize"),
            "url": root.findtext("DownloadUrl"), # 固件下载链接
            "checksum": root.findtext("Sha256"),   # 文件校验值
            "release_note": root.findtext("ReleaseNote", "无"),
            "is_full_package": root.findtext("IsFullPackage"),
            "update_from_version": root.findtext("UpdateFromVersion"),
        }

        # 过滤掉值为 None 的键
        package_info = {k: v for k, v in package_info.items() if v is not None}

        # 如果至少有版本信息，则认为找到了更新
        if package_info.get("version"):
            return package_info
        else:
            logging.warning("XML响应格式不正确或缺少关键版本信息。")
            return None

    except ET.ParseError:
        logging.error("XML解析失败，响应可能不是有效的 XML。")
        return None


if __name__ == "__main__":
    
    print("-" * 50)
    print("Lenovo OTA 固件更新检查工具")
    print(f"模拟设备型号: {DEVICE_INFO.get('devicemodel')}")
    print(f"当前固件版本: {DEVICE_INFO.get('curfirmwarever')}")
    print("-" * 50)

    # 1. 检查固件更新
    new_package = check_for_new_version(DEVICE_INFO)

    print("\n" + "=" * 50)
    if new_package:
        print("✅ 检测到新的固件版本！")
        print("-" * 50)
        print(f"**新版本号 (Version):** {new_package.get('version', 'N/A')}")
        print(f"**包大小 (Size):** {new_package.get('size', 'N/A')} Bytes")
        
        # 重点：固件下载链接
        download_url = new_package.get('url', '未提供下载链接')
        print(f"**📥 下载链接 (Download URL):** \n{download_url}")
        
        print(f"**文件校验码 (SHA256):** {new_package.get('checksum', 'N/A')}")
        print(f"**更新说明:** {new_package.get('release_note', '无')}")
        print("-" * 50)

    else:
        print("❌ 未检测到新的固件版本，或查询失败。")
        print("请检查网络连接和 DEVICE_INFO 配置是否准确。")
    print("=" * 50)