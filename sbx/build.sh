#!/bin/bash
set -e
cd ~ ; source ~/.setup_env 2>/dev/null || true
export JAVA_HOME=${JAVA_HOME:-$(dirname $(dirname $(readlink -f $(which java))))}
export ANDROID_HOME=${ANDROID_HOME:-$HOME/android-sdk}; export ANDROID_SDK_ROOT=$ANDROID_HOME
source ~/ks/env.sh
[ -f ~/pub.env ] && source ~/pub.env
cd $HOME/fv1-build-tmp/mobile
bash ci/fetch-neural-voice.sh
npm ci --no-audit --no-fund 2>&1 | tail -2
npm test 2>&1 | grep -E "^# (pass|fail)"
npx expo prebuild --platform android --no-install --clean 2>&1 | tail -3
python3 ci/firmar_release.py android/app/build.gradle 2>&1 | tail -2 || true
cd android && ./gradlew assembleRelease --no-daemon -Dorg.gradle.jvmargs=-Xmx3g -PreactNativeArchitectures=arm64-v8a 2>&1 | tail -25
echo BUILD_DONE
