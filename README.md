# SRT 字幕配音工具

[打开网站](https://srt.unlil.com/) · [部署到自己的 Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/GHUNLIL/srt-voice-studio)

公开站点使用 Cloudflare Pages。默认引擎在浏览器内合成。选择微软 Azure 后可填写自己的 Speech 资源区域和密钥；选择兼容语音接口后可填写完整 HTTPS 地址、模型名、音色和密钥。密钥与字幕直接发送到所选服务，服务须允许浏览器跨域调用。刷新页面后需重新填写密钥。

更新 Pages 站点时运行 `node worker/build.mjs`，将生成的 `public/` 内容上传到 Cloudflare Pages 的 `unlil-srt` 项目。历史记录和 WAV 保存在使用者的浏览器内。

## 可选的站点共享微软音色

1. 在 Azure 创建 Speech 资源，试用请选择 F0。在「密钥和终结点」中找到区域短名及一把密钥。
2. 使用上方部署链接，在 Cloudflare 中配置 Worker 的两个运行时变量。将区域短名（例如 japaneast）填入 AZURE_SPEECH_REGION，将资源密钥作为 Secret 填入 AZURE_SPEECH_KEY。若部署页面未显示输入框，可在 Worker 设置的 Variables and Secrets 下添加并部署。
3. 打开部署生成的 workers.dev 地址，选择「微软神经语音（Azure）」，导入 SRT 并下载。浏览器默认使用本地声音，访客主动选择微软后才会上传正文。所有访客共享这一 Azure 资源的配额。
4. 如果还要让本项目的 GitHub Pages 地址也能使用微软语音，在原仓库的 speech-config.json 中将 workerOrigin 填为已部署的 HTTPS Worker 地址并提交。Worker 地址本身可以直接使用。

一个访客每分钟最多发起 20 次合成请求。遇到限流时，页面会依照服务提示等待并重试一次。历史配音只保存在当前浏览器、当前站点中。
