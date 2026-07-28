package expo.modules.notificationlistener

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS ↔ 네이티브 알림 리스너 사이의 얇은 다리.
 *
 * 알림 수집·전송은 전부 네이티브에서 끝나므로(앱이 꺼져 있어도 동작해야 하니까) 여기서는
 * 권한 상태 확인, 설정 화면 열기, 전송에 필요한 값 저장, 밀린 큐 비우기만 담당한다.
 */
class NotificationListenerModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("NotificationListener")

    /** "설정 > 알림 접근"에서 이 앱이 허용돼 있는지. 런타임 권한이 아니라 사용자가 직접 켜야 한다. */
    Function("isPermissionGranted") {
      val enabled = Settings.Secure.getString(
        context.contentResolver,
        "enabled_notification_listeners",
      ) ?: return@Function false

      enabled.split(":").any { entry ->
        ComponentName.unflattenFromString(entry)?.packageName == context.packageName
      }
    }

    /** 알림 접근 설정 화면을 연다. 사용자가 직접 토글해야 하므로 결과는 복귀 후 다시 확인해야 한다. */
    Function("openSettings") {
      val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    /** 로그인 직후 1회 호출 — 네이티브가 앱 없이도 전송할 수 있도록 값을 저장해 둔다. */
    Function("setIngest") { endpoint: String, secret: String, deviceId: String ->
      Ingest.setIngest(context, endpoint, secret, deviceId)
    }

    Function("isConfigured") { Ingest.isConfigured(context) }

    /** 전송에 실패해 쌓여 있던 알림을 다시 보낸다. 성공한 건수를 돌려준다. */
    AsyncFunction("flush") { Ingest.flushBlocking(context) }

    /** 온보딩 화면에서 "동작 중"임을 보여주기 위한 값. */
    Function("getStats") {
      mapOf(
        "queued" to Ingest.queueSize(context),
        "lastPostedAt" to Ingest.lastPostedAt(context).takeIf { it > 0 },
      )
    }
  }
}
