// 서버의 schedules가 바뀌었을 때(또는 바뀌었을 수 있을 때) 기기 쪽 파생 상태를 전부 맞춘다.
// 파생 상태가 늘어나면 여기에만 추가하면 되므로 호출부(App, 뮤테이션 훅, 백그라운드 태스크)를
// 일일이 고칠 필요가 없다.

import { syncNotifications } from "./notifications";
import { syncWidget } from "./widget";

export async function resyncDevice(): Promise<void> {
  // 하나가 실패해도(권한 없음, 네트워크 오류 등) 나머지는 그대로 진행돼야 한다.
  const results = await Promise.allSettled([syncNotifications(), syncWidget()]);
  if (__DEV__) {
    results.forEach((r) => {
      if (r.status === "rejected") console.warn("[resync]", r.reason);
    });
  }
}
