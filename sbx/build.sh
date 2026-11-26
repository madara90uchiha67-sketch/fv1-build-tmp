#!/bin/bash
set -e
cd ~ ; source ~/.setup_env 2>/dev/null || true
export JAVA_HOME=${JAVA_HOME:-$(dirname $(dirname $(readlink -f $(which java))))}
export ANDROID_HOME=${ANDROID_HOME:-$HOME/android-sdk}; export ANDROID_SDK_ROOT=$ANDROID_HOME
cd /vercel/fv1-build-tmp && git pull -q
python3 sbx/decrypt.py tmp-bundle/bundle.json
source ~/ks/env.sh
cd mobile
npm ci --no-audit --no-fund 2>&1 | tail -2
npx expo prebuild --platform android --no-install --clean 2>&1 | tail -3
python3 ci/firmar_release.py android/app/build.gradle 2>&1 | tail -2 || true
echo "org.gradle.jvmargs=-Xmx3g" >> android/gradle.properties
cd android && ./gradlew assembleRelease --no-daemon -PreactNativeArchitectures=arm64-v8a 2>&1 | tail -15
echo BUILD_DONE
