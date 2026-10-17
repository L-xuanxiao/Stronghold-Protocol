# Android 验证与发布记录

当前[正式 Release](https://github.com/L-xuanxiao/Stronghold-Protocol/releases/tag/android-v0.2.6-100025)为 v0.2.6，内部 versionCode=100025、安装界面 versionName=0.2.6；仅上传 `Stronghold-Protocol-0.2.6-arm64-v8a.apk`，前一稳定 v0.2.4 及更早版本继续保留。包名 `io.github.strongholdprotocol.mobile`，长期签名证书指纹见 `signing.json`。手机实际测试的首版为 v0.1.2 / `9d404199df76f862eff7385b82f952ab0498f4c5`、code1；用户于 2026-10-04 终止剩余真机测试，本任务未继续向手机安装新包或执行真机测试。

## 2026-10-17：v0.3.0 补跑、资源容量兼容与发布

上游于北京时间 10 月 16 日 01:34 发布 v0.3.0，fork 最后 schedule 运行 [38584061065](https://github.com/L-xuanxiao/Stronghold-Protocol/actions/runs/38584061065)为 10 月 14 日 22:50，使用移除上游全量测试后的 ee1ff7f，正常检查并跳过构建。之后未见新的定时记录；Actions enabled、工作流 active、默认分支 codex/android、cron `0 10,22 * * *` 均正常。无法从公开 API 确认漏触发的具体平台原因；保留北京时间 06:00、18:00，后续定时恢复待观察，不将手动补跑当作修复 GitHub 调度的证据。

手动补跑 [38992246565](https://github.com/L-xuanxiao/Stronghold-Protocol/actions/runs/38992246565)锁定 `v0.3.0 / c24e17eec3af1e6dedfa9935a6d15245cf2f4586`，完整官方归档 840526600 bytes、SHA256=`5bf3cf3797902e8441aca211706630254c7ebb9636fa0baf301e6c179efcd5b7`。APK 编译成功，离线启动失败；实际资源报告为 31874 文件 / 1172281001 bytes，超过安装器原 30000 文件及 4 MiB 清单容量，同时旧提取规则未纳入新增 `data/local-fx.json`。

修复 3901b01c 将清单与 ZIP 文件数共用 60000 上限，清单有界容量为 16 MiB，保留 4 GiB 资源总量、路径/重复条目/符号链接/哈希/ZIP64 拒绝等校验；从官方归档提取特效索引并验证其素材引用。没有修改游戏规则、长期运行时或签名。

随后运行 38993437062 的资源已扩展为 31875 文件 / 1173502409 bytes、31610 项素材引用无缺失，但启动仍失败。运行 38994253051 增加仅调试包的启动错误日志，并在健康检查前处理首次全屏系统提示后，明确得到 `SP_ERROR: Cannot find module .../tools/assets/skel.mjs imported from .../server/plugins/pack.js`。修复 f044a029 只补齐服务器静态导入的 skel、anim-roles、atlas 三个工具文件，复用现有源码裁剪与拒绝链接的复制逻辑；真实 v0.3.0 裁剪目录已能发出 SP_READY，未将原仓库启动成功误当成打包目录完整的证明。

| 检查 | 实际结果 |
| --- | --- |
| 安装器本地回归 | 旧实现的 31874 文件 ZIP 与超过 4 MiB 清单两个对照均失败；修复后 12/12 通过，包含超过 60000 文件、超大清单、路径、链接、损坏更新和旧版本保留检查 |
| 移动工具本地回归 | 特效引用校验与缺失服务器解析器两个负向对照均失败；最终共 24 项，23 通过、1 个无 Gradle 缓存 wrapper 探针跳过、0 失败；真实裁剪目录启动就绪 |
| 上游全量测试 | 按用户要求未运行；不宣称验证上游全部游戏规则 |
| Android 构建、单元与 lint | ARM64 Release、x86_64 Debug 构建通过；单元 18 通过、0 失败/跳过；lint 0 errors / 5 warnings；云端移动工具 23 通过、1 个 wrapper 缓存探针跳过 |
| 完整资源 | 31878 文件 / 1173526785 bytes，31610 项素材引用无缺失；资源 ZIP SHA256=`8bd35ebf677b0b5bacb6264b71afd7e44fbb1ca3bf1842d95acd79a8944522c0`，包含官方特效清单和服务器素材解析器 |
| API36 / 16 KB / 8 GiB 离线模拟器 | 清数据断网首次解压、昵称进入大厅、WebSocket 和 Activity 真正销毁/重建通过；app3650 / Node3925 不变，uptime5→9、sockets=1 |
| 云端候选 | [38995166945](https://github.com/L-xuanxiao/Stronghold-Protocol/actions/runs/38995166945)全部成功，内部 code100030；12 个完整候选附件，含源码、实际锁文件、签名/摘要及运行时输入；机器人已写回 v0.3.0 锁文件 |
| APK 签名及对齐 | ARM64 APK 1214801590 bytes，长期证书一致，签名及 ZIP 16 KB 对齐通过；SHA256=`cffbce65c037db1581390329a27b7be692d61b52600df83cd22fad2832893bf4`，与候选附件摘要一致 |
| 正式发布 | 用户已明确授权完成后正式发布，仅 APK；尚未发布，保留当前稳定 v0.2.6 |

失败报告在忽略目录 `mobile/build/qa/update-20261017-failed-cloud/`、`update-20261017-fixed-failed-cloud/`、`update-20261017-diagnostic-cloud/`，对应本轮保存的失败和构建日志；直接 JVM 安装器对照与通过记录在 `mobile/build/qa/installer-unit/`，源码裁剪对照与真实启动记录为 `update-20261017-source-before.log`、`update-20261017-source-after.log`、`update-20261017-staged-startup.log`。本轮不操作真机；完整对局、官方特效/语音真机表现、插件导入导出/沙箱/跨升级保留、正式签名覆盖升级、双设备、Doze、网络切换及 API24/低内存设备兼容性仍待验证。

## 2026-10-14：v0.2.6 构建修复与发布

本轮开始时远端最新正式版为 v0.2.4 / `android-v0.2.4-100018`，v0.2.5 仅有候选草稿。本轮锁定作者 `v0.2.6 / 488db49f11daf862b67ce26fa4cf89aa6cba2466`，使用完整官方归档 583440026 bytes、SHA256=`8ad71ab1111438c483daddf3cba116d20058a5bb813d9a16eccef087a28e2866`。

失败基线：[10 月 13 日运行](https://github.com/L-xuanxiao/Stronghold-Protocol/actions/runs/38437528900)及[10 月 14 日运行](https://github.com/L-xuanxiao/Stronghold-Protocol/actions/runs/38492263596)均在 4 GiB / API36 / 16 KB 模拟器首次启动时，被 Android lowmemorykiller 杀掉前台应用（RSS 分别 315272/287968 KiB），随后等待服务器超时；后一轮上游 6335 通过、27 跳过、0 失败，工具 21 通过/1 跳过、Android 单元 15 通过、两种 ABI 的 APK 编译成功。宿主约 14.9 GiB 可用内存，未发生宿主 OOM；失败点属于模拟器内存压力，不是 APK 编译失败。

修复仅把 CI 模拟器 RAM 从 4 GiB 调为 8 GiB（16 GiB 宿主），保留 API36 / 16 KB 镜像、无外网清数据首次启动、完整资源校验、实际可见界面、WebSocket、Activity 真正销毁/重建及签名门禁。未更改游戏规则、运行时、签名或放宽超时；不将此修复作为低内存手机已验收的证据。配置检查和现有更新/权限/同步回归 5/5 通过。

[修复后的完整流水线](https://github.com/L-xuanxiao/Stronghold-Protocol/actions/runs/38562008092)已全部成功，内部 code100025；失败的启动门禁已在相同 API36 / 16 KB 镜像、相同游戏提交上通过。

| 检查 | 实际结果 |
| --- | --- |
| 上游源码测试 | 共 6362 项，6335 通过、27 跳过、0 失败；保持原有断言和串行执行 |
| 移动工具回归 | 共 22 项，21 通过、1 个无缓存 wrapper 探针跳过、0 失败；后续实际 Gradle 构建成功 |
| Android 构建、单元与 lint | ARM64 Release、x86_64 Debug 构建通过；单元 15 通过、0 失败/跳过；lint 0 errors / 5 warnings |
| 完整资源 | 13355 文件 / 784391863 bytes，13295 项素材引用无缺失；资源 ZIP SHA256=`4bb74a50990550606b687e03242614834431165e3425cae8e6a1350915ee9194` |
| API36 / 16 KB / 8 GiB 离线模拟器 | 清数据断网首次解压、昵称进入大厅、WebSocket 和 Activity 真正销毁/重建通过；app3574 / Node3810 不变，uptime8→12、sockets=1；未验证新版完整对局及官方场景的真机表现 |
| APK 签名及对齐 | ARM64 APK 821253814 bytes，内部 code100025；长期证书一致，签名作业通过；SHA256=`c420c8e5ea56add99ef50655a303c5dfc2513209bd357ec8fcd9ea20f394138b`，与候选附件摘要相同 |
| 候选构建输入 | 实际 12 个附件完整，含源码、锁文件、运行时输入和签名/摘要记录；正式发布时保留为 `inputs-android-v0.2.6-100025` 草稿 |
| 正式发布 | [发布工作流](https://github.com/L-xuanxiao/Stronghold-Protocol/actions/runs/38566599402)成功，实际核对签名、包名、版本及摘要；北京时间 2026-10-14 20:48:59 正式发布并设为 latest，公开唯一 APK 与候选摘要一致。源码标签指向 c57e997，含实际 v0.2.6 锁文件；上一稳定 v0.2.4 保留 |

诊断报告保存在忽略目录 `mobile/build/qa/update-20261014-failed-cloud/`、`mobile/build/qa/update-20261014-previous-failed-cloud/`，失败日志为 `mobile/build/qa/update-20261014-failed.log`；本轮成功报告为 `mobile/build/qa/update-20261014-cloud/`，构建日志 `mobile/build/qa/update-20261014-build.log`，候选元数据 `mobile/build/qa/update-20261014-candidate/`。不追加已被用户终止的真机测试；完整新版对局、官方场景及音频真机表现、正式签名覆盖升级、双设备、Doze、网络切换、API24 / 低内存设备兼容性仍待验证。

正式 Release 正文已逐字核对，与 `RELEASE-NOTES.md` 一致；12 个完整输入保留在 `inputs-android-v0.2.6-100025` 草稿。公开元数据与发布日志为 `mobile/build/qa/update-20261014-published.json`、`mobile/build/qa/update-20261014-publish.log`。发布使用已验证候选原字节，未再次构建或安装到手机；计划检查继续保持北京时间 06:00、18:00。

## 2026-10-09：v0.2.2 构建与发布

本轮锁定作者 `v0.2.2 / 62eb113419123d9a3a63606107bbf85230c5dd2f`。排查期间原有定时任务自动启动，[候选完整流水线](https://github.com/L-xuanxiao/Stronghold-Protocol/actions/runs/37922822606)全部通过，未重复触发构建。用户随后明确授权正式发布，只公开同一份 APK；未恢复真机操作。

| 检查 | 实际结果 |
| --- | --- |
| 上游完整源码测试 | 共 5706 项，5684 通过、22 跳过、0 失败；保持上游断言 |
| 移动工具回归 | 共 21 项，20 通过、1 个无缓存 wrapper 探针跳过、0 失败；后续实际 Gradle 构建成功 |
| Android 构建、单元与 lint | ARM64 Release、x86_64 Debug 构建通过；单元 15 通过、0 失败/跳过；lint 0 errors / 5 warnings |
| 完整资源 | 12897 文件 / 708709108 bytes，12920 项素材引用无缺失；资源 ZIP SHA256=`b091d95d862506a038e958b67ef727db81375c1e35ff23360103bb2e05f7a4fe` |
| API36 / 16 KB 离线模拟器 | 清数据断网首次解压、实际昵称进入大厅、WebSocket 与 Activity 销毁/重建通过；app3590 / Node4395 不变，uptime11→16、sockets=1；未验证新版完整对局及新增语音听感 |
| APK 签名及对齐 | ARM64 APK 745465526 bytes，内部 code100013；长期签名证书一致，签名作业实际验证签名和 ZIP 16 KB 对齐；SHA256=`f67345d11c97c059dce953a11b8dd8cee2dc3e5791975c377ed6f5f969038d13`，与 GitHub 候选附件摘要相同 |
| 候选构建输入 | 12 个附件完整，含源码、锁文件、运行时输入和签名/摘要记录；正式发布时保留为 `inputs-android-v0.2.2-100013` 草稿 |
| 自动更新配置 | 远端默认分支已确认 cron `0 10,22 * * *`，对应北京时间 06:00、18:00；更新选择与同步回归 4/4 通过，真实上游数据确认当前锁定 v0.2.2 时跳过重复构建；新时间点实际调度待观察，GitHub 不保证准点 |
| 正式发布 | [发布工作流](https://github.com/L-xuanxiao/Stronghold-Protocol/actions/runs/37926833460)通过：重新核对候选真实签名、包名、版本和校验值；公开唯一 APK 附件摘要一致。北京时间 2026-10-09 19:57 发布并设为 latest；源码标签指向 cf81695，包含本轮实际锁文件；保留上一稳定 v0.2.1，不重新构建 APK |

本轮报告保存在忽略目录 `mobile/build/qa/update-20261009-cloud/`，构建日志为 `mobile/build/qa/update-20261009-build.log`，签名与资源元数据为 `mobile/build/qa/update-20261009-candidate/`；公开元数据和发布核验日志分别为 `mobile/build/qa/update-20261009-published.json`、`mobile/build/qa/update-20261009-publish.log`。正式 Release 正文与本轮整理说明一致，12 个构建输入完整保留在备份草稿。仅复用已完成的云端构建及已有发布门禁，不追加真机测试或重复完整测试。剩余完整对局、新语音听感、正式签名覆盖升级、双设备、Doze、网络切换和 API24 设备兼容性仍待验证。

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
| 正式发布 | [发布工作流](https://github.com/L-xuanxiao/Stronghold-Protocol/actions/runs/37640478089)通过：重新核对候选实际签名、包名、版本和校验值；公开后唯一 APK 附件摘要一致。北京时间 2026-10-07 22:54 发布，`latest` 指向本版；公开源码标签含实际使用的 v0.2.1 锁文件，不重新构建 APK |

本轮报告保存在忽略目录 `mobile/build/qa/update-20261007-cloud/`，构建日志为 `mobile/build/qa/update-20261007-build.log`，签名与资源元数据为 `mobile/build/qa/update-20261007-candidate/`；公开元数据和发布核验日志分别为 `mobile/build/qa/update-20261007-published.json`、`mobile/build/qa/update-20261007-publish.log`。正式 Release 的正文与已整理说明一致，12 个构建输入完整保留在备份草稿。采用已有云端发布核验，不重复本地完整测试或新增设备测试。剩余真机对局、覆盖升级、双设备、Doze、网络切换和 API24 兼容性仍待验证。

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
