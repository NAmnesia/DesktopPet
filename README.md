# 桌宠 Desktop Pet 🐾

一只住在桌面上的小宠物：点击它聊天（气泡流式回复），支持**云端 API** 与**本地 Ollama 千问 2.5** 任意切换。

美术资源未就绪时使用内置 SVG 简易角色，放入图片即可换肤，无需改代码。

> **角色说明**：默认角色形象由 AI 参考初音未来周边生成，**抠图不精，请谅解**。
> Hatsune Miku © Crypton Future Media, Inc. / Piapro Character License，本项目为非商业粉丝作品。代码以 MIT 许可发布（见 LICENSE）。

## 功能

- 🖱️ 桌面常驻、窗口置顶、可拖拽移动（锚点绝对定位 + rAF 节流，跟手不漂移；位置自动记住）、空白区域鼠标穿透不挡操作
- 💬 点击宠物弹出输入框，回复以气泡形式流式打字机显示，可随时停止生成
- 🤖 模型双通道（全部 OpenAI 兼容接口）：
  - **本地**：Ollama（默认 `http://localhost:11434/v1`，无需 Key）
  - **云端**：DeepSeek / 通义千问 / OpenAI / 任意自定义 Base URL
- 🎭 人设系统：内置 5 款人设预设（软萌 / 傲娇毒舌 / 慵懒猫咪 / 元气鼓励师 / 冷静管家），一键填充提示词后可继续微调
- 🍅 番茄钟：自定义专注/休息时长与轮数，宠物头顶实时倒计时徽章；每到休息、下一轮开始、周期完成，由 **AI 现场生成**一句不重样的提醒（自动避开最近说过的说法），同时弹系统通知
- 👀 屏幕观察（仅本地视觉模型）：定期截屏发给本地 qwen2.5vl，宠物就你屏幕上的内容主动搭话；截图只在内存处理不落盘，使用云端 API 时自动停用
- 🔒 锁定模式：人物完全点击穿透，不影响任何桌面操作，托盘菜单一键切换
- ⚙️ 设置界面：服务商切换、API Key、一键获取模型列表、测试连接、宠物人设、番茄钟参数、大小、气泡时长、记忆轮数
- 🎨 换肤：角色文件夹放 `idle.png / talk.png / drag.png` 即可，设置里下拉切换

## 运行

需要 [Node.js](https://nodejs.org)（18+）。

```bash
npm install
npm start
```

> 国内网络安装 Electron 慢时可用镜像：
> ```bash
> $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"   # PowerShell
> npm install
> ```

## 本地千问 2.5（Ollama）配置

```bash
# 1. 安装 Ollama: https://ollama.com
# 2. 拉取千问2.5（按显存选大小）
ollama pull qwen2.5:7b
# 3. 启动桌宠后，右键 → 设置 → 模型服务
#    服务商选 "Ollama 本地"，点"获取列表"选模型，"测试连接"通过即可
```

## 使用

| 操作 | 效果 |
|---|---|
| 单击宠物 | 弹出/收起聊天输入框 |
| 拖拽宠物 | 移动位置（自动记住，且不会拖出屏幕找回不来） |
| 右键宠物 / 托盘图标 | 菜单：聊天、设置、番茄钟、置顶、退出 |
| 点击宠物头顶的 🍅 徽章 | 查看番茄钟当前轮次与剩余时间 |
| 生成中按 Enter / 点"停止生成" | 中断本次回复 |

## 换肤（自定义美术）

角色文件夹规范（详见 `assets/characters/default/README.md`）：

```
characters/<角色名>/
├── idle.png   # 待机（必需）
├── talk.png   # 说话（可选）
└── drag.png   # 拖拽（可选）
```

设置 → 外观 → **打开角色文件夹**，放图后下拉即可切换。

## 打包 exe

```bash
npm run dist
```

产物：`dist/DesktopPet-<版本号>.exe`（便携版单文件，双击即用，免安装）。

- 图标/托盘图：`assets/icon.ico`（由角色图生成，`scripts/gen-icon.js` 是最早的简笔版）
- 配置与自定义角色存于 `%APPDATA%/desktop-pet/`，与开发版共用，互不影响升级
- 国内网络构建慢时：`ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ npm run dist`
- `dist/win-unpacked/` 是构建中间产物（解包版），可删；只要 exe 的话保留 `dist/*.exe` 即可

## 项目结构

```
desktop-pet/
├── main.js               # 主进程：窗口/托盘/鼠标穿透/配置/LLM 流式请求
├── preload.js            # contextBridge 安全桥接
├── src/pet.*             # 宠物窗口（内置 SVG 角色 + 气泡聊天）
├── src/settings.*        # 设置窗口
└── assets/characters/    # 角色图片文件夹（换肤入口）
```
