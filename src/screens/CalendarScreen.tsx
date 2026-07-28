import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  buildGrid,
  datesWeekly,
  DEFAULT_REMINDER_HOUR,
  DEFAULT_REMINDER_MINUTE,
  fmtSelected,
  formatAmPmTime,
  hourMinuteFromIso,
  pad,
  reminderIsoFor,
  shiftMonth,
  toISO,
  WEEKDAYS,
} from "../lib/calendar";
import WheelPicker from "../components/WheelPicker";
import {
  useCreateRecurringSchedules,
  useCreateSchedule,
  useDeleteSchedule,
  useSchedules,
  useUpdateSchedule,
} from "../hooks/schedules";
import { useUnhandledCount } from "../hooks/notifications";
import { getScheduledAlarms, type ScheduledAlarm } from "../lib/notifications";
import { supabase } from "../lib/supabase";
import type { ScheduleItem } from "../types";

// 일정 칩 — 선명한 강조색 팔레트. 배경은 연하게, 왼쪽 보더/텍스트는 진하게 대비.
const CHIP_COLORS = [
  { bg: "#ffe6da", border: "#ef5b2b", text: "#9a3411" },
  { bg: "#dfebfb", border: "#2f74d0", text: "#1b4a88" },
  { bg: "#dff1e4", border: "#3f9d5a", text: "#215d34" },
];
const MAX_CHIPS = 3;
// 달력이 거슬러 올라갈 수 있는 가장 이른 달 — 구형 캘린더 앱에서 옮겨온 일정이 2024년 1월부터
// 있어서 거기까지는 항상 넘겨볼 수 있어야 한다(오늘 기준 고정 개월수로 두면 시간이 지날수록
// 옛날 일정이 범위 밖으로 밀려난다).
const EARLIEST_YEAR = 2024;
const EARLIEST_MONTH = 0; // 0-based (0 = 1월)
// 오늘 기준으로 미리 만들어둘 달력 페이지 범위. 과거 쪽은 EARLIEST_YEAR까지 자동으로 늘어나고,
// 이 값은 그 계산이 너무 짧아질 때의 하한이다.
const MIN_MONTHS_BEFORE = 6;
const MONTHS_AFTER = 6;
// 페이지 수가 수십 개가 되므로 날짜 셀까지 전부 그려두면 첫 렌더가 무거워진다. 현재 페이지
// 기준 이 범위 안의 달만 실제로 그리고, 나머지는 같은 높이의 빈 자리로만 둔다(스크롤 위치
// 계산이 페이지 높이에만 의존하므로 빈 자리로 둬도 스와이프 동작은 그대로다).
const RENDER_WINDOW = 2;

type MonthPage = { year: number; month: number; grid: Date[] };

