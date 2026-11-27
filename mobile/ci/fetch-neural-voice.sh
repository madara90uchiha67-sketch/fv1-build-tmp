#!/usr/bin/env bash
# Descarga la voz masculina neuronal GRATUITA y sin conexión de Founder y la deja dentro del módulo nativo founder-speech:
#  · motor sherpa-onnx 1.12.20 (Apache-2.0), solo arm64-v8a
#  · modelo Piper es_MX-ald-medium (español de México, voz masculina, Apache-2.0)
# No hay APIs de pago ni claves. Cada descarga se verifica con SHA-256; si no coincide, se aborta.
set -euo pipefail
cd "$(dirname "$0")/../modules/founder-speech/android"
AAR_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.20/sherpa-onnx-1.12.20.aar"
AAR_SHA="e3905b1258b577d8d374db798618602ceaaff5805cbf9b356ab25267cd98144d"
MODEL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-es_MX-ald-medium.tar.bz2"
MODEL_SHA="c60cf7bc853eb01a875fba0756523fecf9d9f46c763b19785d223fc981fb4fb6"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fetch() { # url sha out
  curl -fsSL --retry 3 --max-time 600 -o "$3" "$1"
  echo "$2  $3" | sha256sum -c - >/dev/null || { echo "SHA-256 incorrecto para $1" >&2; exit 1; }
}
fetch "$AAR_URL" "$AAR_SHA" "$TMP/sherpa.aar"
fetch "$MODEL_URL" "$MODEL_SHA" "$TMP/model.tar.bz2"

mkdir -p "$TMP/aar" "$TMP/model" libs src/main/jniLibs/arm64-v8a src/main/assets/founder-voice
unzip -q "$TMP/sherpa.aar" -d "$TMP/aar"
tar -xjf "$TMP/model.tar.bz2" -C "$TMP/model"
M="$TMP/model/vits-piper-es_MX-ald-medium"

cp "$TMP/aar/classes.jar" libs/sherpa-classes.jar
cp "$TMP/aar/jni/arm64-v8a/libsherpa-onnx-jni.so" "$TMP/aar/jni/arm64-v8a/libonnxruntime.so" src/main/jniLibs/arm64-v8a/

A=src/main/assets/founder-voice
rm -rf "$A"; mkdir -p "$A/espeak-ng-data"
cp "$M/es_MX-ald-medium.onnx" "$A/model.onnx"
cp "$M/tokens.txt" "$A/tokens.txt"
# Solo el español de espeak-ng (fonemas): se descartan los diccionarios de los demás idiomas.
D="$M/espeak-ng-data"
cp "$D"/phondata "$D"/phondata-manifest "$D"/phonindex "$D"/phontab "$D"/intonations "$D"/es_dict "$A/espeak-ng-data/"
cp -r "$D"/lang "$D"/voices "$A/espeak-ng-data/"
# Marca de versión: la app copia los archivos al almacenamiento interno solo cuando cambia.
echo "ald-medium-1" > "$A/version.txt"
echo "Voz neuronal lista: $(du -sh "$A" | cut -f1) de modelo, $(du -sh src/main/jniLibs | cut -f1) de motor."
