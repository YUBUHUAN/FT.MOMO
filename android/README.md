# Android APK

`MomoPet-Android-1.2.0.apk` 是一个极简 WebView 壳：它不内置服务端，连接电脑上运行的墨墨服务端。

## 安装后

1. 电脑打开墨墨，右键 →「个人页面」→「账号与同步」，记下地址，例如 `http://192.168.1.8:8787`。
2. 手机与电脑连同一个 Wi-Fi。
3. 打开 APK，填写地址并连接。
4. 登录电脑上同一个账号；首次也可以直接在手机上创建账号。
5. 右上角 ⚙ 可以随时修改电脑地址。

## 源码构建

需要：

- JDK 17
- Android SDK Platform 35
- Android Build Tools 35.0.0

不需要 Gradle。构建流程：

```bash
SDK="$ANDROID_SDK_ROOT"
BT="$SDK/build-tools/35.0.0"
JAVA_HOME=/path/to/jdk17
OUT=dist/MomoPet-Android-1.2.0.apk
mkdir -p android/build/{gen,classes,dex}

"$BT/aapt2" compile --dir android/res -o android/build/res.zip
"$BT/aapt2" link -o android/build/unsigned.apk \
  -I "$SDK/platforms/android-35/android.jar" \
  --manifest android/AndroidManifest.xml \
  -R android/build/res.zip --java android/build/gen --auto-add-overlay

find android/src android/build/gen -name '*.java' > android/build/sources.txt
"$JAVA_HOME/bin/javac" -encoding UTF-8 -source 17 -target 17 \
  -classpath "$SDK/platforms/android-35/android.jar" \
  -d android/build/classes @android/build/sources.txt

cd android/build/classes && "$JAVA_HOME/bin/jar" cf ../classes.jar . && cd -
"$BT/d8" --lib "$SDK/platforms/android-35/android.jar" --min-api 24 \
  --output android/build/dex android/build/classes.jar

cp android/build/unsigned.apk android/build/app.apk
cd android/build/dex && "$JAVA_HOME/bin/jar" uf ../app.apk classes.dex && cd -
"$BT/zipalign" -f 4 android/build/app.apk android/build/aligned.apk

# 第一次需要生成签名证书；之后的更新要使用同一个 keystore
"$JAVA_HOME/bin/keytool" -genkeypair -keystore android/keystore/momo.keystore \
  -storepass momopet123 -keypass momopet123 -alias momopet \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=MomoPet, OU=MomoPet, O=MomoPet, L=Local, ST=Local, C=CN"

"$BT/apksigner" sign --ks android/keystore/momo.keystore \
  --ks-pass pass:momopet123 --key-pass pass:momopet123 \
  --out "$OUT" android/build/aligned.apk
"$BT/apksigner" verify "$OUT"
```

> `android/keystore/` 不提交到仓库。发布新 APK 时必须继续使用同一个 keystore，否则 Android 会把它当成不同应用，需要先卸载旧版。当前仓库里的 `android/release/MomoPet-Android-1.2.0.apk` 是用本次构建的本地 keystore 签名的。
