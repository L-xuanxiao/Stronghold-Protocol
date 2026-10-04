# 可持续更新的离线 Android 版

## 需求与边界

- 在 L-xuanxiao/Stronghold-Protocol 的 codex/android 分支开发；master 跟随作者原版。
- 首版锁定作者 v0.1.2，复用 PR #7 的手机内置 Node 路线，不改游戏规则和协议。
- APK 包含全部资源；设置、昵称和干员调配可保留与导入导出；不实现跨进程对局存档。
- 默认离线单机，主动开启局域网联机后支持后台开服与停止通知。
- 保留运行游戏产生的 data/assets.json 本地改动，不将其加入提交。
- 自动检查正式 Release，生成候选 APK；真机验收后才正式发布。

## 可验证计划

- [x] 查询作者 PR、Issue、Release 和相关 fork，确认可复用方案与已知缺陷。
- [x] 将 origin 指向用户 fork，保留作者 remote 为 upstream，创建 codex/android。
- [x] 实现标准 Gradle 工程及 Service/WebView 生命周期、模式切换、备份与恢复。
- [x] 实现隔离源码构建、完整素材准备、安全打包及原生运行时版本锁定和校验。
- [x] 实现每日更新检查、独立签名作业、草稿 Release 与验收后发布流程。
- [x] 执行上游测试和新增打包/更新测试，构建并签名 ARM64 APK。
- [ ] 在模拟器验证离线游戏、生命周期、覆盖升级及 16 KB 页大小兼容性。
- [ ] 真机与双设备验证单人全局、联机、锁屏、Doze、网络切换。
- [ ] 推送 fork 并配置默认分支，记录交付路径、执行验证和未验证项。
- [ ] 将长期签名密钥目录备份到离线介质（需用户提供介质）。

## 结果审查

实施中。原工作树基线 bdb0765；APK 游戏源码单独锁定作者 v0.1.2 / 9d404199df76f862eff7385b82f952ab0498f4c5。保留工作树 data/assets.json 改动，不将其用于候选打包。GitHub keyring 认证已验证，fork 的四项长期签名 Secrets 已配置。

- 完整 Node 测试：3493 通过、17 跳过；受限 Windows TEMP 导致的首轮目录切换错误，通过将测试临时目录放在仓库缓存并限制并发解决，未放宽测试断言。
- 锁定 v0.1.2 独立源码测试：3458 通过、10 跳过；1 项严格性能计时在并行负载下失败，同源码独占运行后通过（best 0.341 ms/tick，原阈值 0.5）。CI 改为文件串行运行，未修改游戏或断言。
- 移动端工具/更新/入口/候选检查已通过；真实 SHA256、路径逃逸、损坏归档、16 KB ELF、运行时备份、签名版本门禁均有负向验证。
- 全部官方素材 ZIP 校验通过；模型、音效、字体、本地 3D 的 5995 项引用完整；安全 ZIP 可复现。
- ARM64、x86_64 原生运行时均锁定 Node 24.18.0，动态依赖闭包及 PT_LOAD 16 KB 对齐通过。
- 最终包包含 5795 文件、全套原版素材、三款补充离线字体/OFL 和完整 NOTICE.md；资源包 SHA256 d2f072c915773986ceef2791e7cd8cbe9b6bdde4114026c752d1742f60d0e077。
- ARM64 已生成长期签名 APK（429663926 bytes），APK 实际包名、versionCode=1、版本名、证书、签名和 SHA256 验证通过。Release/Debug 各 15 项单元测试通过；lint 0 errors / 5 warnings。
- Android 16 / API36 的 16 KB 模拟器实际 PAGE_SIZE=16384；软件渲染曾使 Windows qemu 宿主发生 0xc0000005，host 渲染下中间包完整自动化通过：首次断网启动、昵称进大厅、Activity 销毁/重建、同 Node PID/uptime、昵称保留。最终包覆盖升级与实际入局检查进行中。
- 真机信息：iQOO 15 / Android 16，当前未连接；真机与双设备仍待验收，未正式发布。

详细的验证范围和剩余门禁见 [移动端验证记录](../../mobile/VALIDATION.md)。

### 上游参考

- https://github.com/sganggs/Stronghold-Protocol/pull/7 （未合并）
- https://github.com/Fuhua-code/Stronghold-Protocol/releases/tag/0.1.1-connect
