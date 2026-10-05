# 可持续更新的离线 Android 版

## 需求与边界

- 在 L-xuanxiao/Stronghold-Protocol 的 codex/android 分支开发；master 跟随作者原版。
- 首版锁定作者 v0.1.2，复用 PR #7 的手机内置 Node 路线，不改游戏规则和协议。
- APK 包含全部资源；设置、昵称和干员调配可保留与导入导出；不实现跨进程对局存档。
- 默认离线单机，主动开启局域网联机后支持后台开服与停止通知。
- 保留运行游戏产生的 data/assets.json 本地改动，不将其加入提交。
- 自动检查正式 Release，生成候选 APK；发布前审核验证记录。2026-10-05 用户要求停止剩余真机测试并在完成后正式发布，公开附件仅 APK；未验证项目如实保留。

## 可验证计划

- [x] 查询作者 PR、Issue、Release 和相关 fork，确认可复用方案与已知缺陷。
- [x] 将 origin 指向用户 fork，保留作者 remote 为 upstream，创建 codex/android。
- [x] 实现标准 Gradle 工程及 Service/WebView 生命周期、模式切换、备份与恢复。
- [x] 实现隔离源码构建、完整素材准备、安全打包及原生运行时版本锁定和校验。
- [x] 实现每日更新检查、独立签名作业、草稿 Release 与验收后发布流程。
- [x] 执行上游测试和新增打包/更新测试，构建并签名 ARM64 APK。
- [x] 在模拟器验证离线游戏、生命周期、覆盖升级及 16 KB 页大小兼容性。
- [x] iQOO 15 / Android16 安装长期签名 ARM64 包，验证断网单人入局、选定干员模型和用户耳听。
- [ ] 真机完整结算、正式签名覆盖升级/备份、双设备联机、锁屏、Doze、网络切换（用户已终止剩余真机测试，保留待验证）。
- [x] 推送 fork，配置默认分支、启用工作流和长期签名 Secrets。
- [x] 云端候选流水线全链路通过，交付 APK、源码与验证记录，保留草稿状态。
- [ ] 将长期签名密钥目录备份到离线介质（需用户提供介质）。

### 2026-10-05 发布要求调整

- [x] 去掉 APK 文件名及安装界面版本文字中的内部升级序号；保留递增 versionCode 和长期签名。
- [ ] 更新包内版本检查及负向验证，重新构建、签名并验证实际 APK。
- [ ] 将源码、锁文件与运行时输入保留在构建备份草稿，公开 Release 仅提供 APK。
- [ ] 按用户明确授权正式发布，核对公开附件摘要、下载地址和验证记录；不恢复真机测试。

## 结果审查

实现与候选交付已完成，正式设备验收未完成。原工作树基线 bdb0765；手机已测试的首版单独锁定作者 v0.1.2 / 9d404199df76f862eff7385b82f952ab0498f4c5。2026-10-05 工作流自动检测并构建作者 v0.1.3 / a0a5419eb875fb24de62e4dfb32b78cfcb3090be，code100006 草稿已生成。保留工作树 data/assets.json 改动，不将其用于候选打包。fork 默认分支为 codex/android，两个 Android 工作流已启用，四项长期签名 Secrets 已配置。

