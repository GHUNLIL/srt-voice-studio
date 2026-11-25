# SRT 字幕配音工具

[打开配音网站](https://srtvoice.unlil.com/)

Cloudflare Pages 在返回网页、资源和配音接口前验证站点账号。默认选择 ChatGPT/OpenAI。浏览器本地配音需要手动下载一次引擎，浏览器缓存可在后续任务中复用。微软 Azure 和自选兼容接口支持使用者填写自己的服务配置。

ChatGPT/OpenAI 模式通过同域接口将字幕发送到 sub2api.unlil.com。请在 Cloudflare 生产环境中配置加密变量 `SUB2API_KEY`，密钥所属分组需要支持聊天音频输出。默认模型为 `gpt-audio`，音色为 `alloy`。

账号、会话、充值订单和配音扣点使用 D1 绑定 `DB`。管理员首次初始化需要 `ADMIN_VERIFIER`，格式为 32 位十六进制盐、冒号、64 位十六进制 PBKDF2-SHA256 摘要。使用盐字符串的 UTF-8 字节，迭代 100000 次。设置 `PAY_WRAPPING_KEY` 为独立随机的 32 字节十六进制密钥，跨发布保留，用于加密商户签名密钥。

在账户页的管理员设置中填写 UnlilPay 商户、付款渠道、每元点数和 ChatGPT/OpenAI 每段点数（含试听）。首次部署的兑换比例和费率均为 0。网关确认订单后点数到账。用户自带密钥或浏览器本地配音免费。

运行 `node worker/build-pages.mjs` 后把 `public/` 上传至 Cloudflare Pages，并绑定 D1。独立 Wrangler Worker 使用同一套账户和计费接口，还可配置 `AZURE_SPEECH_REGION` 和 `AZURE_SPEECH_KEY` 启用共享微软音色。
