# Android 离线版

在 [L-xuanxiao/Stronghold-Protocol](https://github.com/L-xuanxiao/Stronghold-Protocol) 的 `codex/android` 分支维护。`master` 保留作者原版；打包不改动游戏规则和 `/ws` 协议。

## 使用

- 安装 ARM64 APK 后，首次启动会解压并校验内置游戏；此过程不需要网络。完整 APK 约 410 MiB，首次准备需额外约 800 MB 可用空间。
- 默认离线单机。点容器菜单开启局域网开服，将手机 IP 地址分享给同一 Wi-Fi 下的朋友，朋友在浏览器加入。
- 局域网开服时可切后台和锁屏，通知提供停止入口。长时间锁屏可能受系统省电限制影响，可从菜单进入系统电池设置。系统强停会结束正在进行的对局。
- 菜单提供设置/昵称/干员调配导出和导入。覆盖安装保留设置；卸载应用会删除应用数据，建议先导出。
- 不提供跨进程对局存档。启动失败时保留错误信息和日志，勿通过反复卸载解决。

## 本地构建

需要 Node.js >=22、Git、JDK21、Android SDK（platform36/36.1、build-tools36.1.0），Windows 解压 XZ 还需 Python3 或 xz。源码、素材与运行时都在隔离缓存中准备。

```powershell
git remote add upstream https://github.com/sganggs/Stronghold-Protocol.git # 已存在时跳过
git fetch upstream --tags
$env:JAVA_HOME='C:\Program Files\Java\jdk-21'
$env:ANDROID_HOME='D:\AndroidSdk'
node mobile/tools/prepare.mjs --abi=arm64-v8a
node mobile/tools/build.mjs --abi=arm64-v8a --release --no-prepare --sdk=D:/AndroidSdk
```

输出未签名 APK：`mobile/android/app/build/outputs/apk/release/app-release-unsigned.apk`。标准 Gradle 工程与参数说明见 [Android 工程说明](android/README.md)。模拟器另用 `--abi=x86_64` 准备和构建，手机发布包只包含 ARM64。

签名与完整性验证：

```powershell
node mobile/ci/create-signing-key.mjs # 首次生成；已有密钥只校验，不替换
$gameVersion=(Get-Content mobile/game.lock.json -Raw | ConvertFrom-Json).version
$outputApk="mobile/build/release/Stronghold-Protocol-$gameVersion-arm64-v8a.apk"
node mobile/ci/sign.mjs mobile/android/app/build/outputs/apk/release/app-release-unsigned.apk $outputApk
```

`mobile/keystore/` 被 Git 忽略，包含长期签名密钥和密码文件。**请把整个目录备份到离线介质**；缺失原密钥将无法给现有安装覆盖更新。公开的 `mobile/signing.json` 只包含签名证书指纹。正式版不要用临时 debug 密钥签名。

## 自动更新

`Android candidate` 工作流计划每天北京时间 12:17 同步作者原版 `master` 并检查正式 Release，也可手动运行。`master` 发生独立修改、无法正常同步时会报错，不强制覆盖历史。构建锁文件记录标签、完整提交和官方完整素材包 SHA256；无校验值、不完整素材或不兼容接口均使候选构建失败，不替换已发布的稳定 APK。

流程：检测正式版本 → 隔离源码与资源 → 上游测试 → ARM64 构建与 Android 单元测试/lint → Android16/16KB模拟器启动检查 → 独立作业签名 → 草稿 Release。构建作业不接触签名密钥；签名作业不执行游戏和 npm 安装脚本。

Android 工作流固定使用已通过全链路检查的 Ubuntu24.04，SDK/Gradle/运行时版本由锁文件及构建配置管理；升级构建环境时显式修改并重新验证。

手机上的游戏随 APK 覆盖安装更新：下载并校验新包，使用原包名和长期签名直接安装，保留应用数据。请在当前对局结束后安装；安装更新会重启应用，当前对局无法恢复。APK 内已包含完整素材，运行时无需下载游戏资源。

首次配置：启用 fork 的 Actions，将默认分支设为 `codex/android`，配置以下 Secrets：

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_PASSWORD`
- `ANDROID_KEY_ALIAS`

已有本地长期密钥可用 `node mobile/ci/configure-secrets.mjs L-xuanxiao/Stronghold-Protocol` 通过已登录的 GitHub CLI 上传，内容只走 stdin，不进入命令行或日志。

发布前审阅 [验证记录](VALIDATION.md)，运行 `Publish Android candidate`，输入候选标签并确认接受尚未验证的项目。工作流重新验证同一 APK 的 SHA256、实际签名和包内版本，核对候选标签，并拒绝发布低于已发布序号的包。完整候选转为 `inputs-` 前缀的构建备份草稿，正式 Release 仅上传同一份 APK，并核对公开附件摘要；发布步骤不重新构建。本次用户明确要求在终止剩余真机测试后正式发布，未验证项目仍保留。

每月提交一次检查记录，避免公开仓库长期无活动导致调度停用；仍保留手动运行入口。APK 文件名为 `Stronghold-Protocol-0.1.3-arm64-v8a.apk`，安装界面版本文字仅显示 `0.1.3`。内部 `versionCode` 取当前序号加一、已有发布/备份最大序号加一、100000加 Actions 运行序号三者中的最大值；失败构建也占用 Actions 序号，因此可以跳号。需要回退时，用上一稳定游戏锁文件生成更高 versionCode 的恢复包，保留包名与签名。

恢复包的具体操作：从上一稳定版对应的 `inputs-` 构建备份草稿下载 `game.lock.json`，替换并提交本分支的同名文件；手动运行 `Android candidate` 并勾选 `use_locked_game`。此入口跳过最新版本检测，按原稳定源码重新构建，同时分配更高的 versionCode。审核恢复包后按正常流程发布。

## 长期可重建的输入备份

Termux 包仓库会替换旧版本，单靠固定下载 URL 无法保证多年后重建。因此候选和 `inputs-` 构建备份草稿保留 `runtime-inputs.zip`，包含 SHA 锁定的原始运行时包和许可证；后续构建先从本 fork 的草稿恢复该备份，再按当前锁文件校验。草稿只对有权限的仓库维护者可见，正式 Release 仅提供 APK。

```powershell
node mobile/tools/runtime-inputs.mjs export --file=mobile/build/runtime-inputs.zip --offline
node mobile/tools/runtime-inputs.mjs import --file=下载的runtime-inputs.zip
```

升级运行时后可用 `--allow-partial` 恢复仍与当前锁文件一致的文件；导入不会替换锁文件，校验失败不会污染缓存。素材完整包、源码标签和包锁也需保留；备份草稿附完整源码与输入记录，公开源码可按正式 Release 标签和锁定的作者提交获取。

运行时版本由维护者单独更新：审查 `tools/lock-runtime.mjs` 中预期的 Node 版本与许可证来源，再显式运行 `node mobile/tools/lock-runtime.mjs --refresh`。新锁文件须通过依赖闭包、16 KB 对齐、两 ABI 构建及设备验收，随后保留新的 `runtime-inputs.zip`；日常游戏更新沿用已验证的运行时锁文件。

## 验证记录

自动模拟器检查是安装、离线服务、资源访问和 Activity 重进的检查，不能替代完整游戏和真实双设备联机验收。当前执行结果、未验证项见 [验证记录](VALIDATION.md) 与 [任务记录](../docs/tasks/todo.md)。

源码 GPL 声明、作者素材声明及第三方组件许可证随游戏包一起进入 APK。内置 Node 路线参考 [上游 PR #7](https://github.com/sganggs/Stronghold-Protocol/pull/7)；原作者与素材权利人的声明保持在 LICENSE/NOTICE 中。
