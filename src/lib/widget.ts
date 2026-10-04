// 앱 쪽에서 홈/잠금화면 위젯을 최신 상태로 유지하는 역할.
// 위젯 렌더링 자체는 src/widgets/widgetTaskHandler.tsx(headless)가 담당하고,
// 여기서는 "서버 → 캐시" 갱신과 "지금 당장 다시 그려라" 요청만 한다.

import { Platform } from "react-native";
import { requestWidgetUpdate } from "react-native-android-widget";
import { getSchedules } from "../api/schedules";
import { renderScheduleWidget } from "../widgets/render";
import { WIDGET_NAME } from "../widgets/TodayScheduleWidget";
import {
  WIDGET_CACHE_DAYS,
  WIDGET_PAST_DAYS,
  writeWidgetCache,
  type WidgetSchedule,
} from "../widgets/storage";
import { addDaysIso, toISO } from "./calendar";

/**
 * 오늘-WIDGET_PAST_DAYS부터 오늘+WIDGET_CACHE_DAYS까지의 일정을 받아 위젯 캐시에 저장하고 위젯을 다시 그린다.
 * 앱 포그라운드 복귀 / 일정 변경 / 백그라운드 푸시 때마다 호출된다.
 */
export async function syncWidget(): Promise<void> {
  if (Platform.OS !== "android") return;

  const today = toISO(new Date());
  const schedules = await getSchedules({
    from: addDaysIso(today, -WIDGET_PAST_DAYS),
    to: addDaysIso(today, WIDGET_CACHE_DAYS),
  });
  const items: WidgetSchedule[] = schedules.map((s) => ({ id: s.id, date: s.date, title: s.title }));
  await writeWidgetCache(items);

  await requestWidgetUpdate({
    widgetName: WIDGET_NAME,
    // 위젯마다 ‹ ›로 옮겨둔 날짜를 그대로 유지한 채 새 데이터로 다시 그린다.
    renderWidget: (info) => renderScheduleWidget(info.widgetId, info.height),
    // 홈/잠금화면에 위젯이 하나도 없으면 그릴 대상이 없다 — 캐시만 채워두면 되므로 조용히 넘어간다.
    widgetNotFound: () => {},
  });
}
