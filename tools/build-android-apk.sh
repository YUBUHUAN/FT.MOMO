#!/usr/bin/env bash
# Build the standalone cloud Android APK without Gradle.
# Requires JDK 17 and Android SDK Platform 35 + Build Tools 35.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if command -v cygpath >/dev/null 2>&1; then
  ROOT="$(cygpath -m "$ROOT")"
fi
SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
JAVA="${JAVA_HOME:-}"
VERSION="1.7.0.8"
APK="$ROOT/dist/MomoPet-Android-$VERSION.apk"

if [ -z "$SDK" ] || [ ! -d "$SDK" ]; then
  echo "ANDROID_SDK_ROOT is not set" >&2
  exit 1
fi
if [ -z "$JAVA" ] || [ ! -x "$JAVA/bin/javac" ]; then
  echo "JAVA_HOME is not set" >&2
  exit 1
fi

export JAVA_HOME="$JAVA"
export PATH="$JAVA/bin:$PATH"

BT="$SDK/build-tools/35.0.0"
PLATFORM="$SDK/platforms/android-35/android.jar"
AAPT2="$BT/aapt2"
[ -x "$AAPT2" ] || AAPT2="$BT/aapt2.exe"
D8="$BT/d8"
[ -x "$D8" ] || D8="$BT/d8.bat"

for f in "$AAPT2" "$D8" "$BT/zipalign" "$BT/zipalign.exe" "$BT/apksigner" "$BT/apksigner.bat"; do
  [ -e "$f" ] || true
done

rm -rf "$ROOT/android/build" "$ROOT/android/assets"
mkdir -p "$ROOT/android/build/gen" "$ROOT/android/build/classes" "$ROOT/android/build/dex"
mkdir -p "$ROOT/android/assets/web" "$ROOT/android/assets/shared"
cp -R "$ROOT/web/." "$ROOT/android/assets/web/"
cp -R "$ROOT/shared/." "$ROOT/android/assets/shared/"
cp "$ROOT/android/cloud-config.js" "$ROOT/android/assets/web/js/cloud-config.js"

"$AAPT2" compile --dir "$ROOT/android/res" -o "$ROOT/android/build/res.zip"
"$AAPT2" link \
  -o "$ROOT/android/build/unsigned.apk" \
  -I "$PLATFORM" \
  --manifest "$ROOT/android/AndroidManifest.xml" \
  -R "$ROOT/android/build/res.zip" \
  --java "$ROOT/android/build/gen" \
  --auto-add-overlay

find "$ROOT/android/src" "$ROOT/android/build/gen" -name '*.java' > "$ROOT/android/build/sources.txt"
"$JAVA/bin/javac" -encoding UTF-8 -source 17 -target 17 \
  -classpath "$PLATFORM" \
  -d "$ROOT/android/build/classes" \
  @"$ROOT/android/build/sources.txt"

(cd "$ROOT/android/build/classes" && "$JAVA/bin/jar" cf ../classes.jar .)
"$D8" --lib "$PLATFORM" --min-api 24 --output "$ROOT/android/build/dex" "$ROOT/android/build/classes.jar"

cp "$ROOT/android/build/unsigned.apk" "$ROOT/android/build/app.apk"
(cd "$ROOT/android/build/dex" && "$JAVA/bin/jar" uf ../app.apk classes.dex)
(cd "$ROOT/android" && "$JAVA/bin/jar" uf "$ROOT/android/build/app.apk" assets)

ZIPALIGN="$BT/zipalign"
[ -x "$ZIPALIGN" ] || ZIPALIGN="$BT/zipalign.exe"
"$ZIPALIGN" -f 4 "$ROOT/android/build/app.apk" "$ROOT/android/build/aligned.apk"

mkdir -p "$ROOT/android/keystore"
KEYSTORE="$ROOT/android/keystore/momo.keystore"
if [ ! -f "$KEYSTORE" ]; then
  "$JAVA/bin/keytool" -genkeypair -keystore "$KEYSTORE" \
    -storepass momopet123 -keypass momopet123 -alias momopet \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=MomoPet, OU=MomoPet, O=MomoPet, L=Local, ST=Local, C=CN" >/dev/null
fi

APKSIGNER="$BT/apksigner"
[ -x "$APKSIGNER" ] || APKSIGNER="$BT/apksigner.bat"
"$APKSIGNER" sign --ks "$KEYSTORE" \
  --ks-pass pass:momopet123 --key-pass pass:momopet123 \
  --out "$APK" "$ROOT/android/build/aligned.apk"
"$APKSIGNER" verify "$APK"

echo "built $APK"
"$AAPT2" dump badging "$APK" | head -4
