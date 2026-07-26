import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { getUpcomingReminders } from "../api/schedules";
import { upsertPushToken } from "../api/pushTokens";

// 안드로이드 채널은 한 번 생성되면 sound/vibration 설정이 고정된다(코드에서 바꿔도 무시).
// 소리·진동 설정을 바꿀 땐 반드시 ID를 새로 올려 새 채널을 만들어야 반영된다.
const CHANNEL_ID = "reminders-v2";
const OLD_CHANNEL_IDS = ["reminders"];

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** 알림 권한 요청 + (Android) 알림 채널 생성. 앱 시작 시 한 번 호출. */
export async function initNotifications(): Promise<void> {
  if (Platform.OS === "android") {
    // 설정이 고정된 옛 채널은 정리하고 새 채널로 교체한다.
    for (const old of OLD_CHANNEL_IDS) {
      await Notifications.deleteNotificationChannelAsync(old).catch(() => {});
    }
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "일정 알림",
      importance: Notifications.AndroidImportance.MAX,
      sound: "default", // 커스텀 음원 쓰려면 assets에 파일 넣고 파일명(확장자 포함)으로 지정 — EAS 빌드 필요, Expo Go 불가
      vibrationPattern: [0, 500], // [대기, 진동] ms — 진동 1회. 두 번 울리려면 [0, 500, 250, 500]처럼 늘린다.
      enableVibrate: true,
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing !== "granted") {
    await Notifications.requestPermissionsAsync();
  }
}

/**
 * 이 기기의 Expo push token을 서버에 등록한다 — schedules가 바뀔 때 서버가 이 토큰으로
 * "동기화해!" 신호(조용한 푸시)를 보낼 수 있게 하기 위함. 실패해도(Expo Go, 자격증명 미설정 등)
 * 앱 핵심 기능(로컬 알림)엔 영향 없으므로 조용히 무시한다.
 */
export async function registerPushToken(): Promise<void> {
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await upsertPushToken(data);
  } catch {
    // 푸시 토큰 등록은 보강 기능 — 실패해도 무시.
  }
}

/**
 * 서버의 remind_at 목록(미래 시각만)과 로컬 예약 알림을 동기화한다.
 * 서버가 유일한 소스이므로 기존 예약을 전부 취소하고 다시 예약하는 방식이 가장 단순하고 정확하다.
 */
export async function syncNotifications(): Promise<void> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") return;

  const upcoming = await getUpcomingReminders();

  await Notifications.cancelAllScheduledNotificationsAsync();

  for (const schedule of upcoming) {
    if (!schedule.remind_at) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: schedule.id,
      content: {
        title: "오늘 수업",
        body: schedule.title,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(schedule.remind_at),
        ...(Platform.OS === "android" ? { channelId: CHANNEL_ID } : {}),
      },
    });
  }
}

export type ScheduledAlarm = { id: string; title: string; date: Date | null };

/** 지금 이 순간 기기 OS에 실제로 예약된 로컬알람 목록(발동 시각 오름차순).
 *  프로덕션(실기기) 빌드에서도 앱 화면으로 확인할 수 있게 하려고 노출한다. */
export async function getScheduledAlarms(): Promise<ScheduledAlarm[]> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  return scheduled
    .map((n) => {
      // DATE 트리거의 시각은 플랫폼에 따라 date/value/timestamp 중 하나로 들어온다.
      const t = (n.trigger ?? {}) as { date?: number; value?: number; timestamp?: number };
      const ms = t.date ?? t.value ?? t.timestamp;
      return {
        id: n.identifier,
        title: n.content.body ?? n.content.title ?? "(제목 없음)",
        date: typeof ms === "number" ? new Date(ms) : null,
      };
    })
    .sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
}
