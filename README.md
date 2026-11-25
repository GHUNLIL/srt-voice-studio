# SRT 字幕配音工具

[打开配音网站](https://srtvoice.unlil.com/)

Cloudflare Pages 在返回网页、资源和配音接口前验证站点账号。默认选择 ChatGPT/OpenAI。浏览器本地配音需要手动下载一次引擎，浏览器缓存可在后续任务中复用。微软 Azure 和自选兼容接口支持使用者填写自己的服务配置。

ChatGPT/OpenAI 模式通过同域接口将字幕发送到 sub2api.unlil.com。请在 Cloudflare 生产环境中配置加密变量 `SUB2API_KEY`，密钥所属分组需要支持聊天音频输出。默认模型为 `gpt-audio`，音色为 `alloy`。

使用随机高强度密码，计算 UTF-8 字符串「账号:密码」的 SHA-256 小写十六进制摘要。将摘要作为 `SITE_LOGIN_SHA256` 运行时变量配置，或在生成 Pages 包时通过同名环境变量传入。运行时变量优先。缺少有效摘要时，所有请求都需要重新认证。

运行 `node worker/build-pages.mjs` 后将 `public/` 上传到 Cloudflare Pages。独立 Wrangler Worker 部署使用同样的登录摘要和密钥，也可配置 `AZURE_SPEECH_REGION` 和加密变量 `AZURE_SPEECH_KEY` 来提供共享微软音色。
