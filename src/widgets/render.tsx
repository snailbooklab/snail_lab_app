// 위젯 한 개(widgetId)를 그리는 공통 로직 — headless 태스크(widgetTaskHandler)와 앱(syncWidget)이
// 같은 결과를 내도록 한 곳에 둔다. 위젯마다 ‹ ›로 옮겨둔 날짜가 다를 수 있다.

import { toISO } from "../lib/calendar";
import { readWidgetCache, readWidgetDate, schedulesOn } from "./storage";
import { TodayScheduleWidget } from "./TodayScheduleWidget";

export async function renderScheduleWidget(widgetId: number, height: number, date?: string) {
  // 날짜는 캐시가 아니라 렌더링 시점에 계산한다 — updatePeriodMillis 주기로 다시 그려지므로
  // 앱을 열지 않아도 자정이 지나면 알아서 다음 날 일정으로 넘어간다.
  const today = toISO(new Date());
  const shown = date ?? (await readWidgetDate(widgetId, today));
  const cache = await readWidgetCache();
  return TodayScheduleWidget({ date: shown, today, schedules: schedulesOn(cache, shown), height });
}
