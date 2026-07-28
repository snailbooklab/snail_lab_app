import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

/**
 * 안드로이드 알림 접근(NotificationListenerService) 브릿지.
 *
 * iOS에는 다른 앱의 알림을 읽는 공개 API가 없다 — 우회가 아니라 기술적으로 제공되지 않는다.
 * 그래서 이 모듈은 안드로이드 전용이고, 다른 플랫폼에서는 모든 함수가 조용히 무동작한다.
 */

export type NotificationListenerStats = {
  /** 전송에 실패해 기기에 쌓여 있는 알림 수. */
  queued: number;
  /** 마지막으로 알림을 가로챈 시각(epoch ms). 한 번도 없으면 null. */
  lastPostedAt: number | null;
};

type NativeModule = {
  isPermissionGranted(): boolean;
  openSettings(): void;
  setIngest(endpoint: string, secret: string, deviceId: string): void;
  isConfigured(): boolean;
  flush(): Promise<number>;
  getStats(): NotificationListenerStats;
};

const native =
  Platform.OS === "android"
    ? requireOptionalNativeModule<NativeModule>("NotificationListener")
    : null;

/** 이 기기에서 알림 감지를 쓸 수 있는지 (= 안드로이드이고 네이티브 모듈이 붙어 있는지). */
export const isSupported = native !== null;

export function isPermissionGranted(): boolean {
  return native?.isPermissionGranted() ?? false;
}

/** "설정 > 알림 접근" 화면을 연다. 사용자가 직접 켜야 하므로 복귀 후 상태를 다시 확인할 것. */
export function openSettings(): void {
  native?.openSettings();
}

/**
 * 네이티브가 앱 없이도 서버에 보낼 수 있도록 전송 정보를 저장한다.
 * 로그인 직후 한 번 호출하면 되고, 값이 바뀌지 않으면 다시 부를 필요는 없다.
 */
export function setIngest(endpoint: string, secret: string, deviceId: string): void {
  native?.setIngest(endpoint, secret, deviceId);
}

export function isConfigured(): boolean {
  return native?.isConfigured() ?? false;
}

/** 밀려 있던 알림을 다시 전송하고 성공 건수를 돌려준다. 앱이 포그라운드로 돌아올 때 호출. */
export async function flush(): Promise<number> {
  return (await native?.flush()) ?? 0;
}

export function getStats(): NotificationListenerStats {
  return native?.getStats() ?? { queued: 0, lastPostedAt: null };
}
