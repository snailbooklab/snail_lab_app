// 네이티브(AppWidgetProvider)가 위젯을 다시 그려야 할 때 호출하는 headless JS 태스크.
// 앱이 완전히 종료된 상태에서도 실행되므로 여기서는 네트워크·인증에 의존하지 않는다.

import type { WidgetTaskHandlerProps } from "react-native-android-widget";
import { toISO } from "../lib/calendar";
import { readWidgetCache, schedulesOn } from "./storage";
import { TodayScheduleWidget, WIDGET_NAME } from "./TodayScheduleWidget";

export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  if (props.widgetInfo.widgetName !== WIDGET_NAME) return;

  switch (props.widgetAction) {
    case "WIDGET_ADDED":
    case "WIDGET_UPDATE":
    case "WIDGET_RESIZED": {
      // 날짜는 캐시가 아니라 렌더링 시점에 계산한다 — updatePeriodMillis 주기로 다시 그려지므로
      // 앱을 열지 않아도 자정이 지나면 알아서 다음 날 일정으로 넘어간다.
      const today = toISO(new Date());
      const cache = await readWidgetCache();
      props.renderWidget(
        TodayScheduleWidget({
          date: today,
          schedules: schedulesOn(cache, today),
          height: props.widgetInfo.height,
        }),
      );
      break;
    }

    // 클릭은 clickAction="OPEN_APP"으로 네이티브가 직접 앱을 열기 때문에 여기서 할 일이 없다.
    case "WIDGET_CLICK":
    case "WIDGET_DELETED":
      break;
  }
}
