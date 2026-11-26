#!/bin/bash
set -ex
cd ~
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openjdk-21-jdk-headless python3-cryptography unzip >/dev/null
export JAVA_HOME=$(dirname $(dirname $(readlink -f $(which javac))))
mkdir -p ~/android-sdk/cmdline-tools && cd ~/android-sdk/cmdline-tools
curl -sSLo c.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip -q c.zip && rm c.zip && mv cmdline-tools latest
export ANDROID_HOME=~/android-sdk
yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses >/dev/null 2>&1 || true
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" "build-tools;34.0.0" "ndk;27.1.12297006" "cmake;3.22.1" | tail -2
openssl genrsa -out ~/wrap.pem 3072 2>/dev/null; chmod 600 ~/wrap.pem
openssl rsa -in ~/wrap.pem -pubout -out ~/wrap.pub 2>/dev/null
echo "export JAVA_HOME=$JAVA_HOME ANDROID_HOME=$ANDROID_HOME ANDROID_SDK_ROOT=$ANDROID_HOME" > ~/.setup_env
echo SETUP_OK
