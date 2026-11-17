本次 Android 版同步作者 **v0.4.0「规程」**。适用于 ARM64 和 Android 7.0 及以上。APK 内置游戏、美术、音频和字体，支持离线单机。局域网联机须在应用中主动开启。

### 游戏更新

- **规程·序列Ⅰ**：大厅默认选择规程。独立模拟新增极速模拟和规程等级 1–20。同盟模拟保留四个难度。大厅仍可选择前四个游戏版本。
- **规则与内容**：新增 37 名干员、赛季盟约和装备。第 8 行改为 5 格装备区。新版增加开局盟约抽选、自编干员选择和领袖伤害排行。
- **画面和主题**：新增规程赛季大厅、战场场景和战斗特效。可以在设置中选择随完整包提供的「卫戍协议终端」和「乌萨斯齐心团」。应用也支持本地导入主题包。
- **Android 修复**：APK 补入上游更新日志。标题页的「更新说明」可以在断网时显示。

上游完整改动和仍在推定的规则见[作者 v0.4.0 发布说明](https://github.com/sganggs/Stronghold-Protocol/releases/tag/v0.4.0)。

### 安装与验证

下载 **Stronghold-Protocol-0.4.0-arm64-v8a.apk**。结束对局后再覆盖安装。同一包名和签名支持 Android 覆盖安装。更新会重启应用，当前对局无法恢复。

APK 约 **1.18 GB**。解压后的游戏约 **1.63 GB**。应用首次解压时建议预留 **4 GB**，下载 APK 和系统安装另需空间。

本次候选通过 ARM64 与 x86_64 构建、Android 单元测试和 lint。Android 16 / 16 KB 模拟器在断网时打开更新说明，并从大厅进入独立模拟的规程难度列表。测试还验证了 WebSocket 和 Activity 重建后原服务进程继续运行。证据见[构建记录](https://github.com/L-xuanxiao/Stronghold-Protocol/actions/runs/44001290894)及[验证记录](https://github.com/L-xuanxiao/Stronghold-Protocol/blob/xx/android/mobile/VALIDATION.md)。

未验证完整对局、历史版本玩法、主题渲染、插件跨版本保留和正式签名真机覆盖升级。双设备联机、Doze、网络切换、Android 7.0 和低内存设备也未验证。

游戏锁定到作者 [v0.4.0 / b6d8b2ef](https://github.com/sganggs/Stronghold-Protocol/tree/b6d8b2ef46ed2da69585ea437c627c5fc2b4145e)。公开附件仅有 APK。完整构建输入保存在维护者可见的草稿中。

代码按 GPL-3.0-or-later 提供。原作和第三方声明见 APK 内的 LICENSE、NOTICE.md 和 licenses/。明日方舟素材版权归原权利人。项目为非官方、非商业同人移植。