export default function CalendarScreen({
  onOpenInbox,
  onOpenNotificationAccess,
}: {
  /** 알림함 화면 열기. */
  onOpenInbox: () => void;
  /** 알림 감지 안내 화면 열기. 안드로이드에서 알림 접근을 쓸 수 있을 때만 전달된다. */
  onOpenNotificationAccess?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const today = useMemo(() => new Date(), []);

  // 오늘에서 EARLIEST_YEAR/MONTH까지 몇 달을 거슬러 올라가야 하는지 = 과거 쪽 페이지 수.
  const monthsBefore = useMemo(() => {
    const diff = (today.getFullYear() - EARLIEST_YEAR) * 12 + (today.getMonth() - EARLIEST_MONTH);
    return Math.max(diff, MIN_MONTHS_BEFORE);
  }, [today]);

  // 달력 그리드(2024년 1월 ~ 오늘+6개월)를 앱 켤 때 한 번에 미리 다 계산해둔다 — 순수 날짜
  // 계산이라 네트워크가 필요 없고, 그래서 화면(그리드)은 일정 데이터를 기다리지 않고 바로 뜬다.
  // 일정(이벤트) 데이터는 각 페이지가 화면에 들어왔을 때(=현재 페이지가 됐을 때)만 따로 불러와서
  // 채워 넣는다 — MonthPageView 참고.
  const pageMonths = useMemo<MonthPage[]>(() => {
    const pages: MonthPage[] = [];
    for (let offset = -monthsBefore; offset <= MONTHS_AFTER; offset++) {
      const s = shiftMonth(today, offset);
      pages.push({ year: s.year, month: s.month, grid: buildGrid(s.year, s.month) });
    }
    return pages;
  }, [today, monthsBefore]);

  const [pageIndex, setPageIndex] = useState(monthsBefore);
  const currentPage = pageMonths[pageIndex];
  const year = currentPage.year;
  const month = currentPage.month;

  // 빠르게 연달아 스와이프하면 그냥 스쳐 지나가는 페이지도 pageIndex가 잠깐씩 그 값을 거쳐간다 —
  // 아직 캐시가 없는 페이지까지 매번 fetch를 쏘면 낭비이므로, 이 값에 최소 200ms는 머물러야
  // ("정착") 새 요청을 허용한다. 이미 캐시된 페이지는 정착을 기다릴 필요 없이 즉시 보여준다 —
  // 아래 currentFrom/To의 enabled 계산과 MonthPageView 둘 다 이 정착 인덱스를 참고한다.
  const [settledPageIndex, setSettledPageIndex] = useState(pageIndex);
  useEffect(() => {
    const timer = setTimeout(() => setSettledPageIndex(pageIndex), 200);
    return () => clearTimeout(timer);
  }, [pageIndex]);

  // 현재 페이지(달) 일정 — 날짜 상세 모달용. 같은 범위를 MonthPageView도 자기 칩 표시를 위해
  // 조회하는데, react-query가 같은 쿼리키를 캐시/구독 공유하므로 여기서 한 번 더 불러도 요청이
  // 중복으로 나가지는 않는다. 이미 캐시돼 있으면 정착을 기다리지 않고 바로 활성화한다.
  const currentFrom = toISO(currentPage.grid[0]);
  const currentTo = toISO(currentPage.grid[currentPage.grid.length - 1]);
  const qc = useQueryClient();
  const hasCurrentCache = qc.getQueryData(["schedules", currentFrom, currentTo]) !== undefined;
  const { data: currentMonthData } = useSchedules(
    { from: currentFrom, to: currentTo },
    { enabled: hasCurrentCache || pageIndex === settledPageIndex },
  );
  const byDate = useMemo(() => {
    const map = new Map<string, ScheduleItem[]>();
    for (const s of currentMonthData ?? []) {
      const list = map.get(s.date) ?? [];
      list.push(s);
      map.set(s.date, list);
    }
    return map;
  }, [currentMonthData]);

  // 네비게이션 바 영역은 위쪽 펀치홀 카메라 여백(header의 insets.top)과 똑같이, 화면 전체
  // 컨테이너에 고정 여백으로만 반영한다 — 달력 페이지 높이 자체를 계산해서 빼면 스와이프로
  // 페이지가 바뀔 때마다 값이 어긋나서 달력이 깨지는 문제가 있었다.
  const [gridHeight, setGridHeight] = useState(0);

  // 월 스와이프는 FlatList pagingEnabled 대신 시트 드래그-닫기와 같은 제스처 라이브러리로 직접
  // 구현한다 — FlatList의 onMomentumScrollEnd/onScrollEndDrag 조합은 안드로이드에서 이벤트가
  // 아예 안 오거나(월이 씹힘) 두 이벤트가 겹쳐서 오기도 해서(월이 2개씩 넘어감) 신뢰할 수 없었다.
  // 워클릿(제스처 콜백)은 UI 스레드로 클로저 변수를 복사해서 넘기는데, Date는 복사 가능한
  // 타입이 아니다 — pageMonths(Date가 들어있는 배열) 자체를 워클릿 안에서 참조하면
  // "[Worklets] Cannot copy value of type `Date`" 에러가 난다. 그래서 필요한 숫자(길이)만
  // 미리 뽑아서 넘긴다.
  const totalPages = pageMonths.length;

  // 화면 위치(scrollY, px 단위 절대 스크롤량)는 UI 스레드에서만 사는 값으로, pageIndex(JS
  // state)와 완전히 분리한다. 예전엔 -pageIndex*gridHeight를 매번 다시 계산해서 애니메이션
  // 기준선으로 썼는데, pageIndex가 실제로 UI 스레드에 반영되는 시점과 애니메이션 시작 시점
  // 사이에 미묘한 타이밍 차이가 있어서 "이전 달이 잠깐 보였다가 제자리로" 튀는 순간적인
  // 프레임 점프가 생겼다. scrollY 하나만 화면 위치의 유일한 진실이 되게 하면 이 문제 자체가
  // 사라진다 — pageIndex는 헤더 제목/데이터 페칭처럼 화면에 보이지 않는 용도로만 쓴다.
  const scrollY = useSharedValue(0);
  const startScrollY = useSharedValue(0);
  const scrollYSeeded = useRef(false);
  useEffect(() => {
    if (gridHeight > 0 && !scrollYSeeded.current) {
      scrollY.value = pageIndex * gridHeight;
      scrollYSeeded.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridHeight]);

  const monthSwipeGesture = Gesture.Pan()
    .activeOffsetY([-10, 10]) // 이 정도 세로 이동 전엔 활성화 안 함 — 날짜 셀 탭이 씹히지 않게
    .onStart(() => {
      startScrollY.value = scrollY.value;
    })
    .onUpdate((e) => {
      // 손가락을 아래로 끌면 화면도 아래로(이전 달 쪽이) 따라와야 하는데, translateY는
      // -scrollY라서 scrollY는 translationY와 반대 부호로 움직여야 한다 — 여기서 +로 더하면
      // 드래그 중 미리보기가 손가락과 반대 방향으로 움직여 보인다.
      if (gridHeight) scrollY.value = startScrollY.value - e.translationY;
    })
    .onEnd((e) => {
      if (!gridHeight) return;
      // 이 드래그를 시작한 페이지가 몇 번째였는지도 scrollY(UI 스레드 값)에서 직접 구한다 —
      // JS의 pageIndex를 참조하면 빠른 연속 스와이프 때 아직 갱신 전인 값을 볼 수도 있다.
      const startIndex = Math.round(startScrollY.value / gridHeight);
      const canNext = startIndex < totalPages - 1;
      const canPrev = startIndex > 0;
      const commitNext = canNext && (e.translationY < -gridHeight * 0.25 || e.velocityY < -800);
      const commitPrev = canPrev && (e.translationY > gridHeight * 0.25 || e.velocityY > 800);
      if (commitNext) {
        scrollY.value = withTiming((startIndex + 1) * gridHeight, { duration: 220 });
        runOnJS(commitPageIndex)(1);
      } else if (commitPrev) {
        scrollY.value = withTiming((startIndex - 1) * gridHeight, { duration: 220 });
        runOnJS(commitPageIndex)(-1);
      } else {
        scrollY.value = withTiming(startIndex * gridHeight, { duration: 220 });
      }
    });
  const monthListAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -scrollY.value }],
  }));

  const [selected, setSelected] = useState(toISO(today));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduleItem | null>(null);
  const [title, setTitle] = useState("");
  const [memo, setMemo] = useState("");
  const [remindEnabled, setRemindEnabled] = useState(true);
  const [remindHour, setRemindHour] = useState(DEFAULT_REMINDER_HOUR);
  const [remindMinute, setRemindMinute] = useState(DEFAULT_REMINDER_MINUTE);
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [repeatUntil, setRepeatUntil] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showEventDatePicker, setShowEventDatePicker] = useState(false);

  // 시트 핸들/헤더를 아래로 드래그하면 ✕ 버튼처럼 닫히게 — 목록 스크롤과 제스처가 충돌하지 않도록
  // 스크롤 영역이 아니라 핸들+헤더에만 건다.
  // PanResponder(구형 제스처 API)는 이 RN 버전(New Architecture)에서 신뢰성이 떨어져서
  // react-native-gesture-handler + react-native-reanimated로 구현한다.
  const panY = useSharedValue(0);
  const dragGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (e.translationY > 0) panY.value = e.translationY;
    })
    .onEnd((e) => {
      // 닫힘: 손을 떼는 즉시 UI 스레드에서 시트를 화면 밖까지 이어서 내린 뒤, 그 애니메이션이
      // 끝나면 closeDialog로 모달을 언마운트한다. 예전엔 손을 떼자마자 runOnJS(closeDialog)를
      // 호출했는데, 상태변경→리렌더→네이티브 슬라이드가 시작되기까지 몇 프레임 동안 시트가 panY
      // 위치에 멈췄다가 다시 내려가서 "내려가다 멈추고 다시 내려가는"것처럼 보였다.
      // 취소(임계값 못 넘음)일 때만 원위치로 되돌린다.
      if (e.translationY > 100) {
        panY.value = withTiming(windowHeight, { duration: 200 }, (finished) => {
          if (finished) runOnJS(closeDialog)();
        });
      } else {
        panY.value = withTiming(0, { duration: 180 });
      }
    });
  // 키보드는 시트 레이아웃을 전혀 건드리지 않는다 — 그냥 시트 위에 겹쳐 뜬다.
  // 여기까지 온 과정: (1) reanimated useAnimatedKeyboard(이미 deprecated)로 시트를 통째로
  // 밀어 올렸더니, 일부 안드로이드 기기에서 키보드가 닫혀 있어도 height가 0으로 안 떨어져
  // 입력창도 없는 상세 시트가 열자마자 떠 버렸다. (2) 시트 상단을 고정하고 bottom만 키보드 위로
  // 올려 봤더니 이번엔 시트가 너무 납작해져 쓰기 불편했다. 그래서 시트는 고정 크기로 두고,
  // 키보드에 가려지는 만큼은 아래 ScrollView의 contentContainer 여백으로 스크롤해서 본다.
  // (translateY는 드래그로 닫기 전용.)
  const sheetAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: panY.value }],
  }));
  // 시트를 아래로 끌수록(그리고 닫힐 때 화면 밖까지 내려갈수록) 뒤 어둠막도 같이 옅어진다.
  // 시트 높이(화면의 85%)만큼 내려가면 완전히 투명.
  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(panY.value, [0, windowHeight * 0.85], [1, 0], Extrapolation.CLAMP),
  }));

  useEffect(() => {
    if (dialogOpen) panY.value = 0;
  }, [dialogOpen, panY]);

  // 키보드가 시트를 덮는 높이 — 폼 ScrollView 아래쪽에 이만큼 여백을 줘서, 키보드에 가린 항목
  // (알림·반복 옵션, 추가/취소 버튼)을 스크롤해 올려 볼 수 있게 한다.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", (e) => {
      // endCoordinates.height는 화면 하단부터의 키보드 높이(안드로이드에선 네비바 영역 포함).
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // 버튼(‹ › 오늘) 전용 — 진행 중인 드래그가 없으니 화면 위치(scrollY)도 이 자리에서 바로
  // 옮겨서 즉시 이동시킨다. 스와이프로 넘어갈 때는 scrollY를 제스처 워클릿이 이미 애니메이션
  // 중이므로 여기서 다시 건드리지 않는다 — 아래 commitPageIndex 참고.
  function goToMonth(offset: number) {
    const next = Math.min(Math.max(pageIndex + offset, 0), pageMonths.length - 1);
    setPageIndex(next);
    scrollY.value = next * gridHeight;
  }

  // 스와이프 커밋 전용 — 화면 위치는 제스처의 onEnd에서 이미 처리했으므로 여기서는 논리적인
  // pageIndex(헤더 제목/데이터 페칭용)만 갱신한다. 함수형 업데이트라서 빠르게 연속으로
  // 커밋되어도(runOnJS 호출 순서만 보장되면) 순서대로 정확히 누적된다.
  function commitPageIndex(offset: number) {
    setPageIndex((i) => Math.min(Math.max(i + offset, 0), pageMonths.length - 1));
  }

  function goToToday() {
    setPageIndex(monthsBefore);
    scrollY.value = monthsBefore * gridHeight;
  }

  // 헤더 제목을 눌러 여는 년/월 점프 — 2024년 1월까지 30번 넘기지 않아도 되게. 휠(스크롤로
  // 값 확정)이 아니라 달을 직접 탭하면 바로 이동하는 그리드다 — 고른 값이 반영됐는지 헷갈릴
  // 여지가 없고, 두 번 터치로 끝난다.
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpYear, setJumpYear] = useState(year);
  const firstYear = pageMonths[0].year;
  const lastYear = pageMonths[pageMonths.length - 1].year;

  function openJump() {
    setJumpYear(year);
    setJumpOpen(true);
  }

  /** (년, 0-based 월)에 해당하는 페이지 인덱스 — 달력 범위 밖이면 null. */
  function pageIndexOf(y: number, m: number): number | null {
    const first = pageMonths[0];
    const idx = (y - first.year) * 12 + (m - first.month);
    return idx >= 0 && idx < pageMonths.length ? idx : null;
  }

  function jumpTo(index: number) {
    setJumpOpen(false);
    setPageIndex(index);
    scrollY.value = index * gridHeight;
  }

  // 로그아웃·알림감지처럼 자주 쓰지 않는 항목은 헤더에 늘어놓지 않고 이 메뉴에 모은다.
  const [menuOpen, setMenuOpen] = useState(false);
  // 알림함에 미확인이 있으면 메뉴 버튼에 점을 찍어 알린다(Realtime 무효화를 그대로 타는 쿼리).
  const { data: unhandledCount = 0 } = useUnhandledCount();

  const create = useCreateSchedule();
  const createRecurring = useCreateRecurringSchedules();
  const update = useUpdateSchedule();
  const del = useDeleteSchedule();

  function startCreate() {
    setEditing(null);
    setTitle("");
    setMemo("");
    setRemindEnabled(true);
    setRemindHour(DEFAULT_REMINDER_HOUR);
    setRemindMinute(DEFAULT_REMINDER_MINUTE);
    setRepeatEnabled(false);
    setRepeatUntil("");
  }

  function startEdit(s: ScheduleItem) {
    setEditing(s);
    setTitle(s.title);
    setMemo(s.memo ?? "");
    setRemindEnabled(!!s.remind_at);
    if (s.remind_at) {
      const { hour, minute } = hourMinuteFromIso(s.remind_at);
      setRemindHour(hour);
      // 분 휠은 5분 단위라, 기존 값이 5의 배수가 아니면(구형 데이터 등) 5분 단위로 맞춰
      // 표시와 저장 값이 어긋나지 않게 한다.
      setRemindMinute(minute - (minute % 5));
    } else {
      setRemindHour(DEFAULT_REMINDER_HOUR);
      setRemindMinute(DEFAULT_REMINDER_MINUTE);
    }
    setRepeatEnabled(false);
    setRepeatUntil("");
    setShowEventDatePicker(false);
    setShowDatePicker(false);
    setFormOpen(true);
  }

  const eventListRef = useRef<ScrollView>(null);

  // 시트는 "목록 보기"와 "추가/수정 폼" 두 화면을 번갈아 보여준다 — 날짜를 누르면
  // 항상 기존 일정 목록이 꽉 차게 먼저 보이고, "+ 일정 추가"나 "수정"을 눌러야 폼으로 넘어간다.
  const [formOpen, setFormOpen] = useState(false);

  function openDay(iso: string) {
    setSelected(iso);
    startCreate();
    setFormOpen(false);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setFormOpen(false);
    setShowEventDatePicker(false);
    setShowDatePicker(false);
    startCreate();
  }

  function openAddForm() {
    startCreate();
    setFormOpen(true);
  }

  // 우하단 FAB — 어느 달을 보고 있든 오늘 날짜로 바로 추가 폼을 연다.
  function openAddToday() {
    setSelected(toISO(today));
    startCreate();
    setFormOpen(true);
    setDialogOpen(true);
  }

  // 실기기에서 "지금 OS에 실제로 예약된 로컬알람"을 눈으로 확인하는 디버그 뷰 — FAB를 길게 누르면 뜬다.
  const [alarmsOpen, setAlarmsOpen] = useState(false);
  const [scheduledAlarms, setScheduledAlarms] = useState<ScheduledAlarm[]>([]);
  async function openScheduledAlarms() {
    setScheduledAlarms(await getScheduledAlarms());
    setAlarmsOpen(true);
  }

  async function onSubmit() {
    if (!title.trim()) return;
    try {
      const trimmedMemo = memo.trim() || undefined;
      if (editing) {
        const remindAtIso = remindEnabled ? reminderIsoFor(selected, remindHour, remindMinute) : null;
        await update.mutateAsync({
          id: editing.id,
          input: { date: selected, title: title.trim(), memo: trimmedMemo, remindAt: remindAtIso },
        });
      } else if (repeatEnabled && repeatUntil) {
        const dates = datesWeekly(selected, repeatUntil).map((date) => ({
          date,
          remindAt: remindEnabled ? reminderIsoFor(date, remindHour, remindMinute) : null,
        }));
        await createRecurring.mutateAsync({ title: title.trim(), memo: trimmedMemo, dates });
        setTimeout(() => eventListRef.current?.scrollToEnd({ animated: true }), 150);
      } else {
        const remindAtIso = remindEnabled ? reminderIsoFor(selected, remindHour, remindMinute) : null;
        await create.mutateAsync({ date: selected, title: title.trim(), memo: trimmedMemo, remindAt: remindAtIso });
        setTimeout(() => eventListRef.current?.scrollToEnd({ animated: true }), 150);
      }
      startCreate();
      setShowEventDatePicker(false);
      setShowDatePicker(false);
      setFormOpen(false);
    } catch (err) {
      Alert.alert("저장 실패", (err as Error).message);
    }
  }

  function onDelete(s: ScheduleItem) {
    Alert.alert("일정 삭제", `"${s.title}" 일정을 삭제할까요?`, [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: async () => {
          try {
            await del.mutateAsync(s);
            if (editing?.id === s.id) startCreate();
          } catch (err) {
            Alert.alert("삭제 실패", (err as Error).message);
          }
        },
      },
    ]);
  }

  const selectedEvents = byDate.get(selected) ?? [];
  const submitting = create.isPending || update.isPending || createRecurring.isPending;

  // 커스텀 날짜 휠 피커용 — 선택된 날짜(selected)를 년/월/일로 쪼개고, 휠에서 한 부분이
  // 바뀌면 그 달의 최대 일수로 일(day)을 클램프해 유효한 날짜만 만든다.
  // 달력이 보여주는 범위(2024년 ~ 오늘+3년)와 같은 폭 — 옛날 일정을 눌러 고칠 때 연도 휠에
  // 그 해가 없으면 날짜를 되돌릴 수 없다.
  const pickerYears = Array.from(
    { length: today.getFullYear() + 3 - EARLIEST_YEAR + 1 },
    (_, i) => EARLIEST_YEAR + i,
  );
  const [selYear, selMonth, selDay] = selected.split("-").map(Number);
  const daysInSelMonth = new Date(selYear, selMonth, 0).getDate();
  function setDatePart(part: { y?: number; m?: number; d?: number }) {
    const y = part.y ?? selYear;
    const m = part.m ?? selMonth;
    const dim = new Date(y, m, 0).getDate();
    const d = Math.min(part.d ?? selDay, dim);
    setSelected(`${y}-${pad(m)}-${pad(d)}`);
  }

  // 반복 종료일 커스텀 피커용 — 시작일(selected)보다 앞설 수 없게 클램프한다.
  const endBase = repeatUntil || selected;
  const [endYear, endMonth, endDay] = endBase.split("-").map(Number);
  const endYears = Array.from({ length: 4 }, (_, i) => selYear + i);
  const daysInEndMonth = new Date(endYear, endMonth, 0).getDate();
  function setEndDatePart(part: { y?: number; m?: number; d?: number }) {
    const y = part.y ?? endYear;
    const m = part.m ?? endMonth;
    const dim = new Date(y, m, 0).getDate();
    const d = Math.min(part.d ?? endDay, dim);
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    setRepeatUntil(iso < selected ? selected : iso);
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        {/* 왼쪽: 달 이동(‹ 제목 ›) — 제목을 누르면 년/월 점프. 오른쪽: 오늘·메뉴.
            제목을 가운데 정렬하지 않고 왼쪽으로 몰아야 좁은 화면에서도 버튼이 안 잘린다. */}
        <View style={styles.headerLeft}>
          <Pressable onPress={() => goToMonth(-1)} style={styles.chevronBtn} hitSlop={4}>
            <Text style={styles.chevronText}>‹</Text>
          </Pressable>
          <Pressable
            onPress={openJump}
            style={styles.titleBtn}
            android_ripple={{ color: "#f6e9d1", borderless: false }}
          >
            <Text style={styles.headerTitle} numberOfLines={1}>
              <Text style={styles.headerYear}>{year} </Text>
              {month + 1}월
            </Text>
            <Text style={styles.headerCaret}>▾</Text>
          </Pressable>
          <Pressable onPress={() => goToMonth(1)} style={styles.chevronBtn} hitSlop={4}>
            <Text style={styles.chevronText}>›</Text>
          </Pressable>
        </View>
        <View style={styles.headerRight}>
          <Pressable
            onPress={goToToday}
            style={styles.todayPill}
            android_ripple={{ color: "#f8d4c4", borderless: false }}
          >
            <Text style={styles.todayPillText}>오늘</Text>
          </Pressable>
          <Pressable
            onPress={() => setMenuOpen(true)}
            style={styles.iconBtn}
            hitSlop={4}
            android_ripple={{ color: "#f6e9d1", borderless: false }}
          >
            <Text style={styles.iconBtnText}>☰</Text>
          </Pressable>
          {unhandledCount > 0 && <View pointerEvents="none" style={styles.menuBadge} />}
        </View>
      </View>

      <View style={styles.weekdayRow}>
        {WEEKDAYS.map((w, i) => (
          <Text
            key={w}
            style={[styles.weekdayText, i === 0 && styles.sunText, i === 6 && styles.satText]}
          >
            {w}
          </Text>
        ))}
      </View>

      <View style={styles.gridArea} onLayout={(e) => setGridHeight(e.nativeEvent.layout.height)}>
        <GestureDetector gesture={monthSwipeGesture}>
          <Animated.View style={monthListAnimatedStyle}>
            {pageMonths.map((page, i) => (
              <MonthPageView
                key={`${page.year}-${page.month}`}
                page={page}
                height={gridHeight}
                isNear={Math.abs(i - pageIndex) <= RENDER_WINDOW}
                isCurrent={i === pageIndex}
                isSettled={i === settledPageIndex}
                today={today}
                selected={selected}
                onSelectDay={openDay}
              />
            ))}
          </Animated.View>
        </GestureDetector>
      </View>

      {/* 우하단 플로팅 추가 버튼 — 오늘 날짜로 바로 일정 추가. 상세 시트가 떠 있을 땐 시트
          아래(모달은 별도 창)라 가려지므로 숨길 필요 없다. */}
      <Pressable
        onPress={openAddToday}
        onLongPress={openScheduledAlarms}
        style={[styles.fab, { bottom: 20 + insets.bottom }]}
        android_ripple={{ color: "rgba(255,255,255,0.3)", borderless: false }}
      >
        <Text style={styles.fabPlus}>＋</Text>
      </Pressable>

      {/* statusBarTranslucent + navigationBarTranslucent: 이 두 개가 없으면 RN이 모달 창에
          disableEdgeToEdge()를 걸어서(ReactModalHostView.kt) 모달 창의 컨텐츠 영역이 상태바 아래~
          네비바 위로 줄어든다. 반면 안에서 쓰는 useSafeAreaInsets()는 액티비티 창(전체 화면) 기준
          값이라, insets.bottom을 더하면 네비바 높이를 두 번 빼는 꼴이 된다 — 제스처 네비 폰(≈16dp)은
          티가 안 나고 3버튼 네비 폰(≈48dp)은 시트가 확 밀려 잘려 보였다. 또 edge-to-edge가 아닌
          창은 키보드가 뜰 때 창 자체가 리사이즈돼서 시트가 통째로 밀려 올라갔다. 모달 창도 전체
          화면으로 만들어 좌표계를 액티비티 창과 일치시키고, 키보드는 그 위에 겹쳐 뜨게 한다. */}
      <Modal
        visible={dialogOpen}
        animationType="slide"
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={closeDialog}
      >
        {/* RN Modal은 완전히 별도의 네이티브 창에 그려져서 App.tsx의 GestureHandlerRootView가 미치지
            않는다 — 그 안의 GestureDetector(드래그로 닫기 등)가 동작하려면 모달 내부에도 별도의
            GestureHandlerRootView가 필요하다(공식 문서에 명시된 요구사항). */}
        <GestureHandlerRootView style={styles.modalRoot}>
        {/* 어둠막은 KeyboardAvoidingView '밖'에 둬서 항상 화면 전체를 덮는다 — 안에 두면 키보드가
            닫힐 때 KAV가 높이를 되돌리는 순간 하단에 틈이 생겨 뒤 페이지가 잠깐 비쳤다.
            시각용(pointerEvents none)이라 탭 닫기는 아래 투명 Pressable이 담당. */}
        <Animated.View
          style={[styles.backdrop, backdropAnimatedStyle]}
          pointerEvents="none"
        />
        <View style={styles.modalRoot}>
          <Pressable
            style={styles.backdropTouch}
            onPress={closeDialog}
            android_ripple={{ color: "transparent" }}
          />
          <Animated.View style={[styles.sheet, sheetAnimatedStyle]}>
            <GestureDetector gesture={dragGesture}>
              <View>
                <View style={styles.sheetHandle} />
                <View style={styles.sheetHeader}>
                  {formOpen && !editing ? (
                    // 새 일정 추가 중엔 상단 날짜를 눌러 날짜 선택기로 바로 바꿀 수 있다 —
                    // 알약 버튼(달력 아이콘 + 테두리 + 캐럿)으로 눌리는 컨트롤임을 분명히 한다.
                    <Pressable
                      onPress={() => {
                        Keyboard.dismiss();
                        setShowEventDatePicker(true);
                      }}
                      style={styles.datePickerBtn}
                      android_ripple={{ color: "#fbe0d3", borderless: false }}
                    >
                      <Text style={styles.datePickerIcon}>📅</Text>
                      <Text style={styles.datePickerText}>{fmtSelected(selected)}</Text>
                      <Text style={styles.datePickerCaret}>▾</Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.sheetTitle}>{fmtSelected(selected)}</Text>
                  )}
                  <Pressable
                    onPress={closeDialog}
                    hitSlop={8}
                    android_ripple={{ color: "#ecdfc0", borderless: true }}
                  >
                    <Text style={styles.closeText}>✕</Text>
                  </Pressable>
                </View>
              </View>
            </GestureDetector>

            {/* 날짜 선택 — 시간 선택기와 동일한 커스텀 휠 피커(네이티브 다이얼로그 대신).
                별도 창(Modal)에 뜨므로 상세/추가 어느 화면 위에 있든 그 위에만 겹쳐 뜨고,
                닫으면 흔적 없이 사라진다. */}
            <Modal
              visible={showEventDatePicker}
              transparent
              animationType="fade"
              statusBarTranslucent
              navigationBarTranslucent
              onRequestClose={() => setShowEventDatePicker(false)}
            >
              <View style={styles.timePickerRoot}>
                <Pressable
                  style={styles.timePickerBackdrop}
                  onPress={() => setShowEventDatePicker(false)}
                  android_ripple={{ color: "transparent" }}
                />
                <View style={styles.timePickerSheet}>
                  <Text style={[styles.formLabel, { textAlign: "center" }]}>날짜 선택</Text>
                  <View style={styles.timePickerRow}>
                    <WheelPicker
                      items={pickerYears.map((y) => ({ label: `${y}년`, value: y }))}
                      selectedValue={selYear}
                      onChange={(y) => setDatePart({ y })}
                    />
                    <WheelPicker
                      items={Array.from({ length: 12 }, (_, i) => i + 1).map((m) => ({ label: `${m}월`, value: m }))}
                      selectedValue={selMonth}
                      onChange={(m) => setDatePart({ m })}
                    />
                    <WheelPicker
                      items={Array.from({ length: daysInSelMonth }, (_, i) => i + 1).map((d) => ({ label: `${d}일`, value: d }))}
                      selectedValue={selDay}
                      onChange={(d) => setDatePart({ d })}
                    />
                  </View>
                  <Pressable
                    style={[styles.submitBtn, { marginTop: 16 }]}
                    onPress={() => setShowEventDatePicker(false)}
                    android_ripple={{ color: "#c2410c" }}
                  >
                    <Text style={styles.submitBtnText}>완료</Text>
                  </Pressable>
                </View>
              </View>
            </Modal>

            {formOpen ? (
              <>
                {/* 키보드가 폼 아래쪽을 덮으므로, 덮이는 높이만큼 스크롤 여백을 줘서 가려진
                    옵션들을 끌어올려 볼 수 있게 한다. */}
                <ScrollView
                  style={styles.sheetScroll}
                  contentContainerStyle={{ paddingBottom: keyboardHeight }}
                  keyboardShouldPersistTaps="handled"
                >
                <Pressable onPress={() => Keyboard.dismiss()} android_ripple={{ color: "transparent" }}>
                  <Text style={styles.formLabel}>{editing ? "일정 수정" : "일정 추가"}</Text>
                  <TextInput
                    value={title}
                    onChangeText={setTitle}
                    placeholder="일정 내용"
                    placeholderTextColor="#b7ab94"
                    returnKeyType="done"
                    onSubmitEditing={() => Keyboard.dismiss()}
                    style={styles.titleInput}
                    autoFocus
                  />

                  {/* 알림·반복을 한 카드 안에 슬림한 행으로 묶어 시각적 무게를 줄인다. */}
                  <View style={styles.optionCard}>
                    <View style={styles.optionRow}>
                      <Text style={styles.optionLabel}>당일 알림</Text>
                      <Switch
                        value={remindEnabled}
                        onValueChange={setRemindEnabled}
                        trackColor={{ true: "#ef5b2b", false: "#d8cdb6" }}
                        thumbColor="#fff"
                      />
                    </View>
                    {remindEnabled && (
                      <Pressable
                        style={styles.optionPill}
                        onPress={() => setShowTimePicker(true)}
                        android_ripple={{ color: "#f8d4c4" }}
                      >
                        <Text style={styles.optionPillText}>{formatAmPmTime(remindHour, remindMinute)}</Text>
                        <Text style={styles.optionPillHint}>탭해서 변경 ⌄</Text>
                      </Pressable>
                    )}

                  <Modal
                    visible={showTimePicker}
                    transparent
                    animationType="fade"
                    statusBarTranslucent
                    navigationBarTranslucent
                    onRequestClose={() => setShowTimePicker(false)}
                  >
                    {/* backdrop과 시트를 부모/자식이 아니라 형제로 둔다 — Pressable로 감싸서
                        stopPropagation을 걸면, 그 Pressable이 터치 리스폰더를 먼저 가로채서 안의
                        WheelPicker FlatList가 스크롤을 못 받는다(메인 상세 모달에서 이미 겪은 것과
                        같은 문제). 시트가 backdrop 위에 그려지므로 stopPropagation 없이도 시트
                        영역을 누르면 자연히 backdrop이 아니라 시트(그 자식)가 터치를 받는다. */}
                    <View style={styles.timePickerRoot}>
                      <Pressable
                        style={styles.timePickerBackdrop}
                        onPress={() => setShowTimePicker(false)}
                        android_ripple={{ color: "transparent" }}
                      />
                      <View style={styles.timePickerSheet}>
                        <Text style={[styles.formLabel, { textAlign: "center" }]}>알림 시각</Text>
                        <View style={styles.timePickerRow}>
                          <WheelPicker
                            items={[
                              { label: "오전", value: "AM" as const },
                              { label: "오후", value: "PM" as const },
                            ]}
                            selectedValue={remindHour < 12 ? "AM" : "PM"}
                            onChange={(period) => {
                              const h12 = remindHour % 12 === 0 ? 12 : remindHour % 12;
                              setRemindHour((h12 % 12) + (period === "PM" ? 12 : 0));
                            }}
                          />
                          <WheelPicker
                            items={Array.from({ length: 12 }, (_, i) => i + 1).map((h) => ({
                              label: `${h}시`,
                              value: h,
                            }))}
                            selectedValue={remindHour % 12 === 0 ? 12 : remindHour % 12}
                            onChange={(h12) => {
                              const isPM = remindHour >= 12;
                              setRemindHour((h12 % 12) + (isPM ? 12 : 0));
                            }}
                          />
                          <WheelPicker
                            items={Array.from({ length: 12 }, (_, i) => i * 5).map((m) => ({
                              label: `${pad(m)}분`,
                              value: m,
                            }))}
                            selectedValue={remindMinute - (remindMinute % 5)}
                            onChange={(m) => setRemindMinute(m)}
                          />
                        </View>
                        <Pressable
                          style={[styles.submitBtn, { marginTop: 16 }]}
                          onPress={() => setShowTimePicker(false)}
                          android_ripple={{ color: "#c2410c" }}
                        >
                          <Text style={styles.submitBtnText}>완료</Text>
                        </Pressable>
                      </View>
                    </View>
                  </Modal>

                  {!editing && (
                    <>
                      <View style={styles.optionDivider} />
                      <View style={styles.optionRow}>
                        <Text style={styles.optionLabel}>
                          매주 {WEEKDAYS[new Date(`${selected}T00:00:00`).getDay()]}요일 반복
                        </Text>
                        <Switch
                          value={repeatEnabled}
                          onValueChange={setRepeatEnabled}
                          trackColor={{ true: "#2f74d0", false: "#d8cdb6" }}
                          thumbColor="#fff"
                        />
                      </View>
                      {repeatEnabled && (
                        <Pressable
                          style={[styles.optionPill, styles.optionPillBlue]}
                          onPress={() => {
                            // 처음 열 때 기본값을 시작일로 채워, 완료를 눌러도 값이 비지 않게 한다.
                            if (!repeatUntil) setRepeatUntil(selected);
                            setShowDatePicker(true);
                          }}
                          android_ripple={{ color: "#dfe8f5" }}
                        >
                          <Text style={styles.optionPillTextBlue}>
                            {repeatUntil ? `${repeatUntil} 까지` : "종료일 선택"}
                          </Text>
                          <Text style={styles.optionPillHint}>탭해서 변경 ⌄</Text>
                        </Pressable>
                      )}
                      {/* 반복 종료일 — 시각/날짜와 동일한 커스텀 휠 피커로 통일 */}
                      <Modal
                        visible={showDatePicker}
                        transparent
                        animationType="fade"
                        statusBarTranslucent
                        navigationBarTranslucent
                        onRequestClose={() => setShowDatePicker(false)}
                      >
                        <View style={styles.timePickerRoot}>
                          <Pressable
                            style={styles.timePickerBackdrop}
                            onPress={() => setShowDatePicker(false)}
                            android_ripple={{ color: "transparent" }}
                          />
                          <View style={styles.timePickerSheet}>
                            <Text style={[styles.formLabel, { textAlign: "center" }]}>반복 종료일</Text>
                            <View style={styles.timePickerRow}>
                              <WheelPicker
                                items={endYears.map((y) => ({ label: `${y}년`, value: y }))}
                                selectedValue={endYear}
                                onChange={(y) => setEndDatePart({ y })}
                              />
                              <WheelPicker
                                items={Array.from({ length: 12 }, (_, i) => i + 1).map((m) => ({ label: `${m}월`, value: m }))}
                                selectedValue={endMonth}
                                onChange={(m) => setEndDatePart({ m })}
                              />
                              <WheelPicker
                                items={Array.from({ length: daysInEndMonth }, (_, i) => i + 1).map((d) => ({ label: `${d}일`, value: d }))}
                                selectedValue={endDay}
                                onChange={(d) => setEndDatePart({ d })}
                              />
                            </View>
                            <Pressable
                              style={[styles.submitBtn, { marginTop: 16 }]}
                              onPress={() => setShowDatePicker(false)}
                              android_ripple={{ color: "#c2410c" }}
                            >
                              <Text style={styles.submitBtnText}>완료</Text>
                            </Pressable>
                          </View>
                        </View>
                      </Modal>
                    </>
                  )}
                  </View>
                </Pressable>
                </ScrollView>

                {/* 키보드가 떠도 시트는 그대로라 이 줄은 늘 시트 맨 아래 = 화면 맨 아래에 있다.
                    네비게이션 바를 피하는 여백은 항상 필요하다. */}
                <View style={[styles.footerRow, { paddingBottom: 24 + insets.bottom }]}>
                  <Pressable
                    onPress={onSubmit}
                    disabled={!title.trim() || (repeatEnabled && !repeatUntil) || submitting}
                    style={[
                      styles.submitBtn,
                      (!title.trim() || (repeatEnabled && !repeatUntil) || submitting) && styles.buttonDisabled,
                    ]}
                    android_ripple={{ color: "#c2410c" }}
                  >
                    {submitting ? (
                      <ActivityIndicator color="#fdf8f0" />
                    ) : (
                      <Text style={styles.submitBtnText}>{editing ? "수정 저장" : "추가"}</Text>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setShowEventDatePicker(false);
                      setShowDatePicker(false);
                      setFormOpen(false);
                    }}
                    style={styles.cancelBtn}
                    android_ripple={{ color: "#ecdfc0" }}
                  >
                    <Text style={styles.cancelBtnText}>취소</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <ScrollView
                  ref={eventListRef}
                  style={styles.sheetScroll}
                  keyboardShouldPersistTaps="handled"
                >
                  {selectedEvents.length === 0 ? (
                    <Text style={styles.emptyText}>등록된 일정이 없습니다.</Text>
                  ) : (
                    <View style={styles.eventList}>
                      {selectedEvents.map((e, i) => {
                        const c = CHIP_COLORS[i % CHIP_COLORS.length];
                        // 낙관적으로 추가된(서버 저장 전) 항목은 아직 진짜 uuid가 없어서, 이 상태로
                        // 수정/삭제하면 서버에서 uuid 오류가 난다 — 저장이 끝날 때까지 액션을 막는다.
                        const pending = e.id.startsWith("optimistic-");
                        return (
                          // 카드 아무 데나 눌러도 수정 폼으로 넘어간다. 안쪽 "수정"/"삭제" 버튼은
                          // 자식 Pressable이 터치 리스폰더를 먼저 가져가므로 각자 동작한다.
                          <Pressable
                            key={e.id}
                            onPress={() => startEdit(e)}
                            disabled={pending}
                            style={[styles.eventCard, { borderLeftColor: c.border }]}
                            android_ripple={{ color: "#f6e9d1", borderless: false }}
                            accessibilityRole="button"
                            accessibilityLabel={`${e.title} 수정`}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={styles.eventTitle}>{e.title}</Text>
                              {e.memo && <Text style={styles.eventMemo}>{e.memo}</Text>}
                              {e.remind_at && (
                                <View style={styles.remindBadge}>
                                  <Text style={styles.remindBadgeText}>
                                    🔔 당일{" "}
                                    {formatAmPmTime(
                                      hourMinuteFromIso(e.remind_at).hour,
                                      hourMinuteFromIso(e.remind_at).minute,
                                    )}
                                  </Text>
                                </View>
                              )}
                            </View>
                            <View style={styles.eventActions}>
                              {pending ? (
                                <Text style={styles.savingText}>저장 중…</Text>
                              ) : (
                                <>
                                  <Pressable
                                    onPress={() => startEdit(e)}
                                    hitSlop={8}
                                    style={styles.actionBtn}
                                    android_ripple={{ color: "#ecdfc0", borderless: true }}
                                  >
                                    <Text style={styles.actionText}>수정</Text>
                                  </Pressable>
                                  <Pressable
                                    onPress={() => onDelete(e)}
                                    hitSlop={8}
                                    style={styles.actionBtn}
                                    android_ripple={{ color: "#f3d0c8", borderless: true }}
                                  >
                                    <Text style={[styles.actionText, styles.deleteText]}>삭제</Text>
                                  </Pressable>
                                </>
                              )}
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </ScrollView>

                <View style={[styles.formArea, { paddingBottom: 24 + insets.bottom }]}>
                  <Pressable
                    onPress={openAddForm}
                    style={[styles.submitBtn, { flex: 0 }]}
                    android_ripple={{ color: "#c2410c" }}
                  >
                    <Text style={styles.submitBtnText}>+ 일정 추가</Text>
                  </Pressable>
                </View>
              </>
            )}
          </Animated.View>
        </View>
        </GestureHandlerRootView>
      </Modal>

      {/* 년/월 점프 — 헤더 제목을 누르면 열린다. 연도는 좌우 화살표로, 달은 눌러서 바로 이동. */}
      <Modal
        visible={jumpOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setJumpOpen(false)}
      >
        <View style={styles.timePickerRoot}>
          <Pressable
            style={styles.timePickerBackdrop}
            onPress={() => setJumpOpen(false)}
            android_ripple={{ color: "transparent" }}
          />
          <View style={styles.jumpSheet}>
            <View style={styles.jumpYearRow}>
              <Pressable
                onPress={() => setJumpYear((y) => y - 1)}
                disabled={jumpYear <= firstYear}
                style={styles.chevronBtn}
                hitSlop={8}
              >
                <Text style={[styles.chevronText, jumpYear <= firstYear && styles.chevronTextOff]}>
                  ‹
                </Text>
              </Pressable>
              <Text style={styles.jumpYearText}>{jumpYear}년</Text>
              <Pressable
                onPress={() => setJumpYear((y) => y + 1)}
                disabled={jumpYear >= lastYear}
                style={styles.chevronBtn}
                hitSlop={8}
              >
                <Text style={[styles.chevronText, jumpYear >= lastYear && styles.chevronTextOff]}>
                  ›
                </Text>
              </Pressable>
            </View>
            <View style={styles.jumpGrid}>
              {Array.from({ length: 12 }, (_, m) => {
                const index = pageIndexOf(jumpYear, m);
                const isCurrent = jumpYear === year && m === month;
                return (
                  <Pressable
                    key={m}
                    disabled={index === null}
                    onPress={() => index !== null && jumpTo(index)}
                    style={[
                      styles.jumpCell,
                      isCurrent && styles.jumpCellActive,
                      index === null && styles.jumpCellOff,
                    ]}
                    android_ripple={{ color: "#f6e9d1", borderless: false }}
                  >
                    <Text style={[styles.jumpCellText, isCurrent && styles.jumpCellTextActive]}>
                      {m + 1}월
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>

      {/* 햄버거 메뉴 — 헤더 오른쪽 버튼 아래에 붙는 작은 팝오버. */}
      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable style={styles.backdropTouch} onPress={() => setMenuOpen(false)} />
        <View style={[styles.menuCard, { top: insets.top + 56 }]}>
          <Pressable
            onPress={() => {
              setMenuOpen(false);
              onOpenInbox();
            }}
            style={styles.menuItem}
            android_ripple={{ color: "#f6e9d1", borderless: false }}
          >
            <Text style={styles.menuItemText}>알림함</Text>
            {unhandledCount > 0 && (
              <View style={styles.menuCountPill}>
                <Text style={styles.menuCountText}>{unhandledCount}</Text>
              </View>
            )}
          </Pressable>
          <View style={styles.menuDivider} />
          {onOpenNotificationAccess && (
            <>
              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  onOpenNotificationAccess();
                }}
                style={styles.menuItem}
                android_ripple={{ color: "#f6e9d1", borderless: false }}
              >
                <Text style={styles.menuItemText}>알림감지</Text>
              </Pressable>
              <View style={styles.menuDivider} />
            </>
          )}
          <Pressable
            onPress={() => {
              setMenuOpen(false);
              void supabase.auth.signOut();
            }}
            style={styles.menuItem}
            android_ripple={{ color: "#f6e9d1", borderless: false }}
          >
            <Text style={[styles.menuItemText, styles.menuItemDanger]}>로그아웃</Text>
          </Pressable>
        </View>
      </Modal>

      {/* 예약된 로컬알람 확인용(디버그) — FAB 길게 누르면 열림. 실기기에서 실제 OS 예약 상태를 본다. */}
      <Modal
        visible={alarmsOpen}
        animationType="fade"
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setAlarmsOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setAlarmsOpen(false)} />
        <View style={[styles.alarmsCard, { marginBottom: insets.bottom + 20, marginTop: insets.top + 20 }]}>
          <View style={styles.alarmsHeader}>
            <Text style={styles.alarmsTitle}>예약된 알람 {scheduledAlarms.length}개</Text>
            <Pressable onPress={openScheduledAlarms} hitSlop={8}>
              <Text style={styles.alarmsRefresh}>새로고침</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.alarmsList}>
            {scheduledAlarms.length === 0 ? (
              <Text style={styles.alarmsEmpty}>예약된 로컬알람이 없습니다.</Text>
            ) : (
              scheduledAlarms.map((a) => (
                <View key={a.id} style={styles.alarmRow}>
                  <Text style={styles.alarmWhen}>{a.date ? a.date.toLocaleString() : "시각 미상"}</Text>
                  <Text style={styles.alarmTitle} numberOfLines={1}>
                    {a.title}
                  </Text>
                </View>
              ))
            )}
          </ScrollView>
          <Pressable style={styles.alarmsClose} onPress={() => setAlarmsOpen(false)}>
            <Text style={styles.alarmsCloseText}>닫기</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

/** 달력 페이지 하나(그리드+칩) — 그리드는 순수 계산이라 항상 즉시 보이고, 칩은 자기 몫의
 * 일정 데이터를 따로 불러와서(enabled일 때만) 채워 넣는다. enabled는 부모(CalendarScreen)가
 * settledPageIndex 기준으로 이미 디바운스해서 내려준다 — 스쳐 지나가는 페이지는 잠깐도
 * true가 되지 않는다. */
function MonthPageView({
  page,
  height,
  isNear,
  isCurrent,
  isSettled,
  today,
  selected,
  onSelectDay,
}: {
  page: MonthPage;
  height: number;
  /** 현재 페이지 근처라 실제로 그려야 하는 달인지. 멀리 있는 달은 같은 높이의 빈 자리로만 둔다. */
  isNear: boolean;
  isCurrent: boolean;
  isSettled: boolean;
  today: Date;
  selected: string;
  onSelectDay: (iso: string) => void;
}) {
  const from = toISO(page.grid[0]);
  const to = toISO(page.grid[page.grid.length - 1]);

  // 이미 캐시된 페이지는(전에 한 번 방문해서 데이터를 받아둔 달) 정착(200ms 디바운스)을 기다릴
  // 필요 없이 화면에 들어오는 즉시(isCurrent) 그대로 보여준다 — 새 요청이 필요 없으니까.
  // 아직 한 번도 안 받아본 페이지만 정착될 때까지(isSettled) fetch를 미뤄서, 빠르게 스쳐
  // 지나가는 중에는 새 요청이 나가지 않게 한다.
  const qc = useQueryClient();
  const hasCache = qc.getQueryData(["schedules", from, to]) !== undefined;
  const enabled = isCurrent && (hasCache || isSettled);
  const { data } = useSchedules({ from, to }, { enabled });
  const byDate = useMemo(() => {
    const map = new Map<string, ScheduleItem[]>();
    for (const s of data ?? []) {
      const list = map.get(s.date) ?? [];
      list.push(s);
      map.set(s.date, list);
    }
    return map;
  }, [data]);

  // 훅은 위에서 모두 호출한 뒤에 걸러낸다(조건부 훅 금지). 멀리 있는 달은 자리(높이)만 차지.
  if (!isNear) return <View style={{ height: height || undefined }} />;

  const weeks: Date[][] = [];
  for (let i = 0; i < page.grid.length; i += 7) weeks.push(page.grid.slice(i, i + 7));

  return (
    <View style={{ height: height || undefined }}>
      {weeks.map((week, wi) => (
        <View key={wi} style={styles.weekRow}>
          {week.map((d) => {
            const iso = toISO(d);
            const inMonth = d.getMonth() === page.month;
            const events = byDate.get(iso) ?? [];
            const isSelected = iso === selected;
            const isToday = iso === toISO(today);
            const dow = d.getDay();
            const active = isToday || isSelected;
            return (
              <Pressable
                key={iso}
                onPress={() => onSelectDay(iso)}
                style={[styles.dayCell, isSelected && styles.dayCellSelected, !inMonth && styles.dayCellDim]}
                android_ripple={{ color: "#ecdfc0" }}
              >
                <View
                  style={[
                    styles.dayNumber,
                    isToday && styles.dayNumberToday,
                    !isToday && isSelected && styles.dayNumberSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayNumberText,
                      !active && dow === 0 && styles.sunText,
                      !active && dow === 6 && styles.satText,
                      active && styles.dayNumberTextActive,
                    ]}
                  >
                    {d.getDate()}
                  </Text>
                </View>
                {events.slice(0, MAX_CHIPS).map((e, i) => {
                  const c = CHIP_COLORS[i % CHIP_COLORS.length];
                  return (
                    <View key={e.id} style={[styles.chip, { backgroundColor: c.bg, borderLeftColor: c.border }]}>
                      <Text numberOfLines={1} style={[styles.chipText, { color: c.text }]}>
                        {e.title}
                      </Text>
                    </View>
                  );
                })}
                {events.length > MAX_CHIPS && <Text style={styles.moreText}>+{events.length - MAX_CHIPS}</Text>}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fdf8f0" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  // 헤더는 왼쪽(달 이동) / 오른쪽(오늘·메뉴) 두 덩어리. 왼쪽이 남는 폭을 다 먹고 제목만
  // 줄어들게 해서(headerLeft flex:1 + 제목 flexShrink) 좁은 화면에서도 버튼이 안 잘린다.
  headerLeft: { flex: 1, flexDirection: "row", alignItems: "center", minWidth: 0 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 },
  chevronBtn: { width: 30, height: 36, alignItems: "center", justifyContent: "center" },
  chevronText: { fontSize: 26, lineHeight: 30, color: "#8a7f6a", marginTop: -3 },
  chevronTextOff: { color: "#ded3bc" },
  titleBtn: { flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 4, paddingVertical: 4, borderRadius: 10 },
  headerTitle: { flexShrink: 1, fontSize: 20, fontWeight: "800", color: "#1f1b16", letterSpacing: -0.3 },
  headerYear: { fontSize: 20, fontWeight: "800", color: "#ef5b2b" },
  headerCaret: { fontSize: 12, color: "#a99e88", fontWeight: "700", marginTop: 2 },
  todayPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: "#ffe6da" },
  todayPillText: { fontSize: 12, color: "#c2410c", fontWeight: "700" },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "#fff", borderWidth: 1, borderColor: "#efe4cd", overflow: "hidden" },
  iconBtnText: { fontSize: 16, lineHeight: 18, color: "#1f1b16" },

  // 년/월 점프 시트
  jumpSheet: { width: "84%", backgroundColor: "#fdf8f0", borderRadius: 22, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
  jumpYearRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, paddingVertical: 10 },
  jumpYearText: { fontSize: 19, fontWeight: "800", color: "#1f1b16", minWidth: 84, textAlign: "center" },
  jumpGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 8 },
  jumpCell: { width: "23%", height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#fff", borderWidth: 1, borderColor: "#efe4cd", overflow: "hidden" },
  jumpCellActive: { backgroundColor: "#ef5b2b", borderColor: "#ef5b2b" },
  jumpCellOff: { opacity: 0.35 },
  jumpCellText: { fontSize: 14, fontWeight: "700", color: "#1f1b16" },
  jumpCellTextActive: { color: "#fff" },

  // 햄버거 메뉴 팝오버(헤더 오른쪽 아래에 붙음)
  menuCard: {
    position: "absolute",
    right: 16,
    minWidth: 152,
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#efe4cd",
    overflow: "hidden",
    shadowColor: "#a3350f",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  },
  menuItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  menuItemText: { fontSize: 15, fontWeight: "700", color: "#1f1b16" },
  menuCountPill: { minWidth: 22, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: "#ef5b2b", alignItems: "center" },
  menuCountText: { fontSize: 11.5, fontWeight: "800", color: "#fff" },
  // ☰ 위에 겹치는 미확인 표시(숫자는 메뉴 안에서 보여준다).
  menuBadge: { position: "absolute", top: -1, right: -1, width: 10, height: 10, borderRadius: 5, backgroundColor: "#ef5b2b", borderWidth: 2, borderColor: "#fdf8f0" },
  menuItemDanger: { color: "#c2410c" },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#e6dcc6" },
  weekdayRow: { flexDirection: "row", paddingBottom: 2 },
  gridArea: { flex: 1, overflow: "hidden" },
  weekdayText: { flex: 1, textAlign: "center", paddingVertical: 8, fontSize: 12, fontWeight: "700", color: "#8a7f6a" },
  sunText: { color: "#e05b4a" },
  satText: { color: "#3072cf" },
  weekRow: { flexDirection: "row", flexGrow: 1, minHeight: 76 },
  dayCell: { flex: 1, paddingHorizontal: 3, paddingTop: 4, paddingBottom: 2, borderTopWidth: StyleSheet.hairlineWidth, borderColor: "#efe4cd", alignItems: "stretch" },
  dayCellSelected: { backgroundColor: "#fbf0dc" },
  dayCellDim: { opacity: 0.3 },
  dayNumber: { alignSelf: "center", minWidth: 24, height: 24, paddingHorizontal: 2, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dayNumberToday: { backgroundColor: "#ef5b2b" },
  dayNumberSelected: { backgroundColor: "#1f1b16" },
  dayNumberText: { fontSize: 13, fontWeight: "700", color: "#1f1b16" },
  dayNumberTextActive: { color: "#fff" },
  chip: { borderLeftWidth: 1, borderTopRightRadius: 4, borderBottomRightRadius: 4, paddingLeft: 4, paddingRight: 3, paddingVertical: 2, marginTop: 3 },
  chipText: { fontSize: 9.5, fontWeight: "700" },
  moreText: { fontSize: 9, color: "#a99e88", marginTop: 2, fontWeight: "600", paddingLeft: 2 },

  // 우하단 플로팅 추가 버튼
  fab: {
    position: "absolute",
    right: 20,
    bottom: 20, // 실제 하단 오프셋은 렌더에서 insets.bottom을 더해 지정(네브바 겹침 방지) — 여긴 폴백값

    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#ef5b2b",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: "#a3350f",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  fabPlus: { color: "#fff", fontSize: 30, fontWeight: "400", marginTop: -2 },

  modalRoot: { flex: 1 },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)" },
  // 어둠막 위의 투명한 탭 감지 레이어(탭하면 닫힘). 시각은 위 backdrop이 담당.
  backdropTouch: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },

  // 예약된 알람 확인 모달(디버그)
  alarmsCard: {
    position: "absolute",
    left: 16,
    right: 16,
    top: 0,
    bottom: 0,
    backgroundColor: "#fdf8f0",
    borderRadius: 20,
    padding: 16,
  },
  alarmsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  alarmsTitle: { fontSize: 17, fontWeight: "800", color: "#1f1b16" },
  alarmsRefresh: { fontSize: 14, fontWeight: "700", color: "#ef5b2b", padding: 4 },
  alarmsList: { flex: 1 },
  alarmsEmpty: { textAlign: "center", color: "#a99e88", fontSize: 14, paddingVertical: 40 },
  alarmRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#e6dcc6" },
  alarmWhen: { fontSize: 14, fontWeight: "700", color: "#9a3411" },
  alarmTitle: { fontSize: 13, color: "#6b6250", marginTop: 2 },
  alarmsClose: { marginTop: 12, height: 48, borderRadius: 14, backgroundColor: "#ef5b2b", alignItems: "center", justifyContent: "center" },
  alarmsCloseText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "85%",
    backgroundColor: "#fdf8f0",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 8,
    paddingHorizontal: 24,
  },
  sheetScroll: { flex: 1 },
  sheetHandle: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: "#e3d6b8", marginTop: 6, marginBottom: 14 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  sheetTitle: { fontSize: 22, fontWeight: "800", color: "#1f1b16", letterSpacing: -0.3 },
  datePickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#ef5b2b",
    borderRadius: 999,
    paddingLeft: 14,
    paddingRight: 12,
    paddingVertical: 9,
    overflow: "hidden",
  },
  datePickerIcon: { fontSize: 15 },
  datePickerText: { fontSize: 18, fontWeight: "800", color: "#1f1b16", letterSpacing: -0.3 },
  datePickerCaret: { fontSize: 15, fontWeight: "900", color: "#ef5b2b", marginTop: -1 },
  formArea: { marginTop: 8, paddingTop: 12 },
  footerRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  closeText: { fontSize: 16, color: "#8a7f6a", padding: 6 },
  emptyText: { marginTop: 24, textAlign: "center", color: "#a99e88", fontSize: 14, borderWidth: 1.5, borderStyle: "dashed", borderColor: "#e3d6b8", borderRadius: 18, paddingVertical: 32, paddingHorizontal: 20 },
  eventList: { marginTop: 12, gap: 10 },
  eventCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
    borderLeftWidth: 2.5,
    borderLeftColor: "#ef5b2b",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 8,
  },
  eventTitle: { fontSize: 16, fontWeight: "700", color: "#1f1b16" },
  eventMemo: { marginTop: 4, fontSize: 13, color: "#6b6152", lineHeight: 18 },
  remindBadge: { alignSelf: "flex-start", marginTop: 8, backgroundColor: "#ffe6da", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  remindBadgeText: { fontSize: 11.5, fontWeight: "700", color: "#c2410c" },
  eventActions: { flexDirection: "row", gap: 2 },
  actionBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  actionText: { fontSize: 13, fontWeight: "700", color: "#8a7f6a" },
  deleteText: { color: "#e23d2e" },
  savingText: { fontSize: 13, fontWeight: "700", color: "#b0a68f", fontStyle: "italic", paddingHorizontal: 8 },
  formLabel: { fontSize: 13, fontWeight: "700", color: "#8a7f6a", marginBottom: 8, marginTop: 4 },
  titleInput: { borderWidth: 1.5, borderColor: "#e6dcc6", borderRadius: 14, backgroundColor: "#fff", paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, color: "#1f1b16" },

  // 알림·반복 옵션 — 하나의 카드에 슬림한 행 + 얇은 구분선으로 묶어 무게를 줄임
  optionCard: { backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#e6dcc6", borderRadius: 16, paddingHorizontal: 16, marginTop: 12 },
  optionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13 },
  optionLabel: { fontSize: 15, fontWeight: "600", color: "#1f1b16" },
  optionDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#eadfc7" },
  optionPill: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 13, backgroundColor: "#fbf0dc", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, overflow: "hidden" },
  optionPillBlue: { backgroundColor: "#e2eefb" },
  optionPillText: { fontSize: 16, fontWeight: "800", color: "#c2410c" },
  optionPillTextBlue: { fontSize: 15, fontWeight: "800", color: "#1b4a88" },
  optionPillHint: { fontSize: 12, color: "#a99e88", fontWeight: "600" },
  timePickerRoot: { flex: 1, alignItems: "center", justifyContent: "center" },
  timePickerBackdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)" },
  timePickerSheet: {
    width: "86%",
    backgroundColor: "#fdf8f0",
    borderRadius: 24,
    padding: 20,
  },
  timePickerRow: { flexDirection: "row", justifyContent: "center", gap: 4, marginTop: 12 },
  submitBtn: { flex: 1, height: 52, borderRadius: 18, backgroundColor: "#ef5b2b", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  submitBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  cancelBtn: { height: 52, paddingHorizontal: 20, borderRadius: 18, borderWidth: 1.5, borderColor: "#e6dcc6", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  cancelBtnText: { fontSize: 15, fontWeight: "600", color: "#1f1b16" },
  buttonDisabled: { opacity: 0.45 },
});
