本次 Android 版同步作者 **v0.2.1**，包含从 v0.1.4 之后的 v0.2.0 新功能及 v0.2.1 修复。游戏和素材在 APK 内提供，手机可独立离线单机运行，也可主动开启局域网联机。适用于 **ARM64 / Android 7.0 及以上**。

### 上游游戏更新

以下整理自作者的 [v0.2.0](https://github.com/sganggs/Stronghold-Protocol/releases/tag/v0.2.0) 和 [v0.2.1](https://github.com/sganggs/Stronghold-Protocol/releases/tag/v0.2.1) 正式更新说明。

- **补位与自选编队**：标记未持有的干员后，开局可用补位干员代替；5 阶、6 阶各可自选两名六星干员，并选择技能、模组。
- **多语言与操作设置**：新增英语、日语、韩语及繁体中文，支持修改快捷键。日、韩界面部分为机器翻译。
- **战斗与表现调整**：修正攻击被控制打断、首领血量、回血和复活等规则；完善观战、双人战场标记、回合结算画面与音效。
- **联防地图修复**：v0.2.1 恢复使用当前回合的地图，保留地形和场景装置；双人战场的突袭成员可以进入队友半场。
- **干员和道具修复**：按满潜能计算干员数值；修正满装备栏的消耗道具处理、Touch 技能范围、凋亡充能扣除和部分策略效果。
- **界面与联机修复**：补全自选干员的盟约列表和部分敌人动画，修复飞行高度、窗口关闭以及战场加载期间消息丢失的问题。

更完整的条目见作者 [v0.2.1 的 CHANGELOG](https://github.com/sganggs/Stronghold-Protocol/blob/v0.2.1/CHANGELOG.md)。感谢原作者及上游贡献者。

### Android 更新与安装

- 修复上游新增 Git 工作区检查导致自动打包失败的问题，恢复正式 Release 的定时检查和候选构建。
- 下载 **Stronghold-Protocol-0.2.1-arm64-v8a.apk**，在一局结束后直接覆盖安装。沿用同一包名和签名；保留应用数据即可保留设置和调配，建议提前通过应用内入口导出备份。
- 安装包约 **654 MB**，首次启动需要解压内置资源，请预留足够存储空间。
- APK 文件名及安装界面显示版本 **0.2.1**，内部升级序号用于覆盖安装。

### 验证范围

本次已通过锁定源码测试、Android 构建检查、签名校验及 Android 16 / 16 KB 模拟器首次离线启动和界面重建。新版未安装到真机；完整真机对局、正式签名覆盖升级、双设备联机、Doze 和网络切换仍待验证，详见 [验证记录](https://github.com/L-xuanxiao/Stronghold-Protocol/blob/codex/android/mobile/VALIDATION.md)。当前对局没有跨进程存档，系统强停会结束对局。

公开附件仅提供 APK，GitHub 显示附件 SHA256。构建锁定的游戏源码为 [v0.2.1 / c2a2ef7](https://github.com/sganggs/Stronghold-Protocol/tree/c2a2ef778cf728ff29b953b9842b2a39b1e9cbea)，Android 适配源码和锁文件见 [本次 Release 标签](https://github.com/L-xuanxiao/Stronghold-Protocol/tree/android-v0.2.1-100011/mobile)。完整构建输入和签名记录保留在维护者的备份草稿；本次公开 APK 与验证过的候选字节相同。

代码按 GPL-3.0-or-later 提供；游戏及第三方声明见 APK 内的 LICENSE、NOTICE.md 和 licenses/。明日方舟素材版权归原权利人，仅限非商业使用。本项目为非官方同人移植，与鹰角网络及 Yostar 无关。
