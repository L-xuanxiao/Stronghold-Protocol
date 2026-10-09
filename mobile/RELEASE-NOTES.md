本次 Android 版同步作者 **v0.2.2**。游戏和完整素材随 APK 提供，手机可独立离线单机运行，也可主动开启局域网联机。适用于 **ARM64 / Android 7.0 及以上**。

### 上游游戏更新

以下为相对上一 Android 版 v0.2.1 的主要变化，整理自作者 [v0.2.2 正式更新说明](https://github.com/sganggs/Stronghold-Protocol/releases/tag/v0.2.2)。

- **干员潜能与练度**：可分别设置潜能 1–6，以及未精英化、精英 1、精英 2、精英 2 Lv60；默认满潜能、精英 2 Lv60。调配列表改为每名干员一行，可直接选择技能和模组。
- **日文语音**：新增干员日文语音，可在设置中切换中文或日文；各阶段点击干员均可播放对应语音。完整语音资源已包含在 APK 中。
- **本机统计**：新增胜场、胜率、策略及对局记录，可查看最近 30 场结算；数据保存在本机浏览器存储中。
- **房间与反馈**：联盟房间可设置 AI 队友最后选择；设置中的反馈入口可复制本机诊断信息。
- **战斗规则与操作**：推拉造成的失衡期间，敌人不能移动、攻击或使用技能；整数秒攻击间隔和技力消耗不再多出一帧；拖动部署时预览模型显示在目标格。
- **内容与界面修复**：修正多名干员、敌人、首领、策略及战斗交互问题，完善显示与操作体验。

更完整的条目见作者 [v0.2.2 的 CHANGELOG](https://github.com/sganggs/Stronghold-Protocol/blob/v0.2.2/CHANGELOG.md)。感谢原作者及上游贡献者。

### Android 更新与安装

- 自动检查上游正式 Release 改为计划北京时间每天 **06:00、18:00**；没有新版本时跳过 APK 构建。GitHub 调度可能延迟；手机仍需下载新版 APK 并手动覆盖安装。
- 下载 **Stronghold-Protocol-0.2.2-arm64-v8a.apk**，在一局结束后直接覆盖安装。沿用同一包名和签名；保留应用数据即可保留设置和调配，建议提前通过应用内入口导出备份。
- 安装包约 **746 MB**，首次启动和升级需要额外的解压空间，请预留足够存储空间。
- APK 文件名及安装界面显示版本 **0.2.2**，内部升级序号用于覆盖安装。

### 验证范围

本次已通过锁定源码测试、Android 构建与单元检查、签名校验及 Android 16 / 16 KB 模拟器首次离线启动、进入大厅、WebSocket 和界面重建。新版未安装到真机；完整对局、新增语音实际听感、正式签名覆盖升级、双设备联机、Doze、网络切换及 Android 7.0 设备兼容性仍待验证，详见 [验证记录](https://github.com/L-xuanxiao/Stronghold-Protocol/blob/codex/android/mobile/VALIDATION.md)。当前对局没有跨进程存档，系统强停会结束对局。

公开附件仅提供 APK，GitHub 显示附件 SHA256。构建锁定的游戏源码为 [v0.2.2 / 62eb113](https://github.com/sganggs/Stronghold-Protocol/tree/62eb113419123d9a3a63606107bbf85230c5dd2f)，Android 适配源码和锁文件见 [本次 Release 标签](https://github.com/L-xuanxiao/Stronghold-Protocol/tree/android-v0.2.2-100013/mobile)。完整构建输入和签名记录保留在维护者的备份草稿；本次公开 APK 与验证过的候选字节相同。

代码按 GPL-3.0-or-later 提供；游戏及第三方声明见 APK 内的 LICENSE、NOTICE.md 和 licenses/。明日方舟素材版权归原权利人，仅限非商业使用。本项目为非官方同人移植，与鹰角网络及 Yostar 无关。
