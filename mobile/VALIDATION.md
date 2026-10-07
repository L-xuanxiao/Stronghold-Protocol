# Android 验证与发布记录

当前[正式 Release](https://github.com/L-xuanxiao/Stronghold-Protocol/releases/tag/android-v0.1.4-100009)为 v0.1.4，内部 versionCode=100009；v0.2.1 候选已完成构建和签名，正式发布核验正在进行。包名 `io.github.strongholdprotocol.mobile`，长期签名证书指纹见 `signing.json`。手机实际测试的首版为 v0.1.2 / `9d404199df76f862eff7385b82f952ab0498f4c5`、code1；用户于 2026-10-04 终止剩余真机测试，之后的新包未安装到手机。

## 2026-10-07：v0.2.1 构建与发布

本轮锁定作者 `v0.2.1 / c2a2ef778cf728ff29b953b9842b2a39b1e9cbea`。[候选完整流水线](https://github.com/L-xuanxiao/Stronghold-Protocol/actions/runs/37636177991)已通过；用户要求不追加过多测试，并在当前检查通过后正式发布，仅公开 APK。未恢复真机操作。

| 检查 | 实际结果 |
| --- | --- |
| 上游完整源码测试 | 共 5162 项，5145 通过、17 跳过、0 失败；保持上游断言，文件串行执行 |
| 移动工具回归 | 共 21 项，20 通过、1 个无缓存 wrapper 探针跳过、0 失败；后续实际 Gradle 构建成功 |
| 原有四组 CI | [Windows/Linux × Node22/24](https://github.com/L-xuanxiao/Stronghold-Protocol/actions/runs/37636177943)全部通过 |
| Android 构建、单元与 lint | ARM64 Release、x86_64 Debug 构建通过；单元 15 通过、0 失败/跳过；lint 0 errors / 5 warnings |
| 完整资源 | 10204 文件 / 617434122 bytes，10246 项素材引用无缺失；ZIP SHA256=`2de40063d20a0c597910e9d0da26cc9b6d0eea456ca345a324b2412310def22c` |
| API36 / 16 KB 离线模拟器 | 清数据断网首次解压、实际昵称进入大厅、WebSocket 与 Activity 销毁/重建通过；app3556 / Node4719 不变，uptime7→13；未验证该版本完整对局 |
| APK 签名及对齐 | ARM64 APK 653555382 bytes，内部 code100011；长期签名证书一致，签名作业实际验证签名和 ZIP 16 KB 对齐；SHA256=`0d331afc0696c807c5227e7049a487f19692d1b47785ecfcf799e73e7d1efa46`，与 GitHub 候选附件摘要相同 |
| 候选构建输入 | 12 个附件完整，含源码、锁文件、运行时输入和签名/摘要记录；正式发布时保留为 `inputs-android-v0.2.1-100011` 草稿 |
| 正式发布 | 待发布工作流再次核对同一 APK 的实际签名、包名、版本、校验值及公开唯一附件；不重新构建 APK |

本轮报告保存在忽略目录 `mobile/build/qa/update-20261007-cloud/`，构建日志为 `mobile/build/qa/update-20261007-build.log`，签名与资源元数据为 `mobile/build/qa/update-20261007-candidate/`。采用已有云端发布核验，不重复本地完整测试或新增设备测试。剩余真机对局、覆盖升级、双设备、Doze、网络切换和 API24 兼容性仍待验证。

## 已执行

| 检查 | 结果 | 范围与证据 |
| --- | --- | --- |
| 锁定源码的云端测试 | 3458 通过，11 跳过，0 失败 | [首轮 CI 的已通过源码步骤](https://github.com/L-xuanxiao/Stronghold-Protocol/actions/runs/37192230235)；Windows 负载下严格性能项曾失败，独占复测通过 0.341 ms/tick，原阈值 0.5 未变 |
| 新 v0.1.3 源码云端测试 | 3611 通过，10 跳过，0 失败 | [成功候选全流程](https://github.com/L-xuanxiao/Stronghold-Protocol/actions/runs/37249560850)，严格使用上述新标签和提交 |
| 原有 CI | 最终构建提交四组全部通过 | [Windows/Linux × Node22/24](https://github.com/L-xuanxiao/Stronghold-Protocol/actions/runs/37252774884) |
| 打包、更新、入口与发布门禁 | 最新本地和云端均 20 通过、0 跳过、0 失败 | `node --test test/mobile*.test.js`；含损坏 SHA/归档、目录逃逸、源目录隔离、签名/版本回退、旧长版本文字和备份草稿递增序号负向检查。首轮云端仅 wrapper 无缓存探针跳过，其后真实构建通过 |
| Android 单元测试 | Release/Debug 各 15 通过 | 解压完整性、非法路径/符号链接、坏更新保留旧目录、历史目录清理、强杀遗留 stage、偏好备份与数据资源策略 |
| Android lint | 0 errors / 5 warnings | 未添加 baseline；警告为横屏 API36、API 建议、中文字符串和固定构建版本提示 |
| 官方素材与字体 | 通过 | 5995 项原素材引用完整；字体固定官方提交与 SHA256，含 OFL；原 NOTICE.md 字节一致 |
| 原生组件 | 两 ABI 静态检查及各自设备运行通过 | Node 24.18.0、依赖闭包、文件 SHA256 与 PT_LOAD 的 16 KB 对齐；ARM64 真机运行，x86_64 在 16 KB 模拟器运行；真机实际为 4 KB 页 |
| 本地 v0.1.2 APK 构建与签名 | 通过 | ARM64 APK 429663926 bytes，实际包名/versionCode/版本名、证书、签名、zipalign 与校验值均验证 |
| v0.1.3 资源准备 | 通过 | 5799 文件 / 394722698 bytes，5995 项素材引用无缺失；资源 ZIP SHA256=`4b36ab57e926bed679fb91fdb8a66b80d680b22f88018cec77b62b088725214b` |
| v0.1.3 云端构建、签名与草稿 | 通过 | ARM64 APK 429819574 bytes，code100006；下载后再次验证实际签名/包名/版本、min24/target36、仅 ARM64、ZIP 16 KB 对齐和 SHA256=`cb546ff035efd81a61b510237519e60c077ab1617be7fd7358fba2a5c51eef23`；草稿共 12 个附件，含源码、锁文件、版本记录及运行时输入备份 |
| v0.1.3 云端 16 KB 离线启动与重建 | 通过 | API36 / PAGE_SIZE=16384；清数据断网准备资源、实际昵称进大厅、Activity 销毁/重建；app4012 / Node5087 不变，uptime6→10，sockets=1。`mobile/build/qa/cloud/build/qa/smoke.json`；不代表该版本真机完整对局通过 |
| 最终简洁版本包构建与模拟器 | 通过 | [新构建](https://github.com/L-xuanxiao/Stronghold-Protocol/actions/runs/37252774947)：上游 3611 通过/10 跳过、工具 20 通过、单元 15 通过、lint 0 errors/5 warnings；API36/PAGE_SIZE16384 清数据离线启动、实际进大厅和重建通过，app3937/Node4441 不变，uptime7→11。`mobile/build/qa/cloud-final/build/qa/smoke.json` |
| 正式 APK 显示、签名与附件 | 通过 | [发布作业](https://github.com/L-xuanxiao/Stronghold-Protocol/actions/runs/37253812838)公开前验证签名与实际 manifest，公开后断言唯一 APK 和相同摘要；下载后再次验证包名、versionName=0.1.3、内部code100007、min24/target36、ARM64、16 KB ZIP 对齐及长期证书；429819574 bytes，SHA256=`c939838a375aeaf62593d7ad63ebe00773f99fffa8ded38b2577c4121835e486` |
| 完整构建输入保留 | 通过 | 原候选改为 `inputs-android-v0.1.3-100007` 草稿，实际 12 个附件完整；公开 Release 仅 1 个 APK。保留源码、锁文件、签名/校验记录和运行时输入 |
| 正式发布后的运行时备份恢复 | 通过 | 实际选中上述备份草稿，运行 `mobile/ci/restore-runtime.mjs` 恢复 21 个输入，skipped/missing 均为空，kitMatchesCurrentLock=true；SHA 锁定与当前运行时一致 |
| 本地 v0.1.2 首次离线启动与界面重建 | 通过 | API36 / PAGE_SIZE=16384；断网清数据首次启动、实际昵称进大厅、Activity 真正销毁/重建；app PID6058、Node PID6135 不变，uptime5→10、sockets=1、昵称保留。`mobile/build/qa/smoke.json` |
| 本地 v0.1.2 覆盖安装与 SAF 备份 | 通过 | 同签名 debug 包覆盖安装，昵称/设置/隐现 S1 调配保留；系统 Downloads 导出、修改再导入后三项逐字一致；正式签名递增 versionCode 覆盖尚未验证 |
| 本地 v0.1.2 离线单人完整对局 | 模拟器一次失败结算闭环通过 | 实际 UI 购买、准备、战斗至第 4 回合 RESULT/eliminated，3 回合通过；未验胜利通关、全部关卡或真机完整结算 |
| 本地 v0.1.2 模型与音频 | 显示及解码通过 | 棋盘/敌人模型实际截图；WebAudio=running，BGM124.8秒与三项音效解码成功；模拟器禁用音频输出 |
| 重复启动与服务器崩溃 | 通过 | 三次 launcher 保持 app4764/node4836；仅杀4836后恢复至5700，app不变、设置保留；原对局不能恢复 |
| 端口占用 | 通过 | 测试监听器占32173且伪造health；应用明确EADDRINUSE，未加载FOREIGN页面、未杀占用者；精确清理后重启成功 |
| 模拟器局域网服务/后台/息屏/通知停止 | 基本流程通过 | 实际前台服务和通知入口；后台息屏 48 秒，Node6432 不变，uptime41→89；当时充电且 deviceidle=ACTIVE，未测试 Doze 或第二台设备加入 |
| iQOO 15 安装与本地服务 | 通过 | Android16 / API36 / ARM64 / PAGE_SIZE=4096；长期签名 code1 首次安装成功，原生服务监听127.0.0.1:32173，Release WebView 调试关闭；首次解压时手机有网 |
| iQOO 15 断网单人和选定模型 | 通过 | 用户手动关闭 Wi-Fi/移动数据后，无默认网络，健康接口与实际对局正常；已看到用户部署干员及所选棋盘/备战席模型；未观察完整结算 |
| iQOO 15 背景音乐与音效 | 用户耳听确认 | 用户回复“已断网，都可以”；该项来自用户确认，不作为自动听音或全部音效验证 |

首次模拟器开机出现的 GMS/System UI 无响应对话框发生在游戏安装前；游戏自身未见 ANR。Windows 软件渲染曾发生宿主 access violation（0xc0000005），host 渲染下完整检查通过。云端前台应用低内存回收通过 4096 MB RAM / 8192 MB 磁盘配置解决，之后旧图形后端仍出现宿主退出。2026-10-05 改用官方维护的 ANGLE 软件后端 `swangle`（[旧 `swiftshader_indirect` 已弃用](https://developer.android.com/studio/run/emulator-acceleration)）后，API36 / 16 KB 全流程通过；宿主固定为实际通过验证的 Ubuntu24.04。旧退出未取得内核堆栈，不将其具体故障机制写为已确认根因。

模拟器实际证据汇总：`mobile/build/qa/manual-validation.json`；真机证据汇总：`mobile/build/qa/physical-validation.json`；首轮候选汇总：`mobile/build/qa/cloud-validation.json`；正式包与发布/备份恢复汇总：`mobile/build/qa/release-validation.json`。原始报告与截图在 Git 忽略的构建目录，真机资料含设备标识和用户昵称，不直接提交或公开。表格记录本次执行结果，报告生成时的历史待验证项由本表后续记录补充。

## 交付与仍待验证

- [x] 云端构建与正式发布完成；公开 Release 仅提供简洁文件名 APK，源码、运行时输入和完整记录保留为构建备份草稿。
- [ ] 真机清数据首次离线解压、完整对局结算、更多模型/动画和关卡。
- [ ] 真机正式签名更高 versionCode 覆盖升级、设置/昵称/调配保留与 SAF 备份恢复。
- [ ] 实际空间不足和解压强杀恢复（已有单元验证，设备故障注入待执行）。
- [ ] 两台设备同 Wi-Fi 联机、房主后台/锁屏、Doze、网络切换、通知停止。
- [ ] Android7/API24 与其他 WebView 版本兼容性。
- [ ] 长期签名密钥离线介质备份。

用户终止真机测试后，上述设备项目不再继续执行。2026-10-05 用户进一步要求隐藏公开文件名和版本文字中的内部序号，并在完成后正式发布且仅提供 APK；新包已完成构建、签名、实际版本核对及正式发布。`Publish Android candidate` 的确认项为审核验证记录并接受未验证项目，不能将其写为全部设备验收通过。完整候选保留为 `inputs-` 构建备份草稿，公开同一份经过签名校验的 APK。当前对局没有跨进程存档，强停或进程死亡会结束对局。
