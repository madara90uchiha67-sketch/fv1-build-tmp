package expo.modules.founderreminders

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle

/**
 * Actividad intermedia en otro proceso (:restart): arranca la app de nuevo y se cierra. Así el proceso
 * principal puede terminar sin llevarse consigo la actividad nueva.
 */
class RestartActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    @Suppress("DEPRECATION")
    val next: Intent? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra("next", Intent::class.java) else intent.getParcelableExtra("next")
    // Espera a que el proceso principal haya terminado (lo cierra a los 300 ms) antes de abrir la app; si se
    // abriera antes, la actividad nueva caería en el proceso viejo y moriría con él.
    android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
      if (next != null) startActivity(next)
      finish()
      overridePendingTransition(0, 0)
    }, 1300)
  }
}
