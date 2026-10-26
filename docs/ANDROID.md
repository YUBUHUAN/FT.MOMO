# Android 端

这一版 Android 使用 **PWA（可安装网页应用）**。它和 Windows 端共用同一套 `web/` 界面、同一个 Node 服务端和账号系统，因此登录同一个账号就能互通。

当前环境没有 Android SDK / JDK，**不能在这里直接产出 APK**；下面给出三种可用路径。

---

## 方案 A：直接当 PWA 用（最快，推荐）

1. 电脑启动墨墨（会自动启动同步服务端，默认端口 `8787`）。
2. 手机和电脑连同一个 Wi-Fi。
3. 电脑右键墨墨 → `个人页面` → `账号与同步`，记下局域网地址。
4. 手机 Chrome 打开：
   ```
   http://<电脑IP>:8787/
   ```
   例如 `http://192.168.1.8:8787/`。
5. 在手机登录**电脑上同一个账号和密码**。还没有账号的话，可以在手机上直接创建；每个账号的数据独立。
6. Chrome 菜单 → **添加到主屏幕**。

> 局域网 HTTP 页面在 Chrome 里不是“安全上下文”，所以 Service Worker / 离线缓存 / 真正的安装提示会被浏览器禁用；  
> 「添加到主屏幕」的快捷方式仍然可用，功能不受影响。需要完整体验请使用方案 C 或 HTTPS。

---

## 方案 B：Capacitor 包一层 APK（需要 Android Studio）

思路：APK 只是一个 WebView 外壳，直接加载电脑上的 `http://<电脑IP>:8787/`。  
适合“家里/宿舍固定电脑 + 手机同一 Wi-Fi”的使用方式。

### 环境

- Node.js 20+
- JDK 17
- Android Studio（含 Android SDK、Build Tools）
- 手机开启 USB 调试，或使用 Android Studio 模拟器

### 步骤

```bash
mkdir momopet-mobile && cd momopet-mobile
npm init -y
npm i @capacitor/core @capacitor/cli @capacitor/android

npx cap init "墨墨" com.momopet.app --web-dir=www
mkdir -p www
```

把 `www/index.html` 写成一个占位页（Capacitor 要求 webDir 存在）：

```html
<!doctype html><meta charset="utf-8"><title>墨墨</title>
```

配置 `capacitor.config.json`（把 IP 换成你电脑的局域网 IP）：

```json
{
  "appId": "com.momopet.app",
  "appName": "墨墨",
  "webDir": "www",
  "server": {
    "url": "http://192.168.1.8:8787/",
    "cleartext": true
  },
  "android": {
    "allowMixedContent": true
  }
}
```

```bash
npx cap add android
npx cap sync
npx cap open android
```

在 Android Studio 里：

1. 连接手机或启动模拟器；
2. `Build → Build Bundle(s) / APK(s) → Build APK(s)`；
3. 输出在 `android/app/build/outputs/apk/debug/app-debug.apk`。

正式发布需要在 `android/app/build.gradle` 配置签名，然后 `Generate Signed Bundle / APK`。

> 这个 APK 依赖电脑上的服务端；电脑关机或手机不在同一 Wi-Fi 时打不开。打开后仍需登录账号。  
> 如果要“手机独立运行、后台再同步”，需要把 `web/` 打包进 APK，并给 App 增加一个“服务器地址”设置页；当前版本没有做这个二次配置。

---

## 方案 C：`adb reverse` + localhost，获得完整 PWA 能力

如果只是想在这台电脑上把 PWA 完整装进手机（Service Worker、离线壳、安装提示），可以临时用 USB 把手机的 localhost 映射到电脑：

```bash
adb reverse tcp:8787 tcp:8787
```

然后手机 Chrome 打开：

```
http://localhost:8787/
```

`localhost` 属于安全上下文，浏览器会允许 Service Worker 和完整安装。  
注意：`adb reverse` 只在 USB 连接、且 adb 服务运行时有效；日常无线使用仍然建议方案 A 或 B。

---

## 和 PC 的同步边界

| 场景 | 是否同步 |
|---|---|
| PC 开着，手机与 PC 同一 Wi-Fi | ✅ 实时（SSE + 轮询） |
| PC 开着，手机用移动网络 | ❌ 手机打不开局域网地址 |
| PC 关机 | ❌ 手机无法连接这间小屋 |
| 另一台设备登录同一账号 | ✅ 实时同步 |
| 另一台设备登录不同账号 | ✅ 但进入各自独立的小屋 |
| 出游期间关掉手机/电脑 | ✅ 回来按时间戳结算 |

若需要公网同步，需要把 `server/` 部署到一台公网机器（带 HTTPS），并让两端访问同一个地址；当前桌面端默认连本机服务端，需要再做一次“服务器地址”配置。
