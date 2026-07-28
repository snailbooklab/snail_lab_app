package expo.modules.notificationlistener

import android.app.Notification
import android.content.ComponentName
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import org.json.JSONObject

/**
 * 카톡·문자 알림을 가로채 서버로 넘긴다.
 *
 * 여기서 하는 필터는 "앞으로 바뀔 일이 없고, 기기에만 있는 정보로 판단할 수 있는 것"뿐이다.
 * 강의 관련인지 가리는 키워드 규칙은 서버(lectureFilter.ts)에 있다 — 재빌드 없이 고치고,
 * 걸러진 것도 기록으로 남겨 "놓친 문의"를 관리자 페이지에서 확인할 수 있게 하기 위해서.
 */
class LectureNotificationListener : NotificationListenerService() {

  override fun onNotificationPosted(sbn: StatusBarNotification) {
    try {
      handle(sbn)
    } catch (e: Exception) {
      // 알림 처리 중 예외로 서비스가 죽으면 이후 알림을 통째로 놓친다.
      Log.w(TAG, "알림 처리 실패: ${e.message}")
    }
  }

  private fun handle(sbn: StatusBarNotification) {
    val pkg = sbn.packageName
    if (pkg !in WATCHED_PACKAGES) return                                  // ① 앱 화이트리스트

    val n = sbn.notification ?: return
    if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return          // ② 묶음 요약 알림
    if (n.flags and Notification.FLAG_ONGOING_EVENT != 0) return          // ③ 상시 표시 알림

    val extras = n.extras ?: return
    val sender = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
    val body = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
      ?: extras.getCharSequence(Notification.EXTRA_TEXT))
      ?.toString()?.trim().orEmpty()

    if (body.isEmpty()) return                                            // ④ 본문 없음
    if (body.length < MIN_BODY_LENGTH) return                             // ⑤ "ㅇㅇ" "넵" 이모티콘
    if (body.none { it in HANGUL_RANGE }) return                          // ⑥ 한글 없음

    // ⑦ 카톡은 같은 메시지를 갱신하며 여러 번 post 한다 → 분 단위로 잘라 해시.
    //    프로세스가 재시작되면 이 메모리 캐시는 비지만, 서버의 dedupe_key unique가 최종 방어선이다.
    val dedupeKey = Ingest.sha256("$pkg|$sender|$body|${sbn.postTime / 60_000}")
    if (!RecentKeys.markSeen(dedupeKey)) return

    val event = JSONObject()
      .put("appPackage", pkg)
      .put("sender", if (sender.isEmpty()) JSONObject.NULL else sender)
      .put("body", body.take(MAX_BODY_LENGTH))
      .put("postedAt", sbn.postTime)
      .put("dedupeKey", dedupeKey)

    Ingest.enqueue(this, event)
    Ingest.flushAsync(this)
  }

  /**
   * 시스템이 연결을 끊었을 때(삼성 절전, 앱 업데이트 등) 재연결을 요청한다.
   * 이게 없으면 며칠 뒤 조용히 수집이 멈추고, 사용자는 알아채지 못한다.
   */
  override fun onListenerDisconnected() {
    Log.w(TAG, "리스너 연결 끊김 — 재연결 요청")
    requestRebind(ComponentName(this, LectureNotificationListener::class.java))
  }

  override fun onListenerConnected() {
    Log.i(TAG, "리스너 연결됨")
    // 연결이 회복된 김에 밀려 있던 큐도 비운다.
    Ingest.flushAsync(this)
  }

  companion object {
    private const val TAG = "LectureNotifListener"

    /**
     * 강의 문의가 올 수 있는 앱만. 나머지는 여기 도달해도 즉시 버린다.
     *
     * ⚠️ 여기서 버린 알림은 아무 기록도 남지 않는다(서버에서 걸러진 것과 달리 관리자 페이지의
     * "필터 제외" 탭에도 안 뜬다). 다른 경로로 문의가 온다면 그 앱의 패키지명을 여기 추가해야 한다.
     */
    private val WATCHED_PACKAGES = setOf(
      "com.kakao.talk",                    // 카카오톡
      "com.samsung.android.messaging",     // 삼성 메시지
      "com.google.android.apps.messaging", // Google 메시지
      "com.android.mms",                   // 기본 문자 (구형)
      "com.nhn.android.band",              // 네이버 밴드
    )

    /**
     * 앱에서 버린 알림은 아무 기록도 남지 않으므로(서버에서 걸러진 것과 달리 "필터 제외" 탭에도
     * 안 뜬다) 이 하한은 오탐 위험이 0에 가깝게 잡아야 한다.
     * "강의문의"가 정확히 4자라 5로 두면 그것만 온 첫 연락을 놓친다. "ㅇㅇ"·"넵넵"은 2자라 여전히 걸린다.
     */
    private const val MIN_BODY_LENGTH = 4

    /** 서버 스키마의 body 상한과 맞춘다. */
    private const val MAX_BODY_LENGTH = 4000

    private val HANGUL_RANGE = '가'..'힣'
  }
}

/** 최근 처리한 dedupe key를 기억해 같은 알림의 반복 post를 걸러낸다. */
private object RecentKeys {
  private const val CAPACITY = 200
  private val seen = object : LinkedHashMap<String, Boolean>(CAPACITY, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Boolean>) =
      size > CAPACITY
  }

  /** 처음 보는 키면 true(처리해도 됨), 이미 본 키면 false. */
  @Synchronized
  fun markSeen(key: String): Boolean {
    if (seen.containsKey(key)) return false
    seen[key] = true
    return true
  }
}
