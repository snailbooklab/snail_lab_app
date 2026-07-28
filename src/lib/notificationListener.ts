import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Listener from "../../modules/notification-listener";

/**
 * 알림 감지(카톡·문자) 배선.
 *
 * 실제 수집·전송은 네이티브(NotificationListenerService)가 앱과 무관하게 수행한다. JS는
 * 전송에 필요한 값을 한 번 넘겨주고, 앱이 떠 있을 때 밀린 큐를 비우고, 권한 상태를 보여주는 역할만.
 */

const DEVICE_ID_KEY = "notification-listener/device-id";
const ONBOARDING_DISMISSED_KEY = "notification-listener/onboarding-dismissed";

export const isSupported = Listener.isSupported;

/** 기기 구분용 ID — 서버의 레이트리밋 단위이자 어느 폰에서 온 알림인지 구분하는 값. */
async function getDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

/**
 * 네이티브에 인제스트 정보를 심고 밀린 큐를 비운다. 로그인 후 앱 시작 시 호출.
 * 실패해도 앱의 핵심 기능(일정·알림)에는 영향이 없으므로 조용히 무시한다.
 */
export async function configureIngest(): Promise<void> {
  if (!Listener.isSupported) return;

  const endpoint = process.env.EXPO_PUBLIC_INGEST_ENDPOINT;
  const secret = process.env.EXPO_PUBLIC_INGEST_SECRET;
  if (!endpoint || !secret) {
    if (__DEV__) {
      console.warn(
        "[notificationListener] EXPO_PUBLIC_INGEST_ENDPOINT / EXPO_PUBLIC_INGEST_SECRET 미설정 — 알림 전송이 비활성화됩니다.",
      );
    }
    return;
  }

  try {
    Listener.setIngest(endpoint, secret, await getDeviceId());
    await Listener.flush();
  } catch (e) {
    if (__DEV__) console.warn("[notificationListener] 설정 실패:", e);
  }
}

/** 앱이 포그라운드로 돌아왔을 때 — 오프라인 동안 쌓인 알림을 마저 보낸다. */
export async function flushQueued(): Promise<number> {
  if (!Listener.isSupported) return 0;
  try {
    return await Listener.flush();
  } catch {
    return 0;
  }
}

export function isPermissionGranted(): boolean {
  return Listener.isPermissionGranted();
}

export function openNotificationAccessSettings(): void {
  Listener.openSettings();
}

export function getStats(): Listener.NotificationListenerStats {
  return Listener.getStats();
}

/** 권한 안내 화면을 이미 넘겼는지 — 매번 앱을 막지 않기 위해 기억해 둔다. */
export async function isOnboardingDismissed(): Promise<boolean> {
  return (await AsyncStorage.getItem(ONBOARDING_DISMISSED_KEY)) === "1";
}

export async function dismissOnboarding(): Promise<void> {
  await AsyncStorage.setItem(ONBOARDING_DISMISSED_KEY, "1");
}
