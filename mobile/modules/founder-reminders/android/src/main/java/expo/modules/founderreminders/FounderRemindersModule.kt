package expo.modules.founderreminders

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.app.NotificationManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class FounderRemindersModule : Module() {
  private val ctx: Context
    get() = appContext.reactContext ?: throw IllegalStateException("Sin contexto de la aplicación")

  override fun definition() = ModuleDefinition {
    Name("FounderReminders")

    Function("schedule") { id: String, triggerAt: Double, title: String, body: String ->
      ReminderStore.schedule(ctx, id, triggerAt.toLong(), title, body)
    }
    Function("cancel") { id: String -> ReminderStore.cancel(ctx, id); true }
    Function("cancelAll") { ReminderStore.cancelAll(ctx); ReminderStore.storeClear(ctx); true }
    Function("list") { ReminderStore.list(ctx) }
    Function("canNotify") { (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).areNotificationsEnabled() }
    Function("canScheduleExact") { ReminderStore.canScheduleExact(ctx) }
    Function("openExactAlarmSettings") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        launch(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${ctx.packageName}")))
      } else {
        false
      }
    }
    Function("openNotificationSettings") {
      launch(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName))
    }
    Function("storeSet") { key: String, value: String -> ReminderStore.storeSet(ctx, key, value); true }
    Function("storeGet") { key: String -> ReminderStore.storeGet(ctx, key) }
    // Ajustes de interfaz (tema). Archivo aparte: cancelAll/storeClear (cerrar sesión) no debe borrar el tema.
    Function("uiSet") { key: String, value: String ->
      ctx.getSharedPreferences("founder_ui", Context.MODE_PRIVATE).edit().putString(key, value).commit()
    }
    Function("uiGet") { key: String -> ctx.getSharedPreferences("founder_ui", Context.MODE_PRIVATE).getString(key, null) }
    // Reinicia la app con un proceso nuevo (para que todos los estilos tomen el tema elegido).
    Function("restartApp") {
      try {
        val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
        if (launch == null) {
          false
        } else {
          launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          val trampoline = Intent(ctx, RestartActivity::class.java)
          trampoline.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
          trampoline.putExtra("next", launch)
          ctx.startActivity(trampoline)
          android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({ android.os.Process.killProcess(android.os.Process.myPid()) }, 300)
          true
        }
      } catch (e: Exception) {
        false
      }
    }
  }

  private fun launch(intent: Intent): Boolean {
    return try {
      ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (e: Exception) {
      false // Sin pantalla de ajustes disponible.
    }
  }
}
