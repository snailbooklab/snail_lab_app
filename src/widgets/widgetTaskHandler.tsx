// 네이티브(AppWidgetProvider)가 위젯을 다시 그려야 할 때 호출하는 headless JS 태스크.
// 앱이 완전히 종료된 상태에서도 실행되므로 여기서는 네트워크·인증에 의존하지 않는다.

import type { WidgetTaskHandlerProps } from "react-native-android-widget";
import { addDaysIso, toISO } from "../lib/calendar";
import { renderScheduleWidget } from "./render";
import { clampWidgetDate, clearWidgetDate, readWidgetDate, writeWidgetDate } from "./storage";
import { GO_TODAY_ACTION, SHIFT_DAY_ACTION, WIDGET_NAME } from "./TodayScheduleWidget";

export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  if (props.widgetInfo.widgetName !== WIDGET_NAME) return;
  const { widgetId, height } = props.widgetInfo;

  switch (props.widgetAction) {
    case "WIDGET_ADDED":
    case "WIDGET_UPDATE":
    case "WIDGET_RESIZED":
      props.renderWidget(await renderScheduleWidget(widgetId, height));
      break;

    // ‹ › / 날짜 탭. 위젯 본문 클릭(OPEN_APP)은 네이티브가 직접 앱을 열기 때문에 여기로 오지 않는다.
    case "WIDGET_CLICK": {
      const today = toISO(new Date());
      let next: string | null = null;
      if (props.clickAction === SHIFT_DAY_ACTION) {
        const delta = Number(props.clickActionData?.delta) || 0;
        next = clampWidgetDate(addDaysIso(await readWidgetDate(widgetId, today), delta), today);
      } else if (props.clickAction === GO_TODAY_ACTION) {
        next = today;
      }
      if (next === null) break;
      await writeWidgetDate(widgetId, next, today);
      props.renderWidget(await renderScheduleWidget(widgetId, height, next));
      break;
    }

    case "WIDGET_DELETED":
      await clearWidgetDate(widgetId);
      break;
  }
}
