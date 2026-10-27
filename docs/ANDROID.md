# Android 端

现在 Android 是**独立云 App**：安装 APK 后直接注册/登录，数据走 Supabase 云端，不再连接电脑的局域网服务端。

## APK

- 文件：`dist/MomoPet-Android-1.4.0.apk`
- 包名：`com.momopet.app`
- 最低 Android 7（API 24）
- 首次安装需要允许“安装未知应用”

### 第一次使用

1. 电脑打开墨墨，注册一个账号（用户名 + 密码）。
2. 手机安装 APK，打开后登录同一个账号。
3. 电脑和手机都联网即可；电脑关机不影响手机。

手机端不再需要填写 IP，也不需要和电脑同一 Wi-Fi。

## 云端结构

- 账号、密码哈希、token、宠物状态都在 Supabase；
- 所有读写走 `cloud/schema.sql` 里的 RPC，表不直接暴露；
- PC 端通过本地 Node 代理访问同一套 RPC；
- 手机端直接访问 Supabase REST/RPC。

## 构建 APK

源码在 `android/`，不需要 Gradle：

```bash
export ANDROID_SDK_ROOT=/path/to/android-sdk
export JAVA_HOME=/path/to/jdk17
bash tools/build-android-apk.sh
```

需要 JDK 17、Android SDK Platform 35、Build Tools 35.0.0。

## 签名

`android/keystore/` 不提交。更新 APK 必须继续使用同一个 keystore，否则 Android 会把它当成不同应用，需要先卸载旧版。

## 旧方式

旧版的「手机连电脑 8787」已经不再使用；如果只想临时在手机浏览器打开旧服务端，仍可访问 `http://电脑IP:8787/`，但正式使用请安装 APK。
