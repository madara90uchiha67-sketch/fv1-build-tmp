package expo.modules.founderaudio

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.view.WindowManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Enruta el audio de la llamada de voz. react-native-webrtc (Android) reproduce con el uso
 * "voz de comunicación", que por defecto sale por el auricular del teléfono (muy bajo). Este módulo
 * pasa la salida al altavoz, salvo que haya auriculares con cable, USB o Bluetooth conectados.
 */
class FounderAudioModule : Module() {
  private val audioManager: AudioManager?
    get() = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  override fun definition() = ModuleDefinition {
    Name("FounderAudio")

    Function("setSpeakerphoneOn") { on: Boolean -> route(on) }
    Function("reset") { route(false) }
    // Mantiene la pantalla encendida durante la llamada: con la pantalla apagada Android deja la app en
    // segundo plano, silencia el micrófono (Android 10+) y puede cortar la red.
    Function("setKeepScreenOn") { on: Boolean ->
      val activity = appContext.currentActivity
      if (activity == null) {
        false
      } else {
        activity.runOnUiThread {
          if (on) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
          else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        true
      }
    }
  }

  private fun route(on: Boolean): Boolean {
    val am = audioManager ?: return false
    return try {
      // La salida de «voz de comunicación» solo se puede elegir en modo de comunicación.
      if (on && am.mode != AudioManager.MODE_IN_COMMUNICATION) am.mode = AudioManager.MODE_IN_COMMUNICATION
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        if (!on) {
          am.clearCommunicationDevice()
          true
        } else {
          val devices = am.availableCommunicationDevices
          val headset = devices.any {
            it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
              it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
              it.type == AudioDeviceInfo.TYPE_USB_HEADSET ||
              it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
              it.type == AudioDeviceInfo.TYPE_BLE_HEADSET
          }
          if (headset) {
            true
          } else {
            val speaker = devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
            if (speaker == null) false else am.setCommunicationDevice(speaker)
          }
        }
      } else {
        @Suppress("DEPRECATION")
        val headset = am.isWiredHeadsetOn || am.isBluetoothScoOn || am.isBluetoothA2dpOn
        if (!headset || !on) {
          @Suppress("DEPRECATION")
          am.isSpeakerphoneOn = on
        }
        true
      }
    } catch (e: Exception) {
      false
    }
  }
}
