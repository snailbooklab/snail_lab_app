// 앱 쪽에서 홈/잠금화면 위젯을 최신 상태로 유지하는 역할.
// 위젯 렌더링 자체는 src/widgets/widgetTaskHandler.tsx(headless)가 담당하고,
// 여기서는 "서버 → 캐시" 갱신과 "지금 당장 다시 그려라" 요청만 한다.

import { Platform } from "react-native";
import { requestWidgetUpdate } from "react-native-android-widget";
import { getSchedules } from "../api/schedules";
import { TodayScheduleWidget, WIDGET_NAME } from "../widgets/TodayScheduleWidget";
import { WIDGET_CACHE_DAYS, writeWidgetCache, type WidgetSchedule } from "../widgets/storage";
import { toISO } from "./calendar";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 오늘부터 WIDGET_CACHE_DAYS일치 일정을 받아 위젯 캐시에 저장하고 위젯을 다시 그린다.
 * 앱 포그라운드 복귀 / 일정 변경 / 백그라운드 푸시 때마다 호출된다.
 */
export async function syncWidget(): Promise<void> {
  if (Platform.OS !== "android") return;

  const now = new Date();
  const today = toISO(now);
  const horizon = toISO(new Date(now.getTime() + WIDGET_CACHE_DAYS * DAY_MS));

  const schedules = await getSchedules({ from: today, to: horizon });
  const items: WidgetSchedule[] = schedules.map((s) => ({ id: s.id, date: s.date, title: s.title }));
  await writeWidgetCache(items);

  await requestWidgetUpdate({
    widgetName: WIDGET_NAME,
    renderWidget: (info) =>
      TodayScheduleWidget({
        date: today,
        schedules: items.filter((s) => s.date === today),
        height: info.height,
      }),
    // 홈/잠금화면에 위젯이 하나도 없으면 그릴 대상이 없다 — 캐시만 채워두면 되므로 조용히 넘어간다.
    widgetNotFound: () => {},
  });
}
