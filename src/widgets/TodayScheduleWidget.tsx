// React Compiler가 이 파일을 메모이제이션 컴포넌트로 바꾸면 위젯 트리 빌더가 함수를 직접 호출하지
// 못해 "Invalid hook call"로 깨진다. 지금은 컴파일러가 꺼져 있지만 나중에 켜도 안전하도록 명시한다.
"use no memo";

import { FlexWidget, TextWidget } from "react-native-android-widget";
import { WEEKDAYS } from "../lib/calendar";
import type { WidgetSchedule } from "./storage";

/** app.json의 위젯 정의(name)와 반드시 같아야 한다 — 네이티브가 이 이름으로 태스크를 호출한다. */
export const WIDGET_NAME = "TodaySchedule";

// 갤럭시 One UI 위젯처럼 배경화면이 은은하게 비치는 반투명 카드. 너무 투명하면 사진 배경 위에서
// 글자가 묻히므로 라이트는 흰색 72%, 다크는 거의 검정 62% 정도로 깔아 가독성을 지킨다.
const THEME = {
  light: {
    card: "rgba(255, 255, 255, 0.72)",
    text: "#111111",
    muted: "#6b6b6b",
    accent: "#ef5b2b",
    pill: "rgba(239, 91, 43, 0.14)",
    bars: ["#ef5b2b", "#3b82f6", "#22a35a"],
  },
  dark: {
    card: "rgba(20, 20, 22, 0.62)",
    text: "#f5f5f5",
    muted: "#a3a3a3",
    accent: "#ff8256",
    pill: "rgba(255, 130, 86, 0.22)",
    bars: ["#ff8256", "#60a5fa", "#4ade80"],
  },
} as const;

type Theme = (typeof THEME)[keyof typeof THEME];

const HEADER_HEIGHT = 50;
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
  const d = new Date(`${date}T00:00:00`);

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel={`오늘 일정 ${schedules.length}건`}
      style={{
        height: "match_parent",
        width: "match_parent",
        backgroundColor: theme.card,
        borderRadius: 26,
        paddingHorizontal: 18,
        paddingVertical: 14,
        flexDirection: "column",
      }}
    >
      {/* 헤더: 큰 날짜 숫자 + 요일/월, 오른쪽에 건수 알약 */}
      <FlexWidget
        style={{
          width: "match_parent",
          flexDirection: "row",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <TextWidget
          text={String(d.getDate())}
          style={{ fontSize: 28, fontWeight: "700", color: theme.text, marginRight: 8 }}
        />
        <FlexWidget style={{ flexDirection: "column", flex: 1 }}>
          <TextWidget
            text={`${WEEKDAYS[d.getDay()]}요일`}
            style={{ fontSize: 12, fontWeight: "700", color: theme.accent }}
          />
          <TextWidget text={`${d.getMonth() + 1}월`} style={{ fontSize: 12, color: theme.muted }} />
        </FlexWidget>
        {schedules.length > 0 ? (
          <FlexWidget
            style={{ backgroundColor: theme.pill, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 3 }}
          >
            <TextWidget
              text={`${schedules.length}건`}
              style={{ fontSize: 12, fontWeight: "700", color: theme.accent }}
            />
          </FlexWidget>
        ) : null}
      </FlexWidget>

      {schedules.length === 0 ? (
        <TextWidget text="오늘은 일정이 없어요" style={{ fontSize: 13, color: theme.muted }} />
      ) : (
        <FlexWidget style={{ width: "match_parent", flexDirection: "column" }}>
          {shown.map((s, i) => (
            <FlexWidget
              key={s.id}
              style={{ width: "match_parent", flexDirection: "row", alignItems: "center", marginBottom: 6 }}
            >
              <FlexWidget
                style={{
                  width: 3,
                  height: 14,
                  borderRadius: 2,
                  backgroundColor: theme.bars[i % theme.bars.length],
                  marginRight: 8,
                }}
              />
              <TextWidget
                text={s.title}
                maxLines={1}
                truncate="END"
                style={{ fontSize: 13, color: theme.text }}
              />
            </FlexWidget>
          ))}
          {hiddenCount > 0 ? (
            <TextWidget
              text={`+${hiddenCount}건 더`}
              style={{ fontSize: 12, color: theme.muted, marginLeft: 11 }}
            />
          ) : null}
        </FlexWidget>
      )}
    </FlexWidget>
  );
}
