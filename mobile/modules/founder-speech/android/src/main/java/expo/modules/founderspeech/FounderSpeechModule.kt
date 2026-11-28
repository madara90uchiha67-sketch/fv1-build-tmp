package expo.modules.founderspeech

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Voz de Founder en el teléfono, sin servicios de pago ni claves:
 *  - Oído: reconocimiento de voz de Android. Con onDevice=true solo usa el reconocedor LOCAL (createOnDeviceSpeechRecognizer,
 *    Android 12+); si no existe, no se cae a la nube a escondidas: el código de error lo indica y la capa JS decide.
 *  - Voz: motor TextToSpeech del sistema, con selección de voz en español y tono grave ajustable.
 * Todo el trabajo con SpeechRecognizer y TextToSpeech se hace en el hilo principal.
 */
class FounderSpeechModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var recognizer: SpeechRecognizer? = null
  private var recognizerOnDevice = false
  private var tts: TextToSpeech? = null
  private var ttsReady = false
  private var voiceName: String? = null
  private var pendingSpeak: (() -> Unit)? = null

  private val context: Context?
    get() = appContext.reactContext

  override fun definition() = ModuleDefinition {
    Name("FounderSpeech")
    Events("onReady", "onBegin", "onEnd", "onPartial", "onResult", "onError", "onLevel", "onSpeakStart", "onSpeakDone", "onSpeakError", "onSupport", "onVoices")

    // ---- Reconocimiento ----
    Function("isOnDeviceAvailable") {
      val c = context
      when {
        c == null -> false
        Build.VERSION.SDK_INT >= 33 -> SpeechRecognizer.isOnDeviceRecognitionAvailable(c)
        else -> false
      }
    }

    Function("isSystemRecognizerAvailable") {
      val c = context
      c != null && SpeechRecognizer.isRecognitionAvailable(c)
    }

    Function("startListening") { lang: String, onDevice: Boolean ->
      main.post { startListeningMain(lang, onDevice) }
      true
    }

    Function("stopListening") {
      main.post { try { recognizer?.stopListening() } catch (_: Exception) {} }
      true
    }

    Function("cancelListening") {
      main.post { destroyRecognizer() }
      true
    }

    // Pregunta al reconocedor LOCAL qué idiomas tiene instalados/soportados (Android 13+). Responde con el evento onSupport.
    Function("checkSupport") { lang: String ->
      main.post { checkSupportMain(lang) }
      true
    }

    // Pide al sistema descargar el paquete de idioma sin conexión (Android 13+). La descarga la hace el sistema.
    Function("downloadModel") { lang: String ->
      if (Build.VERSION.SDK_INT < 33) {
        false
      } else {
        main.post {
          try {
            val c = context ?: return@post
            val r = SpeechRecognizer.createOnDeviceSpeechRecognizer(c)
            r.triggerModelDownload(buildIntent(lang))
            main.postDelayed({ try { r.destroy() } catch (_: Exception) {} }, 3000)
          } catch (_: Exception) {}
        }
        true
      }
    }

    // ---- Voz ----
    Function("speak") { text: String, id: String, pitch: Double, rate: Double ->
      main.post { speakMain(text, id, pitch.toFloat(), rate.toFloat()) }
      true
    }

    Function("stopSpeaking") {
      main.post { try { tts?.stop() } catch (_: Exception) {} }
      true
    }

    // Voces en español instaladas que no necesitan red (nombre técnico del motor).
    // Cada voz: nombre|idioma|calidad|requiere red (1/0)|características del motor (pueden indicar el género).
    Function("getSpanishVoices") { voiceEntries() }

    // Arranca el motor de voz con antelación (la primera respuesta no espera a que cargue) y avisa con las voces disponibles.
    Function("warmUp") {
      main.post {
        ensureTts { sendEvent("onVoices", mapOf("voices" to voiceEntries())) }
      }
      true
    }

    // Estado de la voz masculina local: "ready" | "preparing" | "failed" | "idle".
    Function("neuralStatus") { "idle" }

    Function("getVoice") { voiceName }

    Function("setVoice") { name: String ->
      voiceName = name
      true
    }

    OnDestroy {
      main.post {
        destroyRecognizer()
        try { tts?.stop(); tts?.shutdown() } catch (_: Exception) {}
        tts = null
        ttsReady = false
      }
    }
  }

  // ---------------- Reconocimiento ----------------

  private fun buildIntent(lang: String): Intent =
    Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
      putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 650L)
      putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 450L)
    }

  private fun destroyRecognizer() {
    try { recognizer?.cancel() } catch (_: Exception) {}
    try { recognizer?.destroy() } catch (_: Exception) {}
    recognizer = null
  }

  private fun startListeningMain(lang: String, onDevice: Boolean) {
    val c = context
    if (c == null) { sendEvent("onError", mapOf("code" to -1, "name" to "SIN_CONTEXTO", "onDevice" to onDevice)); return }
    destroyRecognizer()
    try {
      val r: SpeechRecognizer = if (onDevice) {
        if (Build.VERSION.SDK_INT < 33 || !SpeechRecognizer.isOnDeviceRecognitionAvailable(c)) {
          sendEvent("onError", mapOf("code" to 100, "name" to "SIN_RECONOCEDOR_LOCAL", "onDevice" to true))
          return
        }
        SpeechRecognizer.createOnDeviceSpeechRecognizer(c)
      } else {
        if (!SpeechRecognizer.isRecognitionAvailable(c)) {
          sendEvent("onError", mapOf("code" to 101, "name" to "SIN_RECONOCEDOR", "onDevice" to false))
          return
        }
        SpeechRecognizer.createSpeechRecognizer(c)
      }
      recognizerOnDevice = onDevice
      r.setRecognitionListener(listener)
      recognizer = r
      r.startListening(buildIntent(lang))
    } catch (e: Exception) {
      sendEvent("onError", mapOf("code" to 102, "name" to "EXCEPCION: ${e.javaClass.simpleName}", "onDevice" to onDevice))
    }
  }

  private fun sendSupport(available: Boolean, installed: List<String>, supported: List<String>, pending: List<String>, error: Int) {
    sendEvent("onSupport", mapOf("available" to available, "installed" to installed, "supported" to supported, "pending" to pending, "error" to error))
  }

  private fun checkSupportMain(lang: String) {
    val c = context
    if (c == null || Build.VERSION.SDK_INT < 33 || !SpeechRecognizer.isOnDeviceRecognitionAvailable(c)) {
      sendSupport(false, emptyList(), emptyList(), emptyList(), 0)
      return
    }
    try {
      val r = SpeechRecognizer.createOnDeviceSpeechRecognizer(c)
      r.checkRecognitionSupport(buildIntent(lang), c.mainExecutor, object : RecognitionSupportCallback {
        override fun onSupportResult(recognitionSupport: RecognitionSupport) {
          sendSupport(true, recognitionSupport.installedOnDeviceLanguages.toList(), recognitionSupport.supportedOnDeviceLanguages.toList(), recognitionSupport.pendingOnDeviceLanguages.toList(), 0)
          try { r.destroy() } catch (_: Exception) {}
        }
        override fun onError(error: Int) {
          sendSupport(true, emptyList(), emptyList(), emptyList(), error)
          try { r.destroy() } catch (_: Exception) {}
        }
      })
    } catch (e: Exception) {
      sendSupport(true, emptyList(), emptyList(), emptyList(), -1)
    }
  }

  private fun firstText(b: Bundle?): String =
    b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()

  private val listener = object : RecognitionListener {
    override fun onReadyForSpeech(params: Bundle?) { sendEvent("onReady", mapOf("onDevice" to recognizerOnDevice)) }
    override fun onBeginningOfSpeech() { sendEvent("onBegin", emptyMap<String, Any>()) }
    override fun onRmsChanged(rmsdB: Float) { sendEvent("onLevel", mapOf("db" to rmsdB.toDouble())) }
    override fun onBufferReceived(buffer: ByteArray?) {}
    override fun onEndOfSpeech() { sendEvent("onEnd", emptyMap<String, Any>()) }
    override fun onError(error: Int) { sendEvent("onError", mapOf("code" to error, "name" to errorName(error), "onDevice" to recognizerOnDevice)) }
    override fun onResults(results: Bundle?) { sendEvent("onResult", mapOf("text" to firstText(results), "onDevice" to recognizerOnDevice)) }
    override fun onPartialResults(partialResults: Bundle?) {
      val t = firstText(partialResults)
      if (t.isNotEmpty()) sendEvent("onPartial", mapOf("text" to t))
    }
    override fun onEvent(eventType: Int, params: Bundle?) {}
  }

  private fun errorName(code: Int): String = when (code) {
    1 -> "NETWORK_TIMEOUT"; 2 -> "NETWORK"; 3 -> "AUDIO"; 4 -> "SERVER"; 5 -> "CLIENT"
    6 -> "SPEECH_TIMEOUT"; 7 -> "NO_MATCH"; 8 -> "RECOGNIZER_BUSY"; 9 -> "INSUFFICIENT_PERMISSIONS"
    10 -> "TOO_MANY_REQUESTS"; 11 -> "SERVER_DISCONNECTED"; 12 -> "LANGUAGE_NOT_SUPPORTED"; 13 -> "LANGUAGE_UNAVAILABLE"
    else -> "DESCONOCIDO_$code"
  }

  // ---------------- Voz ----------------

  private fun ensureTts(then: () -> Unit) {
    if (ttsReady && tts != null) { then(); return }
    pendingSpeak = then
    if (tts != null) return
    val c = context ?: return
    tts = TextToSpeech(c, TextToSpeech.OnInitListener { status ->
      main.post {
        if (status == TextToSpeech.SUCCESS) {
          ttsReady = true
          tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) { sendEvent("onSpeakStart", mapOf("id" to utteranceId.orEmpty())) }
            override fun onDone(utteranceId: String?) { sendEvent("onSpeakDone", mapOf("id" to utteranceId.orEmpty(), "stopped" to false)) }
            @Deprecated("API antigua")
            override fun onError(utteranceId: String?) { sendEvent("onSpeakError", mapOf("id" to utteranceId.orEmpty(), "code" to -1)) }
            override fun onError(utteranceId: String?, errorCode: Int) { sendEvent("onSpeakError", mapOf("id" to utteranceId.orEmpty(), "code" to errorCode)) }
            override fun onStop(utteranceId: String?, interrupted: Boolean) { sendEvent("onSpeakDone", mapOf("id" to utteranceId.orEmpty(), "stopped" to true)) }
          })
          val p = pendingSpeak
          pendingSpeak = null
          p?.invoke()
        } else {
          sendEvent("onSpeakError", mapOf("id" to "", "code" to status))
        }
      }
    })
  }

  private fun allSpanishVoices(): List<Voice> =
    (tts?.voices ?: emptySet<Voice>())
      .filter { it.locale.language == "es" && !(it.features?.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) ?: false) }
      .sortedBy { it.name }

  private fun voiceEntries(): List<String> =
    allSpanishVoices().map { "${it.name}|${it.locale.toLanguageTag()}|${it.quality}|${if (it.isNetworkConnectionRequired) 1 else 0}|${(it.features ?: emptySet<String>()).joinToString(",")}" }

  private fun offlineSpanishVoices(): List<Voice> =
    (tts?.voices ?: emptySet<Voice>())
      .filter { it.locale.language == "es" && !it.isNetworkConnectionRequired && !(it.features?.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) ?: false) }
      .sortedBy { it.name }

  private fun speakMain(text: String, id: String, pitch: Float, rate: Float) {
    speakAndroid(text, id, pitch, rate)
  }

  private fun speakAndroid(text: String, id: String, pitch: Float, rate: Float) {
    ensureTts {
      val t = tts
      if (t == null) { sendEvent("onSpeakError", mapOf("id" to id, "code" to -2)); return@ensureTts }
      val voices = offlineSpanishVoices()
      // La voz elegida puede ser una de red (calidad alta, gratuita); si no hay elegida, solo se usan voces sin red.
      val chosen = allSpanishVoices().firstOrNull { it.name == voiceName }
        ?: voices.firstOrNull { it.locale.country.equals("CO", true) }
        ?: voices.firstOrNull { it.locale.country.equals("US", true) || it.locale.country.equals("MX", true) }
        ?: voices.firstOrNull()
      if (chosen == null) {
        // Sin voz local en español: se avisa; no se usan voces de red.
        sendEvent("onSpeakError", mapOf("id" to id, "code" to -3))
        return@ensureTts
      }
      t.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
      t.voice = chosen
      t.setPitch(pitch)
      t.setSpeechRate(rate)
      val r = t.speak(text, TextToSpeech.QUEUE_FLUSH, null, id)
      if (r != TextToSpeech.SUCCESS) sendEvent("onSpeakError", mapOf("id" to id, "code" to r))
    }
  }
}
