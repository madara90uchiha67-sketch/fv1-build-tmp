package expo.modules.founderspeech

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Process
import android.os.SystemClock
import android.content.SharedPreferences
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * Voz masculina de Founder, 100 % local y gratuita: modelo Piper «es_MX-ald» (español de México, voz de hombre, Apache-2.0)
 * ejecutado con sherpa-onnx. No usa red, claves ni servicios de pago.
 *
 * Es una voz de hombre real, no una voz de mujer con el tono bajado. Para que suene más grave y maduro se reproduce a una
 * frecuencia de muestreo algo menor (PLAYBACK_RATIO) y se compensa la velocidad al generar, de modo que el ritmo no cambia.
 * El audio se entrega por frases (la primera empieza a sonar sin esperar al resto).
 *
 * Todo el trabajo pesado va en un único hilo propio; las órdenes de «hablar» esperan a que el modelo esté cargado.
 */
class NeuralVoice(
  private val context: Context,
  private val emit: (String, Map<String, Any>) -> Unit,
  private val onUnavailable: (text: String, id: String, rate: Float) -> Unit,
  private val onReady: () -> Unit,
) {
  companion object {
    const val NAME = "founder-voz-masculina"
    const val PLAYBACK_RATIO = 0.92f
    private const val ASSET_DIR = "founder-voice"
  }

  enum class State { IDLE, PREPARING, READY, FAILED }

  @Volatile var state = State.IDLE
    private set
  @Volatile private var tts: OfflineTts? = null
  @Volatile private var track: AudioTrack? = null
  private val generation = AtomicInteger(0)
  private val guard: SharedPreferences = context.getSharedPreferences("founder_voice_guard", Context.MODE_PRIVATE)
  private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "founder-voz").also { it.priority = Thread.NORM_PRIORITY + 1 } }

  /** ¿Se puede intentar hablar con esta voz (lista o cargándose)? */
  fun usable(): Boolean = state == State.READY || state == State.PREPARING
  fun ready(): Boolean = state == State.READY

  /** Copia el modelo a almacenamiento interno (solo la primera vez o si cambia la versión) y lo carga. */
  fun prepare() {
    if (state != State.IDLE) return
    // Si la app se cerró en seco mientras esta voz generaba audio (fallo nativo), se cuenta. Dos cierres seguidos:
    // se deja de usar esta voz y se usa la del teléfono, para que la app deje de cerrarse.
    var crashes = guard.getInt("crashes", 0)
    if (guard.getBoolean("inflight", false)) {
      crashes += 1
      guard.edit().putInt("crashes", crashes).putBoolean("inflight", false).commit()
    }
    if (crashes >= 2) {
      state = State.FAILED
      onReady()
      return
    }
    state = State.PREPARING
    worker.execute {
      try {
        val dir = File(context.filesDir, ASSET_DIR)
        val assetVersion = context.assets.open("$ASSET_DIR/version.txt").use { it.readBytes().toString(Charsets.UTF_8).trim() }
        val marker = File(dir, ".version")
        if (!(marker.exists() && marker.readText().trim() == assetVersion && File(dir, "model.onnx").exists())) {
          dir.deleteRecursively()
          dir.mkdirs()
          copyAssets(ASSET_DIR, dir)
          marker.writeText(assetVersion)
        }
        val vits = OfflineTtsVitsModelConfig(
          model = File(dir, "model.onnx").absolutePath,
          tokens = File(dir, "tokens.txt").absolutePath,
          dataDir = File(dir, "espeak-ng-data").absolutePath,
        )
        val model = OfflineTtsModelConfig(vits = vits, numThreads = 4, debug = false, provider = "cpu")
        tts = OfflineTts(assetManager = null, config = OfflineTtsConfig(model = model, maxNumSentences = 1))
        state = State.READY
        onReady()
        warmUp()
      } catch (e: Throwable) {
        state = State.FAILED
        onReady()
      }
    }
  }

  /** Una síntesis corta y silenciosa al cargar: la primera respuesta real no paga la puesta en marcha del motor. */
  private fun warmUp() {
    val engine = tts ?: return
    try {
      guard.edit().putBoolean("inflight", true).commit()
      engine.generate("Hola.", 0, 1.0f)
      guard.edit().putBoolean("inflight", false).putInt("crashes", 0).commit()
    } catch (_: Throwable) {
      guard.edit().putBoolean("inflight", false).commit()
    }
  }

  private fun copyAssets(path: String, to: File) {
    val children = context.assets.list(path) ?: emptyArray()
    if (children.isEmpty()) {
      context.assets.open(path).use { input -> File(to.parentFile, to.name).outputStream().use { input.copyTo(it, 64 * 1024) } }
      return
    }
    to.mkdirs()
    for (c in children) copyAssets("$path/$c", File(to, c))
  }

  fun speak(text: String, id: String, rate: Float) {
    val mine = generation.incrementAndGet()
    silenceNow()
    // Un texto sin letras ni números (solo signos) puede hacer fallar el motor nativo: no se sintetiza.
    val clean = text.trim().take(700)
    if (clean.none { it.isLetterOrDigit() }) { emit("onSpeakDone", mapOf("id" to id, "stopped" to false)); return }
    worker.execute { run(clean, id, rate, mine) }
  }

  /** Corta el audio al instante. */
  fun stop() {
    generation.incrementAndGet()
    silenceNow()
  }

  /** Silencia al instante sin tocar el búfer desde otro hilo: el hilo de la voz es el único que pausa, vacía y libera el AudioTrack. */
  private fun silenceNow() {
    val t = track ?: return
    try { t.setVolume(0f) } catch (_: Throwable) {}
  }

  private fun buildTrack(modelRate: Int): AudioTrack {
    val rate = (modelRate * PLAYBACK_RATIO).toInt()
    val min = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT)
    return AudioTrack.Builder()
      .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
      .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_FLOAT).setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
      .setBufferSizeInBytes(maxOf(min, rate * 4 / 2))
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()
  }

  private fun run(text: String, id: String, rate: Float, mine: Int) {
    val engine = tts
    if (engine == null) { onUnavailable(text, id, rate); return }
    if (generation.get() != mine) { emit("onSpeakDone", mapOf("id" to id, "stopped" to true)); return }
    try { Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO) } catch (_: Throwable) {}
    val t = try { buildTrack(engine.sampleRate()) } catch (e: Throwable) { emit("onSpeakError", mapOf("id" to id, "code" to -10)); return }
    track = t
    var written = 0L
    var started = false
    try {
      guard.edit().putBoolean("inflight", true).commit()
      // La reproducción a menor frecuencia alarga el habla: se compensa generando más deprisa.
      val speed = (if (rate > 0.3f) rate else 1f) / PLAYBACK_RATIO
      engine.generateWithCallback(text, 0, speed) { samples ->
        if (generation.get() != mine) return@generateWithCallback 0
        if (!started) { started = true; t.play(); emit("onSpeakStart", mapOf("id" to id)) }
        var off = 0
        var stalls = 0
        while (off < samples.size) {
          if (generation.get() != mine) return@generateWithCallback 0
          // Escritura sin bloqueo: así se puede interrumpir en cualquier momento sin tocar el AudioTrack desde otro hilo.
          val n = t.write(samples, off, samples.size - off, AudioTrack.WRITE_NON_BLOCKING)
          if (n < 0) return@generateWithCallback 0
          if (n == 0) { if (++stalls > 1500) return@generateWithCallback 0; Thread.sleep(8) } else { stalls = 0; off += n }
        }
        written += samples.size
        1
      }
      if (started && generation.get() == mine) {
        t.stop() // reproduce lo que ya está en el búfer y se detiene
        val limit = SystemClock.elapsedRealtime() + 20_000
        while (generation.get() == mine && t.playbackHeadPosition < written && SystemClock.elapsedRealtime() < limit) Thread.sleep(15)
      }
      emit("onSpeakDone", mapOf("id" to id, "stopped" to (generation.get() != mine)))
    } catch (e: Throwable) {
      emit("onSpeakError", mapOf("id" to id, "code" to -11))
    } finally {
      guard.edit().putBoolean("inflight", false).putInt("crashes", 0).commit()
      if (track === t) track = null
      try { t.pause(); t.flush() } catch (_: Throwable) {}
      try { t.release() } catch (_: Throwable) {}
    }
  }

  fun shutdown() {
    generation.incrementAndGet()
    silenceNow()
    worker.execute { try { tts?.release() } catch (_: Throwable) {}; tts = null }
  }
}
