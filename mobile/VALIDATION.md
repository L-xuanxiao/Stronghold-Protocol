# Android 候选验证记录

本地首版为作者 v0.1.2 / `9d404199df76f862eff7385b82f952ab0498f4c5`，versionCode=1。2026-10-05 自动更新已生成 v0.1.3 / `a0a5419eb875fb24de62e4dfb32b78cfcb3090be`，versionCode=100006 的[草稿候选](https://github.com/L-xuanxiao/Stronghold-Protocol/releases/tag/untagged-93987fb857173c609a5d)。包名均为 `io.github.strongholdprotocol.mobile`，长期签名证书指纹见 `signing.json`，未正式发布。用户于 2026-10-04 终止剩余真机测试；已停止手机操作及观察，v0.1.3 未安装到手机。

## 已执行

| 检查 | 结果 | 范围与证据 |
| --- | --- | --- |
| 锁定源码的云端测试 | 3458 通过，11 跳过，0 失败 | [首轮 CI 的已通过源码步骤](https://github.com/L-xuanxiao/Stronghold-Protocol/actions/runs/37192230235)；Windows 负载下严格性能项曾失败，独占复测通过 0.341 ms/tick，原阈值 0.5 未变 |
| 新 v0.1.3 源码云端测试 | 3611 通过，10 跳过，0 失败 | [成功候选全流程](https://github.com/L-xuanxiao/Stronghold-Protocol/actions/runs/37249560850)，严格使用上述新标签和提交 |
| 原有 CI | 当前构建提交四组全部通过 | [Windows/Linux × Node22/24](https://github.com/L-xuanxiao/Stronghold-Protocol/actions/runs/37249560947) |
| 打包、更新、入口与发布门禁 | 本地 20 通过；云端 19 通过、1 跳过、0 失败 | `node --test test/mobile*.test.js`；含损坏 SHA/归档、目录逃逸、源目录隔离、签名/版本回退负向检查；云端跳过无缓存的 wrapper 探针，其后真实 Gradle 构建通过 |
| Android 单元测试 | Release/Debug 各 15 通过 | 解压完整性、非法路径/符号链接、坏更新保留旧目录、历史目录清理、强杀遗留 stage、偏好备份与数据资源策略 |
| Android lint | 0 errors / 5 warnings | 未添加 baseline；警告为横屏 API36、API 建议、中文字符串和固定构建版本提示 |
| 官方素材与字体 | 通过 | 5995 项原素材引用完整；字体固定官方提交与 SHA256，含 OFL；原 NOTICE.md 字节一致 |
| 原生组件 | 两 ABI 静态检查及各自设备运行通过 | Node 24.18.0、依赖闭包、文件 SHA256 与 PT_LOAD 的 16 KB 对齐；ARM64 真机运行，x86_64 在 16 KB 模拟器运行；真机实际为 4 KB 页 |
| APK 构建与签名 | 通过 | ARM64 APK 429663926 bytes，实际包名/versionCode/版本名、证书、签名、zipalign 与校验值均验证 |
| v0.1.3 资源准备 | 通过 | 5799 文件 / 394722698 bytes，5995 项素材引用无缺失；资源 ZIP SHA256=`4b36ab57e926bed679fb91fdb8a66b80d680b22f88018cec77b62b088725214b` |
| v0.1.3 云端构建、签名与草稿 | 通过 | ARM64 APK 429819574 bytes，code100006；下载后再次验证实际签名/包名/版本、min24/target36、仅 ARM64、ZIP 16 KB 对齐和 SHA256=`cb546ff035efd81a61b510237519e60c077ab1617be7fd7358fba2a5c51eef23`；草稿共 12 个附件，含源码、锁文件、版本记录及运行时输入备份 |
| v0.1.3 云端 16 KB 离线启动与重建 | 通过 | API36 / PAGE_SIZE=16384；清数据断网准备资源、实际昵称进大厅、Activity 销毁/重建；app4012 / Node5087 不变，uptime6→10，sockets=1。`mobile/build/qa/cloud/build/qa/smoke.json`；不代表该版本真机完整对局通过 |
| 最终包首次离线启动与界面重建 | 通过 | API36 / PAGE_SIZE=16384；断网清数据首次启动、实际昵称进大厅、Activity 真正销毁/重建；app PID6058、Node PID6135 不变，uptime5→10、sockets=1、昵称保留。`mobile/build/qa/smoke.json` |
| 最终模拟器包覆盖安装与 SAF 备份 | 通过 | 同签名 debug 包覆盖安装，昵称/设置/隐现 S1 调配保留；系统 Downloads 导出、修改再导入后三项逐字一致；正式签名递增 versionCode 覆盖尚未验证 |
| 离线单人完整对局 | 模拟器一次失败结算闭环通过 | 实际 UI 购买、准备、战斗至第 4 回合 RESULT/eliminated，3 回合通过；未验胜利通关、全部关卡或真机完整结算 |
| 模拟器模型与音频 | 显示及解码通过 | 棋盘/敌人模型实际截图；WebAudio=running，BGM124.8秒与三项音效解码成功；模拟器禁用音频输出 |
| 重复启动与服务器崩溃 | 通过 | 三次 launcher 保持 app4764/node4836；仅杀4836后恢复至5700，app不变、设置保留；原对局不能恢复 |
| 端口占用 | 通过 | 测试监听器占32173且伪造health；应用明确EADDRINUSE，未加载FOREIGN页面、未杀占用者；精确清理后重启成功 |
| 模拟器局域网服务/后台/息屏/通知停止 | 基本流程通过 | 实际前台服务和通知入口；后台息屏 48 秒，Node6432 不变，uptime41→89；当时充电且 deviceidle=ACTIVE，未测试 Doze 或第二台设备加入 |
| iQOO 15 安装与本地服务 | 通过 | Android16 / API36 / ARM64 / PAGE_SIZE=4096；长期签名 code1 首次安装成功，原生服务监听127.0.0.1:32173，Release WebView 调试关闭；首次解压时手机有网 |
| iQOO 15 断网单人和选定模型 | 通过 | 用户手动关闭 Wi-Fi/移动数据后，无默认网络，健康接口与实际对局正常；已看到用户部署干员及所选棋盘/备战席模型；未观察完整结算 |
| iQOO 15 背景音乐与音效 | 用户耳听确认 | 用户回复“已断网，都可以”；该项来自用户确认，不作为自动听音或全部音效验证 |

首次模拟器开机出现的 GMS/System UI 无响应对话框发生在游戏安装前；游戏自身未见 ANR。Windows 软件渲染曾发生宿主 access violation（0xc0000005），host 渲染下完整检查通过。云端前台应用低内存回收通过 4096 MB RAM / 8192 MB 磁盘配置解决，之后旧图形后端仍出现宿主退出。2026-10-05 改用官方维护的 ANGLE 软件后端 `swangle`（[旧 `swiftshader_indirect` 已弃用](https://developer.android.com/studio/run/emulator-acceleration)）后，API36 / 16 KB 全流程通过；宿主固定为实际通过验证的 Ubuntu24.04。旧退出未取得内核堆栈，不将其具体故障机制写为已确认根因。

模拟器实际证据汇总：`mobile/build/qa/manual-validation.json`；真机证据汇总：`mobile/build/qa/physical-validation.json`；当前候选云端与下载校验汇总：`mobile/build/qa/cloud-validation.json`。原始报告与截图在 Git 忽略的构建目录，真机资料含设备标识和用户昵称，不直接提交或公开。表格记录本次执行结果，报告生成时的历史待验证项由本表后续记录补充。

## 交付与仍待验证

- [x] 云端候选全链路完成，源码、运行时备份与 APK 已附于草稿；保持未正式发布。
- [ ] 真机清数据首次离线解压、完整对局结算、更多模型/动画和关卡。
- [ ] 真机正式签名更高 versionCode 覆盖升级、设置/昵称/调配保留与 SAF 备份恢复。
- [ ] 实际空间不足和解压强杀恢复（已有单元验证，设备故障注入待执行）。
- [ ] 两台设备同 Wi-Fi 联机、房主后台/锁屏、Doze、网络切换、通知停止。
- [ ] Android7/API24 与其他 WebView 版本兼容性。
- [ ] 长期签名密钥离线介质备份。

用户终止真机测试后，上述设备项目不再继续执行。2026-10-05 用户进一步要求隐藏公开文件名和版本文字中的内部序号，并在完成后正式发布且仅提供 APK；正在重建新包。`Publish Android candidate` 的确认项调整为审核验证记录并接受未验证项目，不能将其写为全部设备验收通过。完整候选保留为 `inputs-` 构建备份草稿，公开同一份经过签名校验的 APK。当前对局没有跨进程存档，强停或进程死亡会结束对局。
