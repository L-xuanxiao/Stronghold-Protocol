# Android 候选验证记录

首版游戏锁定作者 v0.1.2 / `9d404199df76f862eff7385b82f952ab0498f4c5`；包名 `io.github.strongholdprotocol.mobile`，长期签名证书指纹见 `signing.json`。当前为待验收候选，未正式发布。

## 已执行

| 检查 | 结果 | 范围与证据 |
| --- | --- | --- |
| 锁定源码的功能测试 | 3458 通过，10 跳过 | `.cache/mobile-reference/v0.1.2-locked-tests.log`；另 1 项性能计时并行时失败，独占复测通过 0.341 ms/tick，阈值未变 |
| 打包、更新、入口与发布门禁 | 通过 | `node --test test/mobile*.test.js`；含损坏 SHA/归档、目录逃逸、源目录隔离、签名/版本回退负向检查 |
| Android 单元测试 | Release/Debug 各 15 通过 | 解压完整性、非法路径/符号链接、坏更新保留旧目录、历史目录清理、强杀遗留 stage、偏好备份与数据资源策略 |
| Android lint | 0 errors / 5 warnings | 未添加 baseline；警告为横屏 API36、API 建议、中文字符串和固定构建版本提示 |
| 官方素材与字体 | 通过 | 5995 项原素材引用完整；字体固定官方提交与 SHA256，含 OFL；原 NOTICE.md 字节一致 |
| 原生组件 | 两 ABI 通过静态检查 | Node 24.18.0、依赖闭包、文件 SHA256 与 PT_LOAD 的 16 KB 对齐；ARM64 尚待真机运行 |
| APK 构建与签名 | 通过 | ARM64 APK 429663926 bytes，实际包名/versionCode/版本名、证书、签名、zipalign 与校验值均验证 |
| Windows 16 KB 模拟器冷启动 | 部分通过 | API36 / PAGE_SIZE=16384；首次断网启动、本地服务 health=0.1.2、sockets=1、标题页渲染成功；完整交互尚未通过 |

首次模拟器开机出现的 GMS/System UI 无响应对话框发生在游戏安装前；游戏自身未见 ANR。后续 Windows 宿主 `qemu-system-x86_64-headless.exe` 反复发生 access violation（0xc0000005），不能当作游戏进程崩溃，也不能据此宣称完整模拟器流程通过。使用独立测试环境和 Linux/KVM CI 继续验证。

## 仍待验证

- [ ] 最终 APK 在模拟器首次断网启动、真实游戏界面交互、Activity 销毁/重建与服务器 PID 连续。
- [ ] 最终包覆盖升级后昵称、设置、干员调配保留；系统文件选择器导出、修改后再导入恢复。
- [ ] 模拟器实际入局、完整单人对局、3D 模型、动画与音效播放。
- [ ] 服务崩溃恢复、重复启动、端口占用、实际空间不足和解压强杀恢复。
- [ ] iQOO 15 / Android16 真机上述流程。
- [ ] 两台设备同 Wi-Fi 联机、房主后台/锁屏、Doze、网络切换、通知停止。
- [ ] Android7/API24 与其他 WebView 版本兼容性。
- [ ] 长期签名密钥离线介质备份。

源码已实现相关失败路径；单元测试和静态检查不能代替以上设备验收。`Publish validated Android candidate` 只在真实设备门禁通过后使用；发布同一份经过验证的 APK。当前对局没有跨进程存档，强停或进程死亡会结束对局。
