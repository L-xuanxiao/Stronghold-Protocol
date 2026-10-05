完整离线 Android APK，包含作者原版游戏、素材与手机内置 Node 运行时。支持 ARM64，最低 Android 7.0。

已通过自动化构建、签名检查和 Android16/16KB 模拟器离线启动。早期 v0.1.2 APK 在 iQOO15/Android16 通过断网入局、选定模型与用户听音确认；新版未安装到手机。用户终止剩余真机测试后要求正式发布，完整真机对局、正式签名覆盖升级、双设备联机、Doze 和网络切换仍待验证，详情见 [验证记录](https://github.com/L-xuanxiao/Stronghold-Protocol/blob/codex/android/mobile/VALIDATION.md)。当前对局不做跨进程存档，系统强停会结束对局。

下载 APK 后直接覆盖安装；请在当前对局结束后安装，保留应用数据。APK 文件名和安装界面版本文字仅显示游戏版本，内部升级序号独立递增。出现兼容问题时保留日志，使用同一签名、更高 versionCode 的恢复包。

正式 Release 附件仅为 APK，GitHub 显示该附件的 SHA256。对应源码可从本 Release 标签与源码仓库获取；完整构建记录、锁文件、上游源码及运行时输入保留在维护者的构建备份草稿。构建源码压缩包中的锁文件须以草稿同时附带的锁文件为准。

源代码：https://github.com/L-xuanxiao/Stronghold-Protocol

游戏原作者：https://github.com/sganggs/Stronghold-Protocol

Android 内置 Node 路线参考：https://github.com/sganggs/Stronghold-Protocol/pull/7

游戏与第三方组件声明见 APK 中的 LICENSE、NOTICE.md 和 licenses/。明日方舟素材权利归各权利人，仅限非商业使用。
