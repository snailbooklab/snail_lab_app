// React Compiler가 이 파일을 메모이제이션 컴포넌트로 바꾸면 위젯 트리 빌더가 함수를 직접 호출하지
// 못해 "Invalid hook call"로 깨진다. 지금은 컴파일러가 꺼져 있지만 나중에 켜도 안전하도록 명시한다.
"use no memo";

import { FlexWidget, TextWidget } from "react-native-android-widget";
import { addDaysIso, WEEKDAYS } from "../lib/calendar";
import { clampWidgetDate, type WidgetSchedule } from "./storage";

/** app.json의 위젯 정의(name)와 반드시 같아야 한다 — 네이티브가 이 이름으로 태스크를 호출한다. */
export const WIDGET_NAME = "TodaySchedule";

/** ‹ › 버튼 클릭 액션 — clickActionData.delta(+1/-1)만큼 날짜를 옮긴다. widgetTaskHandler 참고. */
export const SHIFT_DAY_ACTION = "SHIFT_DAY";
/** 날짜(헤더 왼쪽)를 누르면 오늘로 돌아간다. */
export const GO_TODAY_ACTION = "GO_TODAY";

// 갤럭시 One UI 위젯처럼 배경화면이 은은하게 비치는 반투명 카드. 너무 투명하면 사진 배경 위에서
// 글자가 묻히므로 라이트는 흰색 72%, 다크는 거의 검정 62% 정도로 깔아 가독성을 지킨다.
const THEME = {
  light: {
    card: "rgba(255, 255, 255, 0.72)",
    text: "#111111",
    muted: "#6b6b6b",
    accent: "#ef5b2b",
    holiday: "#e05b4a",
    button: "rgba(0, 0, 0, 0.06)",
    bars: ["#ef5b2b", "#3b82f6", "#22a35a"],
  },
  dark: {
    card: "rgba(20, 20, 22, 0.62)",
    text: "#f5f5f5",
    muted: "#a3a3a3",
    accent: "#ff8256",
    holiday: "#ff7a6b",
    button: "rgba(255, 255, 255, 0.12)",
    bars: ["#ff8256", "#60a5fa", "#4ade80"],
  },
} as const;

type Theme = (typeof THEME)[keyof typeof THEME];

const HEADER_HEIGHT = 50;
const ROW_HEIGHT = 24;

export type TodayScheduleWidgetProps = {
  /** 위젯에 보여줄 날짜(YYYY-MM-DD) — ‹ › 버튼으로 오늘에서 옮겨갈 수 있다. */
  date: string;
  /** 오늘 날짜(YYYY-MM-DD) — 렌더링 시점에 계산해서 넘긴다. */
  today: string;
  /** date가 공휴일이면 그 이름("대체공휴일", "한글날" 등). */
  holiday?: string;
  schedules: WidgetSchedule[];
  /** 위젯 높이(dp) — 몇 줄까지 그릴지 결정한다. */
  height: number;
};

/** 위젯 높이에 맞춰 표시할 줄 수. 최소 1줄은 보장한다. */
function visibleRowCount(height: number): number {
  return Math.max(1, Math.floor((height - HEADER_HEIGHT) / ROW_HEIGHT));
}

/** 오늘 기준 상대 날짜 라벨 — "오늘", "내일", "3일 후" 등. */
function relativeLabel(date: string, today: string): string {
  const diff = Math.round(
    (new Date(`${date}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000,
  );
  if (diff === 0) return "오늘";
  if (diff === 1) return "내일";
  if (diff === 2) return "모레";
  if (diff === -1) return "어제";
  return diff > 0 ? `${diff}일 후` : `${-diff}일 전`;
}

export function TodayScheduleWidget(props: TodayScheduleWidgetProps) {
  return {
    light: <WidgetBody {...props} theme={THEME.light} />,
    dark: <WidgetBody {...props} theme={THEME.dark} />,
  };
}

function NavButton({ label, delta, enabled, theme }: { label: string; delta: number; enabled: boolean; theme: Theme }) {
  return (
    <FlexWidget
      clickAction={enabled ? SHIFT_DAY_ACTION : undefined}
      clickActionData={enabled ? { delta } : undefined}
      accessibilityLabel={delta < 0 ? "전날" : "다음날"}
      style={{
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: theme.button,
        alignItems: "center",
        justifyContent: "center",
        marginLeft: 6,
      }}
    >
      <TextWidget
        text={label}
        style={{ fontSize: 18, fontWeight: "700", color: enabled ? theme.text : theme.muted }}
      />
    </FlexWidget>
  );
}

function WidgetBody({
  date,
  today,
  holiday,
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
  const isToday = date === today;
  const canPrev = clampWidgetDate(addDaysIso(date, -1), today) !== date;
  const canNext = clampWidgetDate(addDaysIso(date, 1), today) !== date;
  // 달력과 같이 일요일·공휴일은 빨간 날로.
  const isRedDay = d.getDay() === 0 || !!holiday;
  const subParts = [`${d.getMonth() + 1}월`];
  if (holiday) subParts.push(holiday);
  if (schedules.length > 0) subParts.push(`일정 ${schedules.length}건`);

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel={`${relativeLabel(date, today)} 일정 ${schedules.length}건`}
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
      {/* 헤더: 큰 날짜 숫자 + 요일/월(누르면 오늘로), 오른쪽에 ‹ › 날짜 이동 버튼 */}
      <FlexWidget
        style={{
          width: "match_parent",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        {/* flex(weight) 대신 space-between으로 양쪽을 나눈다 — weight로 늘린 왼쪽 덩어리가
            버튼 자리까지 밀어내 오른쪽 여백이 사라지는 경우가 있었다. */}
        <FlexWidget
          clickAction={isToday ? undefined : GO_TODAY_ACTION}
          style={{ flexDirection: "row", alignItems: "center" }}
        >
          <TextWidget
            text={String(d.getDate())}
            style={{ fontSize: 28, fontWeight: "700", color: isRedDay ? theme.holiday : theme.text, marginRight: 8 }}
          />
          <FlexWidget style={{ flexDirection: "column" }}>
            <TextWidget
              text={`${WEEKDAYS[d.getDay()]}요일 · ${relativeLabel(date, today)}`}
              maxLines={1}
              style={{ fontSize: 12, fontWeight: "700", color: isToday ? theme.accent : theme.text }}
            />
            <TextWidget
              text={subParts.join(" · ")}
              maxLines={1}
              style={{ fontSize: 12, color: holiday ? theme.holiday : theme.muted }}
            />
          </FlexWidget>
        </FlexWidget>
        <FlexWidget style={{ flexDirection: "row", alignItems: "center" }}>
          <NavButton label="‹" delta={-1} enabled={canPrev} theme={theme} />
          <NavButton label="›" delta={1} enabled={canNext} theme={theme} />
        </FlexWidget>
      </FlexWidget>

      {schedules.length === 0 ? (
        // 위젯이 큰데(특히 잠금화면) 위쪽에 한 줄만 있으면 휑하므로 남은 공간 가운데에 둔다.
        <FlexWidget
          style={{ width: "match_parent", flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 18 }}
        >
          <TextWidget
            text={isToday ? "오늘은 일정이 없어요" : "일정이 없어요"}
            style={{ fontSize: 13, color: theme.muted }}
          />
        </FlexWidget>
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
