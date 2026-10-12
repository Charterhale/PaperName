# Safari 版本

PaperName 的 Safari 版本使用同一套文献识别、期刊缩写和文件名规则，但下载能力与 Chrome/Edge 不同。

## 安装方式

下载 Release 的 `PaperName-Safari-development-v1.1.0.zip`，解压后取得 `PaperName/extension` 文件夹。

- macOS Safari 27 或以上：按 Apple 的[临时加载扩展说明](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension)，在 Safari 设置的高级选项启用网页开发功能，再在开发者设置中添加临时扩展文件夹。只给需要处理的文献网站授权。临时扩展属于开发/测试方式，并非 App Store 安装包。
- 需要长期安装或使用较早版本 Safari：安装完整 Xcode，在仓库运行 `python3 scripts/package.py --browser safari`，再运行 `python3 scripts/safari_project.py`。使用生成的 Xcode 工程进行构建、签名和安装。脚本不会改系统开发路径、不会签名或安装。Apple 的[打包说明](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)介绍了相关流程。

目前不提供签名的 `.app`、App Store 或 TestFlight 版本，也未验证 iOS/iPadOS。

Safari 添加临时扩展会要求系统认证并开启“允许未签名的扩展”。请按系统提示自行认证，测试后可关闭该开关。

## 使用

在已授权的论文页面普通左键点击同站点直接 PDF 链接时，插件读取文献信息和 PDF，再用所选名称交给 Safari 保存。支持三种顺序、手动纠正和自定义期刊缩写。也可以在弹窗选择本页同站点 PDF 链接，点击“用预览名称下载 PDF”。

为了保留网站访问边界，只读取同源 GET 请求：不跟随重定向，不跨域传送 Cookie，不代交 POST 表单；PDF 上限 50 MB、读取超时 30 秒，并验证响应类型和 `%PDF-` 标识。内容读取失败会提供“按网站原方式打开”链接，不保存错误 HTML 为 PDF。

跨域 CDN、登录中转、POST、内置 PDF 阅读器、右键另存为、带修饰键或中键打开等流程不自动接管。此时从弹窗复制文件名，在 Safari 另存为窗口使用。某些网站脚本可能先接管点击；也可能需要手动保存。

Safari 的 WebExtension API 没有 `downloads`，因此无法观察任意下载、验证下载完成或处理文件名冲突。页面提示“已交给 Safari 保存”仅表示已发起保存，实际结果以浏览器下载列表为准；重名处理由 Safari 决定。

后台不依赖 `downloads` 或 `storage.session`。没有 session API 时，短期页面关联和手动纠正仅保存在后台内存；后台重启可能失效，可重新识别并再次纠正。

## 技术依据

- [MDN downloads 兼容数据](https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/downloads.json)：Safari 不支持 downloads API。
- [Apple Safari Web Extensions](https://developer.apple.com/documentation/safariservices/safari-web-extensions)：安装、打包与平台模型。

## 已验证版本

2026-10-12 在 Safari 27.0.1 实测临时加载、文献识别、三种命名顺序、按钮下载和 HTML 错误拒绝。真实保存结果已核对本地 PDF 字节，详见 [验证说明](验证说明.md)。其他版本、iOS 与签名分发未实测。
