# Android APK（独立云同步版）

`MomoPet-Android-1.4.2.3.apk` 是独立 App：内置 `web/` 页面和 `shared/` 引擎，直接连接 Supabase 云端。不需要电脑 IP，也不需要同一 Wi-Fi。

## 使用

1. 安装 APK（首次可能需要允许“安装未知应用”）。
2. 打开后直接注册或登录账号。
3. 电脑端登录同一个账号即可同步。
4. 手机和电脑都能各自使用；电脑关机不影响手机。

## 源码构建

需要 JDK 17、Android SDK Platform 35、Build Tools 35.0.0，不需要 Gradle。

```bash
export ANDROID_SDK_ROOT=/path/to/android-sdk
export JAVA_HOME=/path/to/jdk17
bash tools/build-android-apk.sh
```

脚本会：

- 把 `web/` 和 `shared/` 打包进 `android/assets/`；
- 注入 `android/cloud-config.js`；
- 用 `aapt2`、`javac`、`d8`、`zipalign`、`apksigner` 编译并签名；
- 输出 `dist/MomoPet-Android-1.4.2.3.apk`。

## 云配置

`android/cloud-config.js`：

```js
window.MOMO_CLOUD = {
  url: "https://cflewtmxgekfpusicnfx.supabase.co",
  key: "sb_publishable_...",
  device: "android"
};
```

这里的 key 是 Supabase 的 **publishable/anon 公开密钥**，不是 service_role 密钥。数据库表不直接暴露，所有读写都走 `cloud/schema.sql` 里的 RPC 函数。

## 签名

`android/keystore/` 不提交到仓库。更新 APK 必须继续使用同一个 keystore，否则 Android 会把它当成不同应用，需要先卸载旧版。当前 `android/release/MomoPet-Android-1.4.2.3.apk` 用本地 keystore 签名。
