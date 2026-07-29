import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import WheelPicker from "../components/WheelPicker";
import { isValidIsoDate, pad, reminderIsoFor, toISO } from "../lib/calendar";
import { CATEGORY_COLORS, fmtWhen } from "../lib/inbox";
import {
  useCreateScheduleFromEvent,
  useMarkAllHandled,
  useNotifications,
  useSetCategory,
  useSetHandled,
} from "../hooks/notifications";
import {
  NOTIFICATION_CATEGORIES,
  SOURCE_LABELS,
  type NotificationCategory,
  type NotificationEvent,
} from "../types";

type Tab = NotificationCategory | "전체";

/**
 * 알림함 — 웹 /admin/notifications와 같은 목록·액션을 앱에서 그대로.
 *
 * 새 알림은 Realtime으로 들어온다(App.tsx의 notification_events 채널이 ["notifications"]를
 * 무효화 → 이 화면의 useNotifications가 다시 조회). 여기서는 그 결과를 그리기만 한다.
 */
export default function NotificationsScreen({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  // 카테고리는 8개라 칩을 가로로 늘어놓으면 스크롤해야 닿는다 — 버튼 하나 + 시트로 고른다.
  const [tab, setTab] = useState<Tab>("전체");
  const [filterOpen, setFilterOpen] = useState(false);
  const [onlyUnhandled, setOnlyUnhandled] = useState(false);
  const { data, isPending, isError, error, refetch, isRefetching } = useNotifications();

  // 내비게이션 라이브러리 없이 화면을 갈아 끼우는 구조라, 기기 뒤로가기를 직접 달아준다
  // (안 달면 알림함에서 뒤로가기가 앱을 종료시킨다).
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  const items = useMemo(() => data ?? [], [data]);

  // 미확인 토글이 먼저 걸린다 — 시트에 보이는 건수도 이 기준으로 세야 "0건인데 눌러진다"가 없다.
  const base = useMemo(
    () => (onlyUnhandled ? items.filter((e) => !e.handled) : items),
    [items, onlyUnhandled],
  );

  const visible = useMemo(() => {
    const inTab = tab === "전체" ? base : base.filter((e) => e.category === tab);
    // 확인 완료한 건은 아래로. 안정 정렬이라 각 그룹 안에서는 최신순(posted_at desc)이 유지된다.
    return [...inTab].sort((a, b) => Number(a.handled) - Number(b.handled));
  }, [base, tab]);

  const unhandled = items.filter((e) => !e.handled).length;
  const countFor = (t: Tab) =>
    t === "전체" ? base.length : base.filter((e) => e.category === t).length;

  const markAll = useMarkAllHandled();

  // 한 번에 여러 건의 상태를 바꾸는 데다 되돌리려면 카드마다 눌러야 해서 한 번 되묻는다.
  function confirmMarkAll() {
    Alert.alert("전체 읽음", `미확인 ${unhandled}건을 모두 확인 완료로 바꿀까요?`, [
      { text: "취소", style: "cancel" },
      { text: "확인", onPress: () => markAll.mutate() },
    ]);
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={onBack} style={styles.backBtn} hitSlop={8}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>알림함</Text>
          <Text style={styles.subtitle}>
            {unhandled > 0 ? `미확인 ${unhandled}건` : "모두 확인했습니다"}
          </Text>
        </View>
        {unhandled > 0 && (
          <Pressable
            disabled={markAll.isPending}
            onPress={confirmMarkAll}
            style={styles.headerBtn}
            android_ripple={{ color: "#f6e9d1", borderless: false }}
          >
            <Text style={styles.headerBtnText}>
              {markAll.isPending ? "처리 중…" : "전체 읽음"}
            </Text>
          </Pressable>
        )}
      </View>

      <View style={styles.filterRow}>
        <Pressable
          onPress={() => setFilterOpen(true)}
          style={[styles.filterBtn, tab !== "전체" && styles.filterBtnActive]}
          android_ripple={{ color: "#f6e9d1", borderless: false }}
        >
          <Text style={[styles.filterBtnText, tab !== "전체" && styles.filterBtnTextActive]}>
            {tab}
          </Text>
          <Text style={[styles.filterCount, tab !== "전체" && styles.filterCountActive]}>
            · {countFor(tab)}
          </Text>
          <Text style={[styles.filterCaret, tab !== "전체" && styles.filterCountActive]}>▾</Text>
        </Pressable>

        <Pressable
          onPress={() => setOnlyUnhandled((v) => !v)}
          style={[styles.toggleBtn, onlyUnhandled && styles.toggleBtnActive]}
          android_ripple={{ color: "#f8d4c4", borderless: false }}
        >
          <Text style={[styles.toggleText, onlyUnhandled && styles.toggleTextActive]}>
            미확인
          </Text>
        </Pressable>
      </View>

      {isPending ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>불러오지 못했습니다 — {(error as Error).message}</Text>
          <Pressable onPress={() => void refetch()} style={styles.retryBtn}>
            <Text style={styles.retryText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.listContent}
          onRefresh={() => void refetch()}
          refreshing={isRefetching}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              {onlyUnhandled
                ? "미확인 알림이 없습니다."
                : tab === "전체"
                  ? "아직 도착한 알림이 없습니다."
                  : `${tab}에 해당하는 알림이 없습니다.`}
            </Text>
          }
          renderItem={({ item }) => <EventCard event={item} />}
        />
      )}

      {/* 카테고리 선택 — 한 화면에 8개가 다 보이고, 각 건수는 미확인 토글까지 반영한 값이다. */}
      <Modal
        visible={filterOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setFilterOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setFilterOpen(false)} />
        <View style={styles.sheetWrap} pointerEvents="box-none">
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>카테고리</Text>
            {(["전체", ...NOTIFICATION_CATEGORIES] as Tab[]).map((t) => {
              const active = tab === t;
              const n = countFor(t);
              return (
                <Pressable
                  key={t}
                  onPress={() => {
                    setTab(t);
                    setFilterOpen(false);
                  }}
                  style={styles.sheetItem}
                  android_ripple={{ color: "#f6e9d1", borderless: false }}
                >
                  <Text style={[styles.sheetItemText, active && styles.sheetItemActive]}>{t}</Text>
                  <View style={styles.sheetItemRight}>
                    <Text style={[styles.sheetCount, n === 0 && styles.sheetCountZero]}>{n}</Text>
                    {active && <Text style={styles.sheetCheck}>✓</Text>}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function EventCard({ event }: { event: NotificationEvent }) {
  const [showBody, setShowBody] = useState(false);
  const [composing, setComposing] = useState(false);
  const [pickingCategory, setPickingCategory] = useState(false);

  const setHandled = useSetHandled();
  const setCategory = useSetCategory();

  const ex = event.extracted;
  const facts: [string, string][] = [];
  if (ex?.org) facts.push(["기관", ex.org]);
  if (ex?.date) facts.push(["날짜", ex.date]);
  if (ex?.time) facts.push(["시각", ex.time]);
  if (ex?.audience) facts.push(["대상", ex.audience]);
  if (ex?.headcount) facts.push(["인원", `${ex.headcount}명`]);
  if (ex?.amount) facts.push(["금액", ex.amount]);
  if (ex?.contact) facts.push(["연락처", ex.contact]);

  const categoryColor = event.category ? CATEGORY_COLORS[event.category] : null;

  return (
    <View style={[styles.card, event.handled && styles.cardHandled]}>
      {/*
        액션을 버튼으로 늘어놓지 않는다 — 확인 여부는 머리의 체크박스로, 유형 교정은 그 유형
        칩을 직접 눌러서(▾), 나머지는 카드 아래 글자 액션 한 줄로.
      */}
      <View style={styles.cardHead}>
        <View style={styles.chipRow}>
          <View style={styles.sourceChip}>
            <Text style={styles.sourceChipText}>{SOURCE_LABELS[event.source]}</Text>
          </View>
          <Pressable
            onPress={() => setPickingCategory(true)}
            disabled={setCategory.isPending}
            style={[
              styles.categoryChip,
              categoryColor ? { backgroundColor: categoryColor.bg } : styles.categoryChipEmpty,
            ]}
            android_ripple={{ color: "#00000012", borderless: false }}
          >
            <Text
              style={[
                styles.categoryChipText,
                { color: categoryColor ? categoryColor.text : "#8a7f6a" },
              ]}
            >
              {event.category ?? "유형 지정"} ▾
            </Text>
          </Pressable>
          {event.status === "pending" && (
            <View style={styles.plainChip}>
              <Text style={styles.plainChipText}>분류 중…</Text>
            </View>
          )}
          {event.status === "error" && (
            <View style={styles.errorChip}>
              <Text style={styles.errorChipText}>분류 실패</Text>
            </View>
          )}
        </View>

        {/* 확인 여부 = 이 알약 하나. 주황으로 차 있으면 아직 안 본 것. */}
        <Pressable
          disabled={setHandled.isPending}
          onPress={() => setHandled.mutate({ id: event.id, handled: !event.handled })}
          hitSlop={12}
          style={[styles.checkPill, event.handled && styles.checkPillDone]}
          android_ripple={{ color: "#00000012", borderless: false }}
        >
          <Text style={[styles.checkPillText, event.handled && styles.checkPillTextDone]}>
            {event.handled ? "확인됨" : "확인"}
          </Text>
        </Pressable>
      </View>

      <View style={styles.senderRow}>
        <Text style={styles.sender}>{event.sender || "발신자 없음"}</Text>
        <Text style={styles.when}>{fmtWhen(event.posted_at)}</Text>
      </View>

      <Text style={styles.summary}>{event.summary || event.body}</Text>

      {event.status === "error" && event.error && (
        <Text style={styles.errorText}>{event.error}</Text>
      )}

      {facts.length > 0 && (
        <View style={styles.factRow}>
          {facts.map(([k, v]) => (
            <View key={k} style={styles.fact}>
              <Text style={styles.factKey}>{k}</Text>
              <Text style={styles.factValue}>{v}</Text>
            </View>
          ))}
        </View>
      )}

      {/* 원문 보기와 일정 만들기는 같은 무게의 글자 액션으로 카드 아래 한 줄에 나란히 둔다 —
          큰 버튼 하나가 카드마다 반복되면 목록이 버튼 줄로 보인다. */}
      <View style={styles.footerRow}>
        {!!event.summary && (
          <Pressable onPress={() => setShowBody((v) => !v)} hitSlop={10}>
            <Text style={styles.footerMuted}>{showBody ? "원문 접기" : "원문 보기"}</Text>
          </Pressable>
        )}
        <View style={{ flex: 1 }} />
        {event.schedule_id ? (
          <Text style={styles.footerDone}>일정 등록됨</Text>
        ) : (
          <Pressable onPress={() => setComposing((v) => !v)} hitSlop={10}>
            <Text style={styles.footerAction}>{composing ? "닫기" : "일정 만들기 ›"}</Text>
          </Pressable>
        )}
      </View>

      {showBody && <Text style={styles.bodyText}>{event.body}</Text>}

      {composing && <ScheduleComposer event={event} onDone={() => setComposing(false)} />}

      {/* 유형 교정 — 웹의 <select>에 해당. */}
      <Modal
        visible={pickingCategory}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setPickingCategory(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setPickingCategory(false)} />
        <View style={styles.sheetWrap} pointerEvents="box-none">
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>유형 변경</Text>
            {NOTIFICATION_CATEGORIES.map((c) => (
              <Pressable
                key={c}
                onPress={() => {
                  setPickingCategory(false);
                  if (c !== event.category) setCategory.mutate({ id: event.id, category: c });
                }}
                style={styles.sheetItem}
                android_ripple={{ color: "#f6e9d1", borderless: false }}
              >
                <Text style={[styles.sheetItemText, c === event.category && styles.sheetItemActive]}>
                  {c}
                </Text>
                {c === event.category && <Text style={styles.sheetCheck}>✓</Text>}
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** 추출된 날짜·기관을 채워 넣은 일정 생성 폼. 값이 없거나 틀렸을 수 있으니 항상 확인 후 저장. */
function ScheduleComposer({
  event,
  onDone,
}: {
  event: NotificationEvent;
  onDone: () => void;
}) {
  const ex = event.extracted;
  const [date, setDate] = useState(ex?.date && isValidIsoDate(ex.date) ? ex.date : toISO(new Date()));
  const [title, setTitle] = useState(
    [ex?.org ?? event.sender ?? "", ex?.audience ?? ""].filter(Boolean).join(" · ") || "강의",
  );
  const [memo, setMemo] = useState(
    [ex?.time ? `${ex.time} 시작` : "", event.summary ?? ""].filter(Boolean).join("\n"),
  );
  const [remind, setRemind] = useState(true);
  const [showDate, setShowDate] = useState(false);

  const create = useCreateScheduleFromEvent();

  const [y, m, d] = date.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 1 + i);

  function setPart(part: { y?: number; m?: number; d?: number }) {
    const ny = part.y ?? y;
    const nm = part.m ?? m;
    const nd = Math.min(part.d ?? d, new Date(ny, nm, 0).getDate());
    setDate(`${ny}-${pad(nm)}-${pad(nd)}`);
  }

  const canSave = isValidIsoDate(date) && title.trim().length > 0 && !create.isPending;

  return (
    <View style={styles.composer}>
      <Text style={styles.formLabel}>날짜</Text>
      <Pressable
        onPress={() => setShowDate((v) => !v)}
        style={styles.dateBtn}
        android_ripple={{ color: "#f6e9d1", borderless: false }}
      >
        <Text style={styles.dateBtnText}>
          {y}년 {m}월 {d}일
        </Text>
        <Text style={styles.dateBtnCaret}>{showDate ? "▴" : "▾"}</Text>
      </Pressable>
      {showDate && (
        <View style={styles.wheelRow}>
          <WheelPicker
            items={years.map((v) => ({ label: `${v}년`, value: v }))}
            selectedValue={y}
            onChange={(v) => setPart({ y: v })}
          />
          <WheelPicker
            items={Array.from({ length: 12 }, (_, i) => i + 1).map((v) => ({
              label: `${v}월`,
              value: v,
            }))}
            selectedValue={m}
            onChange={(v) => setPart({ m: v })}
          />
          <WheelPicker
            items={Array.from({ length: daysInMonth }, (_, i) => i + 1).map((v) => ({
              label: `${v}일`,
              value: v,
            }))}
            selectedValue={d}
            onChange={(v) => setPart({ d: v })}
          />
        </View>
      )}

      <Text style={styles.formLabel}>제목</Text>
      <TextInput value={title} onChangeText={setTitle} style={styles.input} />

      <Text style={styles.formLabel}>메모</Text>
      <TextInput
        value={memo}
        onChangeText={setMemo}
        multiline
        style={[styles.input, styles.inputMultiline]}
      />

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>당일 오전 7시에 알림</Text>
        <Switch
          value={remind}
          onValueChange={setRemind}
          trackColor={{ true: "#ef5b2b", false: "#ded3bc" }}
          thumbColor="#fff"
        />
      </View>

      {!ex?.date && (
        <Text style={styles.hintText}>
          메시지에서 날짜를 찾지 못했습니다. 직접 확인해서 골라주세요.
        </Text>
      )}

      <View style={styles.composerActions}>
        <Pressable
          disabled={!canSave}
          onPress={() =>
            create.mutate(
              {
                id: event.id,
                date,
                title: title.trim(),
                memo: memo.trim(),
                remindAt: remind ? reminderIsoFor(date) : null,
              },
              { onSuccess: onDone },
            )
          }
          style={[styles.primaryBtn, styles.composerPrimary, !canSave && styles.btnDisabled]}
          android_ripple={{ color: "#3a332c", borderless: false }}
        >
          <Text style={styles.primaryBtnText}>
            {create.isPending ? "만드는 중…" : "일정 만들기"}
          </Text>
        </Pressable>
        <Pressable onPress={onDone} style={styles.ghostBtn} android_ripple={{ color: "#f6e9d1" }}>
          <Text style={styles.ghostBtnText}>취소</Text>
        </Pressable>
      </View>
      {create.isError && <Text style={styles.errorText}>{(create.error as Error).message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fdf8f0" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  backBtn: { width: 34, height: 38, alignItems: "center", justifyContent: "center" },
  backText: { fontSize: 28, lineHeight: 32, color: "#1f1b16", marginTop: -4 },
  title: { fontSize: 22, fontWeight: "800", color: "#1f1b16", letterSpacing: -0.3 },
  subtitle: { fontSize: 12.5, color: "#8a7f6a", marginTop: 2, fontWeight: "600" },
  headerBtn: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, backgroundColor: "#fff", borderWidth: 1, borderColor: "#efe4cd", overflow: "hidden" },
  headerBtnText: { fontSize: 13, fontWeight: "700", color: "#1f1b16" },

  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#e6dcc6",
  },
  filterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#efe4cd",
    overflow: "hidden",
  },
  filterBtnActive: { backgroundColor: "#1f1b16", borderColor: "#1f1b16" },
  filterBtnText: { fontSize: 14, fontWeight: "700", color: "#1f1b16" },
  filterBtnTextActive: { color: "#fdf8f0" },
  filterCount: { fontSize: 13, fontWeight: "700", color: "#a99e88" },
  filterCountActive: { color: "#d9cdb8" },
  filterCaret: { fontSize: 11, color: "#a99e88", marginLeft: 1 },
  toggleBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#efe4cd",
    overflow: "hidden",
  },
  toggleBtnActive: { backgroundColor: "#ffe6da", borderColor: "#f6c3ac" },
  toggleText: { fontSize: 14, fontWeight: "700", color: "#8a7f6a" },
  toggleTextActive: { color: "#c2410c" },

  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  listContent: { padding: 16, gap: 12, paddingBottom: 40 },
  emptyText: { textAlign: "center", color: "#a99e88", fontSize: 15, paddingVertical: 60 },
  retryBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: "#1f1b16" },
  retryText: { fontSize: 14, fontWeight: "700", color: "#1f1b16" },

  card: { backgroundColor: "#fffdf8", borderRadius: 20, padding: 16, borderWidth: 1, borderColor: "#eee2cf" },
  cardHandled: { opacity: 0.55 },
  // 머리(출처·유형·확인)와 본문도 아래 액션 줄과 같은 얇은 선으로 나눈다.
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingBottom: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#e9dfcb",
  },
  chipRow: { flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 5 },
  sourceChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: "#f3ece0" },
  sourceChipText: { fontSize: 11, fontWeight: "700", color: "#6b6250" },
  // 유형 칩은 눌러서 교정하는 버튼이기도 하다(▾).
  categoryChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, overflow: "hidden" },
  categoryChipEmpty: { borderWidth: 1, borderColor: "#e6dcc6", borderStyle: "dashed" },
  categoryChipText: { fontSize: 11, fontWeight: "700" },
  // 확인 여부 = 이 알약 하나. 미확인이면 주황(읽지 않음 표시 겸용), 확인하면 회색 테두리만.
  checkPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: "#ef5b2b", overflow: "hidden" },
  checkPillDone: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#ded3bc" },
  checkPillText: { fontSize: 11.5, fontWeight: "800", color: "#fff" },
  checkPillTextDone: { color: "#a99e88" },
  plainChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderColor: "#e6dcc6" },
  plainChipText: { fontSize: 11, color: "#8a7f6a" },
  errorChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: "#fbdcd8" },
  errorChipText: { fontSize: 11, fontWeight: "700", color: "#a32b1c" },

  senderRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 12, flexWrap: "wrap" },
  sender: { fontSize: 15, fontWeight: "700", color: "#1f1b16" },
  when: { fontSize: 12, color: "#a99e88", fontWeight: "600" },
  summary: { fontSize: 16, lineHeight: 24, color: "#1f1b16", marginTop: 8 },

  factRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  fact: { flexDirection: "row", alignItems: "baseline", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: "#f7efe2" },
  factKey: { fontSize: 12, color: "#8a7f6a" },
  factValue: { fontSize: 13, fontWeight: "700", color: "#1f1b16" },

  bodyText: { marginTop: 10, padding: 12, borderRadius: 14, backgroundColor: "#f7efe2", fontSize: 14, lineHeight: 22, color: "#4a443b" },

  // 카드 아래 액션 줄 — 얇은 구분선 위에 글자 액션만.
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
    paddingTop: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "#e9dfcb",
  },
  footerMuted: { fontSize: 13.5, fontWeight: "700", color: "#a99e88" },
  footerAction: { fontSize: 13.5, fontWeight: "800", color: "#ef5b2b" },
  footerDone: { fontSize: 13.5, fontWeight: "700", color: "#3f9d5a" },

  primaryBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: "#1f1b16", overflow: "hidden" },
  primaryBtnText: { fontSize: 13.5, fontWeight: "700", color: "#fdf8f0" },
  ghostBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: "#fff", borderWidth: 1, borderColor: "#efe4cd", overflow: "hidden" },
  ghostBtnText: { fontSize: 13.5, fontWeight: "700", color: "#1f1b16" },
  btnDisabled: { opacity: 0.45 },

  composer: { marginTop: 14, borderRadius: 18, backgroundColor: "#f7efe2", padding: 14 },
  formLabel: { fontSize: 12.5, fontWeight: "700", color: "#8a7f6a", marginBottom: 6, marginTop: 8 },
  input: { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#efe4cd", paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: "#1f1b16" },
  inputMultiline: { minHeight: 68, textAlignVertical: "top" },
  dateBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#efe4cd", paddingHorizontal: 12, paddingVertical: 11, overflow: "hidden" },
  dateBtnText: { fontSize: 15, fontWeight: "700", color: "#1f1b16" },
  dateBtnCaret: { fontSize: 12, color: "#a99e88" },
  wheelRow: { flexDirection: "row", justifyContent: "center", gap: 4, marginTop: 8 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14 },
  switchLabel: { fontSize: 14.5, color: "#1f1b16", fontWeight: "600" },
  hintText: { fontSize: 12.5, color: "#8a7f6a", marginTop: 10, lineHeight: 19 },
  composerActions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14 },
  composerPrimary: { paddingVertical: 12, paddingHorizontal: 20 },
  errorText: { fontSize: 13, color: "#a32b1c", marginTop: 8 },

  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)" },
  sheetWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  sheet: { width: "100%", backgroundColor: "#fdf8f0", borderRadius: 20, paddingVertical: 8 },
  sheetTitle: { fontSize: 13, fontWeight: "700", color: "#8a7f6a", paddingHorizontal: 18, paddingVertical: 10 },
  sheetItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 13 },
  sheetItemText: { fontSize: 15.5, color: "#1f1b16", fontWeight: "600" },
  sheetItemActive: { color: "#ef5b2b", fontWeight: "800" },
  sheetItemRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  sheetCount: { fontSize: 14, fontWeight: "700", color: "#a99e88", minWidth: 18, textAlign: "right" },
  sheetCountZero: { color: "#d9cdb8" },
  sheetCheck: { fontSize: 15, color: "#ef5b2b", fontWeight: "800" },
});
