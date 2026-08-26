# DOUBAO-PUBLIC-SHARE-MEDIA-01 实施记录

## 冻结验收包

- 核心目标：以“解析公开分享链接并下载页面实际公开媒体流”取代任何无水印下载承诺。
- P0-1：只接受 `http/https` 豆包公开域名链接；拒绝凭据 URL、非豆包页和私有媒体地址。
- P0-2：在全新临时 Electron session 中读取公开页；跳转由解析器手动跟随且每一步必须留在豆包域名。仅从 HTML 实际声明的 `og:video`、`twitter:player:stream`、`video/source` 或结构化媒体字段选择候选；以 Range 请求校验为公开视频流。
- P0-3：下载前清空临时 session Cookie，以原始响应字节写盘，校验 HTTP、Content-Type、非空文件；UI 明示可能含平台水印。

非目标：隐藏接口、参数伪造、未授权源文件、移除水印、账号 Cookie 特权、视频生成与任何跨项目改动。

## 行为变化

浏览器顶部旧“提取官方无水印视频”以及任务卡/详情的旧手动提取入口已移除。新入口要求用户粘贴豆包公开分享链接，并且只保存该页实际公开的视频流；不会写入任务、计费或账号额度记录。

## 实际修改范围

- tracked 修改：`main/ipc/tasks.ts`、`main/preload.ts`、`packages/contracts/src/dto/electron-api.ts`、`packages/contracts/src/dto/tasks.ts`、`packages/contracts/src/index.ts`、`src/components/BrowserPanel.tsx`、`src/components/TaskConsole.tsx`、`src/components/TaskDetailModal.tsx`。
- untracked 新增：`main/utils/publicShareMedia.ts`、`tests/unit/publicShareMedia.test.ts`、本 handoff。
- tracked 删除：无。

## 验证

- 专项：`publicShareMedia` 5 项 + 既有下载校验 18 项，通过 23/23。
- 类型检查：`pnpm run ts-check` 通过。
- 修改范围 ESLint：0 error；保留的 warnings 均来自既有文件。
- Renderer/Main 构建：`pnpm run build` 通过。
- `git diff --check`：通过。

尚未提交、推送、创建或修改 PR、合并、部署、发布、启动或重启生产安装包。实际成功下载仍需用户提供一个真实的豆包公开分享链接；本包不把登录对话地址或任何未公开页面视为分享链接。

## 真实链接复验补记

用户提供的 `https://www.doubao.com/thread/xt32ytNWhtgL3IMil` 可在无 Cookie 状态返回 200，但最终 HTML 为 161,982 B，未声明 `og:video`、`video` 标签、结构化媒体字段或 `.mp4` 地址。该链接属于按登录态脚本加载内容的 thread 页面，不能作为公开媒体下载证据。跳转路径检查已改为手动验证，因此此类链接会稳定提示“页面未公开声明可下载的视频流”，而非误报域名不允许。
