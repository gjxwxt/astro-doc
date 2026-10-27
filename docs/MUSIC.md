# 音乐下载

`/tools/music/` 是一个服务端聚合搜索，目标是让家人不用装浏览器插件，打开门户就能搜歌、下载 MP3 和歌词。

## 搜索顺序

按顺序问源，第一个有结果的源就停：

1. **歌曲海**：`gequhai.com`
2. **歌曲客**：`gequke.com`
3. **网易云**：`music.163.com`

返回结果会带 `source` 和 `id`；下载时再按这两个字段回到对应源解析音频。搜索失败或没有结果会继续下一个源，不会因为一个源挂了就整页失败。

## 下载内容

- 音频：**128kbps MP3**。这是歌曲海/歌曲客接口直接给的音质，也是网易云标准音质。
- 歌词：页面里的 LRC。勾选“同时下载 .lrc 歌词”时，服务端把 MP3 和 LRC 打包成 zip；没有歌词时只返回 MP3。
- 文件名：`歌手 - 歌名.mp3` / `.lrc` / `.zip`。服务端会去掉文件系统不允许的字符。
- 不做 ID3 标签重写；Kuwo/网易云返回的 MP3 自带基础标签。需要统一标签、封面时，再加 `ffmpeg` 或 `node-id3`。
- 公开响应里不出现源名称：搜索结果只给一个加密的 `token`，下载时凭 token 回到内部源。token 默认 45 分钟过期，可用 `MUSIC_TOKEN_SECRET` 固定密钥。

## 为什么不做浏览器插件

浏览器插件在 gequbao 这类有 Cloudflare 的站点上最稳，但家人需要安装、更新、处理权限，不符合“打开平台就能用”的目标。因此第一版把能在服务端稳定拿到的源接进门户；gequbao 单独留在后续。

## 歌曲宝为什么不在第一版

gequbao.com 有 Cloudflare 校验：

- `curl` / `curl_cffi` 直接请求会拿到 403 challenge。
- 真实浏览器等几秒可以通过，但服务端要复现这个会话，需要 Playwright/Chromium，甚至处理验证码。
- 已有项目会用 Playwright + OCR 做批量，但部署重、易坏，不适合作为家庭主链路。

后续可以加一个独立的 browser worker：能过就过，过不了就跳过，不阻塞歌曲海/歌曲客/网易云。

## 无损和高品

歌曲海/歌曲客的“高品质/无损”按钮通常指向**夸克网盘分享**，不是直链；要自动下载需要夸克 cookies/登录，边界也更复杂。第一版只做 128kbps 直链 MP3，不自动碰网盘。

如果后面确实需要无损，优先考虑：

- 独立的 MusicDL/Quark 解析服务（需要 cookies，个人自用）
- 其他无损源 adapter
- 仍然不要在门户主进程里塞网盘登录逻辑

## 代码结构

```text
src/lib/music/
├── types.ts       # MusicTrack / SourceAttempt / ResolvedTrack
├── utils.ts       # HTML/LRC 清洗、超时、cookie、音频校验、文件名
├── gequ.ts        # 歌曲海 + 歌曲客（同一套页面结构）
├── netease.ts     # 网易云搜索 / 播放地址 / 歌词
└── index.ts       # 顺序搜索、缓存、下载、zip 打包

src/plugins/music/
├── manifest.ts    # 两个 action：search / download
├── server.ts      # 调用 lib/music
└── Tool.astro     # 搜索、源状态、结果列表、下载按钮
```

## 加一个源

1. 在 `src/lib/music/` 新建 adapter，导出 `search(query, limit)` 和 `resolve(id)`。
2. 在 `src/lib/music/index.ts` 的 `SOURCES` 里按期望顺序加入。
3. 在 `downloadMusic` 的音频域名白名单里加上该源的 CDN。
4. 在 `src/plugins/music/manifest.ts` 的 `download.input.source.enum` 里加入 id。
5. 给解析函数补单测，至少覆盖搜索页和详情页的关键字段。

原则：**一个源一个文件**，不要把多个站的 HTML 解析塞进 `index.ts`。

## 安全与边界

- 只接受 `source` + 数字 `id`，不接受任意 URL，避免 SSRF。
- 音频下载前校验域名（Kuwo / 126.net）和 MP3 文件头。
- 单文件上限 45MB；请求有 9–20 秒超时。
- 搜索结果缓存 2 分钟，减少重复请求。
- 现有 API 限流仍然生效；家庭使用足够，公开部署要再加访问控制。
- 只用于家庭自用；不要公开分发受版权保护的内容，也不要做批量下载站。

## 测试

```bash
pnpm test          # 解析器、文件名、LRC 清洗、MCP 校验等
pnpm check         # Astro 类型 + MCP tsc + Vitest
pnpm build
```

手工验收：

```bash
curl -s -X POST http://localhost:4400/api/tools/music/search \
  -H 'content-type: application/json' \
  --data '{"query":"晴天 周杰伦","limit":3}'

curl -s -X POST http://localhost:4400/api/tools/music/search \
  -H 'content-type: application/json' \
  --data '{"query":"晴天 周杰伦","limit":3}' \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["data"]["results"][0]["token"])'

# 把上一步的 token 填进来
curl -s -D /tmp/music.headers -X POST http://localhost:4400/api/tools/music/download \
  -H 'content-type: application/json' \
  --data '{"token":"<TOKEN>","title":"晴天","artist":"周杰伦","includeLyrics":true}' \
  -o /tmp/music.zip
```

## 参考

- [MusicDL](https://github.com/CharlesPikachu/musicdl)：多源适配、歌曲宝/歌曲海/歌曲客解析、LRC、夸克。许可证是 PolyForm Noncommercial；本项目的实现是参考其思路后重写的 TypeScript adapter，没有直接引入其 Python 依赖。
- [fflate](https://github.com/101arrowz/fflate)：服务端 zip 打包。
