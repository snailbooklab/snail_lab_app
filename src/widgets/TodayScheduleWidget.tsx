// React Compiler가 이 파일을 메모이제이션 컴포넌트로 바꾸면 위젯 트리 빌더가 함수를 직접 호출하지
// 못해 "Invalid hook call"로 깨진다. 지금은 컴파일러가 꺼져 있지만 나중에 켜도 안전하도록 명시한다.
"use no memo";

import { FlexWidget, TextWidget } from "react-native-android-widget";
import { WEEKDAYS } from "../lib/calendar";
import type { WidgetSchedule } from "./storage";

/** app.json의 위젯 정의(name)와 반드시 같아야 한다 — 네이티브가 이 이름으로 태스크를 호출한다. */
export const WIDGET_NAME = "TodaySchedule";

// 잠금화면 배경(사진) 위에 얹힐 수 있으므로 카드 배경을 불투명하게 깔아 가독성을 확보한다.
const THEME = {
  light: { card: "#fdf8f0", text: "#1f1b16", muted: "#8c8375", accent: "#ef5b2b", rule: "#e8dcc4" },
  dark: { card: "#241f1a", text: "#f7f1e6", muted: "#a99f8d", accent: "#ff8256", rule: "#3d352b" },
} as const;

type Theme = (typeof THEME)[keyof typeof THEME];

const HEADER_HEIGHT = 34;
const ROW_HEIGHT = 24;

export type TodayScheduleWidgetProps = {
  /** 오늘 날짜(YYYY-MM-DD) — 렌더링 시점에 계산해서 넘긴다. */
  date: string;
  schedules: WidgetSchedule[];
  /** 위젯 높이(dp) — 몇 줄까지 그릴지 결정한다. */
  height: number;
};

/** 위젯 높이에 맞춰 표시할 줄 수. 최소 1줄은 보장한다. */
function visibleRowCount(height: number): number {
  return Math.max(1, Math.floor((height - HEADER_HEIGHT) / ROW_HEIGHT));
}

function formatDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}

export function TodayScheduleWidget({ date, schedules, height }: TodayScheduleWidgetProps) {
  return {
    light: <WidgetBody date={date} schedules={schedules} height={height} theme={THEME.light} />,
    dark: <WidgetBody date={date} schedules={schedules} height={height} theme={THEME.dark} />,
  };
}

function WidgetBody({
  date,
  schedules,
  height,
  theme,
}: TodayScheduleWidgetProps & { theme: Theme }) {
  const rows = visibleRowCount(height);
  // 넘치는 게 있으면 마지막 줄은 "+n건 더"로 쓰므로 그만큼 목록을 줄인다.
  const overflows = schedules.length > rows;
  const shown = overflows ? schedules.slice(0, rows - 1) : schedules;
  const hiddenCount = schedules.length - shown.length;

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel={`오늘 일정 ${schedules.length}건`}
      style={{
        height: "match_parent",
        width: "match_parent",
        backgroundColor: theme.card,
        borderRadius: 20,
        paddingHorizontal: 14,
        paddingVertical: 10,
        flexDirection: "column",
      }}
    >
      <FlexWidget
        style={{
          width: "match_parent",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <TextWidget
          text={formatDate(date)}
          maxLines={1}
          style={{ fontSize: 14, fontWeight: "700", color: theme.text }}
        />
        <TextWidget
          text={schedules.length > 0 ? `${schedules.length}건` : ""}
          style={{ fontSize: 12, fontWeight: "600", color: theme.accent }}
        />
      </FlexWidget>

      <FlexWidget style={{ width: "match_parent", height: 1, backgroundColor: theme.rule, marginBottom: 6 }} />

      {schedules.length === 0 ? (
        <TextWidget text="오늘 일정 없음" style={{ fontSize: 13, color: theme.muted }} />
      ) : (
        <FlexWidget style={{ width: "match_parent", flexDirection: "column" }}>
          {shown.map((s) => (
            <TextWidget
              key={s.id}
              text={`· ${s.title}`}
              maxLines={1}
              truncate="END"
              style={{ fontSize: 13, color: theme.text, marginBottom: 3 }}
            />
          ))}
          {hiddenCount > 0 ? (
            <TextWidget
              text={`+${hiddenCount}건 더`}
              style={{ fontSize: 12, color: theme.muted }}
            />
          ) : null}
        </FlexWidget>
      )}
    </FlexWidget>
  );
}
