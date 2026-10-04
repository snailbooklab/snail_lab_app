// 위젯 한 개(widgetId)를 그리는 공통 로직 — headless 태스크(widgetTaskHandler)와 앱(syncWidget)이
// 같은 결과를 내도록 한 곳에 둔다. 위젯마다 ‹ ›로 옮겨둔 날짜가 다를 수 있다.

import { getHolidays } from "../api/holidays";
import { toISO } from "../lib/calendar";
import { readWidgetCache, readWidgetDate, schedulesOn } from "./storage";
import { TodayScheduleWidget } from "./TodayScheduleWidget";

export async function renderScheduleWidget(widgetId: number, height: number, date?: string) {
  // 날짜는 캐시가 아니라 렌더링 시점에 계산한다 — updatePeriodMillis 주기로 다시 그려지므로
  // 앱을 열지 않아도 자정이 지나면 알아서 다음 날 일정으로 넘어간다.
  const today = toISO(new Date());
  const shown = date ?? (await readWidgetDate(widgetId, today));
  const cache = await readWidgetCache();
  // 공휴일은 앱이 받아둔 연도별 캐시에서 대부분 바로 나온다. 실패해도 위젯은 공휴일 없이 그린다.
  const holidays = await getHolidays(Number(shown.slice(0, 4))).catch(() => ({}) as Record<string, string>);
  return TodayScheduleWidget({
    date: shown,
    today,
    holiday: holidays[shown],
    schedules: schedulesOn(cache, shown),
    height,
  });
}
