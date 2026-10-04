# Android 容器

使用 Gradle 8.13 / Android Gradle Plugin 8.13.2，Java 17 或更新版本。版本组合与 API 36.1 支持见 [Android 官方兼容表](https://developer.android.com/build/releases/agp-8-13-0-release-notes)。运行系统最低 Android 7.0（API 24），仅构建 64 位 ABI。

先用 mobile/tools 准备游戏与运行时，再从本目录执行：

```sh
./gradlew -PgameVersion=0.1.2 -PmobileVersionCode=1 -PgameAbi=arm64-v8a :app:testDebugUnitTest :app:assembleRelease
```

`gameAssetsDir` 默认 `mobile/build/assets`，其中必须包含 `game.zip` 与 `game-manifest.json`；`runtimeDir` 默认 `mobile/build/jniLibs`。两项属性也接受绝对路径。`compileSdk` 默认 `android-36`；本地仅安装 Android 36.1 时传 `-PcompileSdk=android-36.1`。`buildToolsVersion` 默认 `36.1.0`。

Release 输出未签名的 `app/build/outputs/apk/release/app-release-unsigned.apk`，签名由独立工具处理。Debug 使用仓库 `.cache/android-signing/debug.keystore`（alias `androiddebugkey`，密码 `android`），可用 `-PdebugKeystore=绝对路径` 指定；不要将密钥提交到仓库。

`NodeService` 独占 `/system/bin/linker64 <nativeLibraryDir>/libnode.so` 子进程。JNI 使用旧式打包并声明 `extractNativeLibs=true`，以便系统解压到可执行目录。网页只加载 `http://127.0.0.1:32173/`，保持 localStorage 来源稳定；外部导航交给系统浏览器，外部网页资源在 WebView 内禁止加载。APK 内资源先解压到新目录并检查每项大小和 SHA256，通过后才写入完整标记、切换 active；失败保留旧目录。成功升级只清理已验证的更老资源，保留当前版和上一版；未知目录及偏好数据不参与清理。

安装器在单个 Service 的工作线程串行运行。启动时清理严格匹配自身 UUIDv4 命名规则的中断 `.stage-*` 目录，回收强杀解压进程留下的临时文件；清理前检查整棵目录的 canonical 路径，符号链接和未知目录保留。CSS 所需的内联 SVG、图片、音频、字体 data URI 只允许作为子资源，主帧仍限定回环地址。

默认模式仅监听回环地址。主动开启局域网后监听 `0.0.0.0`，显示可停止的前台通知，并持有 `PARTIAL_WAKE_LOCK`。Android 14 以上前台服务使用 `connectedDevice` 类型，声明 `FOREGROUND_SERVICE_CONNECTED_DEVICE`；正常权限 `CHANGE_NETWORK_STATE` 满足该类型的网络设备前提，详见 [Android 官方要求](https://developer.android.com/develop/background-work/services/fgs/service-types#connected-device)。Android 13 以上从界面请求通知权限；用户拒绝时仍可从应用菜单停止服务。菜单提供系统电池设置入口，锁屏、Doze 与双设备连接仍需要真机验收。

健康检查确认 `/healthz.app` 与游戏版本一致，且有进行中的对局时拒绝切换模式。服务异常退出可自动恢复最多三次，对局本身不会恢复；划掉单机应用停止服务，局域网主机继续由通知管理。应用不会随开机自动启动。

原生备份通过 SAF 文件选择器读写，仅包含 `sp.name`、`sp.pref.settings`、`sp.pref.loadout`；文件限制 2 MB，schema 为 1，不包含重连令牌。导入验证通过后只修改这三项并刷新页面。WebView 标准文件选择器供游戏原有调配导入使用；原生备份提供调配的文件导出入口。