- 完整 Node 测试：3493 通过、17 跳过；受限 Windows TEMP 导致的首轮目录切换错误，通过将测试临时目录放在仓库缓存并限制并发解决，未放宽测试断言。
- 锁定 v0.1.2 独立源码测试：3458 通过、10 跳过；1 项严格性能计时在并行负载下失败，同源码独占运行后通过（best 0.341 ms/tick，原阈值 0.5）。CI 改为文件串行运行，未修改游戏或断言。
- 移动端工具/更新/入口/候选检查 20 项全部通过；真实 SHA256、路径逃逸、损坏归档、16 KB ELF、运行时备份、签名版本门禁均有负向验证。
- 原有云端 CI 四组 Windows/Linux × Node22/24 全部通过；锁定 v0.1.2 云端源码测试 3458 通过、11 跳过、0 失败。
- 全部官方素材 ZIP 校验通过；模型、音效、字体、本地 3D 的 5995 项引用完整；安全 ZIP 可复现。
- ARM64、x86_64 原生运行时均锁定 Node 24.18.0，动态依赖闭包及 PT_LOAD 16 KB 对齐通过。
- 最终包包含 5795 文件、全套原版素材、三款补充离线字体/OFL 和完整 NOTICE.md；资源包 SHA256 d2f072c915773986ceef2791e7cd8cbe9b6bdde4114026c752d1742f60d0e077。
- ARM64 已生成长期签名 APK（429663926 bytes），APK 实际包名、versionCode=1、版本名、证书、签名和 SHA256 验证通过。Release/Debug 各 15 项单元测试通过；lint 0 errors / 5 warnings。
- Android 16 / API36 的最终模拟器包完整自动化通过：清数据断网首次解压、实际昵称进大厅、Activity 真正销毁/重建；PAGE_SIZE=16384，app PID6058、Node PID6135 前后相同，uptime5→10、sockets=1。证据 mobile/build/qa/smoke.json。
- 最终模拟器包覆盖安装后昵称、设置和干员调配保留；SAF 导出、修改再导入恢复三项数据实际通过。断网单人对局完成第 4 回合失败结算；模型显示、BGM 与三项音效解码通过，未做胜利通关。该覆盖验证为同签名 debug 包，正式签名递增版本覆盖仍待验证。
- 重复启动保持同一 app/Node；精确终止 Node 后自动恢复、偏好保留。测试监听器占端口时明确 EADDRINUSE，未加载伪造页面、未杀占用进程；移除测试监听器后正常重启。
- 模拟器开启局域网前台服务、通知停止入口、后台与息屏 48 秒保持同一 Node 通过；充电状态下 deviceidle 为 ACTIVE，不能算作 Doze 或双设备验收。
- Android CI 已修复 SDK 管理器路径、16 KB 镜像参数、内存配置与已弃用的图形后端；swangle 下完整构建、API36/16KB离线检查、签名及草稿生成全通过：[成功构建](https://github.com/L-xuanxiao/Stronghold-Protocol/actions/runs/37249560850)。固定实际通过验证的 Ubuntu24.04 宿主，保留失败诊断。
- 新 v0.1.3 云端源码测试 3611 通过、10 跳过、0 失败；移动工具 19 通过、1 个无缓存 wrapper 探针跳过，随后实际 Gradle 构建通过；Android 单元 15 通过、lint 0 errors / 5 warnings。原有四组 CI 当前构建提交全部通过。
- v0.1.3 资源 5799 文件、5995 项素材引用无缺失；断网首次启动与 Activity 销毁/重建后 app4012 / Node5087 不变、uptime6→10。ARM64 code100006 APK 429819574 bytes；[草稿](https://github.com/L-xuanxiao/Stronghold-Protocol/releases/tag/untagged-93987fb857173c609a5d)附完整源码、锁文件、版本记录、运行时备份及校验记录，未安装到手机。
- 下载候选后再次验证实际签名、包名/版本、minSDK24/target36、仅 ARM64 与 16 KB ZIP 对齐；SHA256=cb546ff035efd81a61b510237519e60c077ab1617be7fd7358fba2a5c51eef23 与签名作业及 GitHub 附件摘要一致，12 个草稿附件完整，汇总 mobile/build/qa/cloud-validation.json。
- 真机 iQOO 15 / Android16 已安装并运行长期签名 APK，实际页大小 4096；断网无默认网络、单人对局、选定干员模型已观察，背景音乐和音效由用户确认听得到。首次安装/解压时手机有网，不宣称真机清数据首次离线解压通过。
- 用户于 2026-10-04 明确终止后续真机测试；已停止手机操作和观察，不再等待结算或安装更高版本。2026-10-05 用户进一步授权完成后正式发布且仅提供 APK，未执行的验收仍保留待验证。发布确认改为审核验证记录及剩余项目，不假称全部真机验收通过。证据在忽略目录 mobile/build/qa/physical-validation.json；设备序列号与昵称不写入公开文档。

详细的验证范围和剩余门禁见 [移动端验证记录](../../mobile/VALIDATION.md)。

### 上游参考

- https://github.com/sganggs/Stronghold-Protocol/pull/7 （未合并）
- https://github.com/Fuhua-code/Stronghold-Protocol/releases/tag/0.1.1-connect
