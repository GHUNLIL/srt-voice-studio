# SRT 字幕配音工具

[打开配音网站](https://srtvoice.unlil.com/)

登录后选择普通话、日语、韩语、英语或德语音色。首次手动下载模型，字幕在浏览器内合成为 WAV。

账号、会话、充值订单和历史点数账目使用 D1 绑定 `DB`。管理员首次初始化需要 `ADMIN_VERIFIER`，格式为 32 位十六进制盐、冒号、64 位十六进制 PBKDF2-SHA256 摘要。使用盐字符串的 UTF-8 字节，迭代 100000 次。设置 `PAY_WRAPPING_KEY` 为独立随机的 32 字节十六进制密钥，跨发布保留，用于加密商户签名密钥。

管理员可在账户页配置 UnlilPay 商户、付款渠道和每元点数。本地神经配音免费。

运行 `node worker/build-pages.mjs` 后把 `public/` 上传至 Cloudflare Pages，并绑定 D1。
