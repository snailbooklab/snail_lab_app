import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { parseScheduleImages } from "../api/parseScheduleImage";
import { DateWheelModal, TimeWheelModal } from "../components/WheelModals";
import { useCreateSchedulesBulk } from "../hooks/schedules";
import {
  DEFAULT_REMINDER_HOUR,
  DEFAULT_REMINDER_MINUTE,
  fmtSelected,
  formatAmPmTime,
  isValidIsoDate,
  reminderIsoFor,
  toISO,
} from "../lib/calendar";
import { MAX_SCHEDULE_IMAGES, pickScheduleImages, type PickedImage } from "../lib/scheduleImages";
import type { DraftConfidence, DraftEvent, ScheduleExtraction } from "../types";

/** 비용 표시용 환율 — 정확할 필요 없이 "대략 얼마" 감만 주면 된다. */
const KRW_PER_USD = 1400;

type DraftRow = {
  key: number;
  include: boolean;
  date: string; // "" = 아직 없음
  title: string;
  time: string;
  memo: string;
  confidence: DraftConfidence | "manual";
};

const CONFIDENCE_BADGE: Record<DraftRow["confidence"], { text: string; bg: string; color: string }> = {
  high: { text: "확신", bg: "#dff1e4", color: "#215d34" },
  medium: { text: "확인 필요", bg: "#fdf0c8", color: "#8a5a00" },
  low: { text: "불확실", bg: "#ffe0dc", color: "#a8321f" },
  manual: { text: "직접 입력", bg: "#efe4cd", color: "#6b6152" },
};

let nextKey = 1;

function rowsFromExtraction(events: DraftEvent[]): DraftRow[] {
  return events.map((e) => ({
    key: nextKey++,
    // 날짜를 못 읽은 항목은 사람이 채우기 전엔 등록 대상에서 빼둔다.
    include: !!e.date,
    date: e.date ?? "",
    title: e.title,
    time: e.time ?? "",
    memo: e.memo ?? "",
    confidence: e.confidence,
  }));
}

/**
 * 일정표 사진 → Claude 초안 → 사람이 확인·수정 → 일괄 등록.
 * 초안은 절대 그대로 저장되지 않는다: 체크된 행 중 날짜·제목이 있는 것만 "등록"을 눌러야 들어간다.
 */
export default function PhotoImportSheet({
  visible,
  onClose,
  onSaved,
  defaultDate,
}: {
  visible: boolean;
  onClose: () => void;
  /** 등록이 끝나면 첫 일정 날짜(YYYY-MM-DD)를 알려준다 — 달력을 그 날로 옮기는 용도. */
  onSaved: (firstDate: string | null) => void;
  /** 직접 추가한 행이나 날짜 없는 행의 날짜 휠이 처음 보여줄 날짜. */
  defaultDate: string;
}) {
  const insets = useSafeAreaInsets();
  const [images, setImages] = useState<PickedImage[]>([]);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState<"pick" | "analyze" | null>(null);
  const [result, setResult] = useState<ScheduleExtraction | null>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [remindEnabled, setRemindEnabled] = useState(true);
  const [remindHour, setRemindHour] = useState(DEFAULT_REMINDER_HOUR);
  const [remindMinute, setRemindMinute] = useState(DEFAULT_REMINDER_MINUTE);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [dateEditingKey, setDateEditingKey] = useState<number | null>(null);
  const bulk = useCreateSchedulesBulk();

  // 키보드가 덮는 만큼 아래 여백을 줘서 가려진 입력칸을 스크롤해 볼 수 있게(CalendarScreen과 같은 방식).
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => setKeyboardHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  function reset() {
    setImages([]);
    setHint("");
    setResult(null);
    setRows([]);
    setBusy(null);
    setDateEditingKey(null);
    setShowTimePicker(false);
  }

  function close() {
    if (busy || bulk.isPending) return;
    reset();
    onClose();
  }

  async function pick(source: "camera" | "library") {
    const remaining = MAX_SCHEDULE_IMAGES - images.length;
    if (remaining <= 0) return;
    setBusy("pick");
    try {
      const picked = await pickScheduleImages(source, remaining);
      setImages((prev) => [...prev, ...picked].slice(0, MAX_SCHEDULE_IMAGES));
    } catch (err) {
      Alert.alert("사진을 가져오지 못했어요", (err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function analyze() {
    if (images.length === 0) return;
    setBusy("analyze");
    try {
      const res = await parseScheduleImages(
        images.map((i) => i.payload),
        hint.trim() || null,
      );
      setResult(res);
      setRows(rowsFromExtraction(res.events));
    } catch (err) {
      Alert.alert("분석 실패", (err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function patchRow(key: number, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      { key: nextKey++, include: true, date: defaultDate, title: "", time: "", memo: "", confidence: "manual" },
    ]);
  }

  const ready = rows.filter((r) => r.include && isValidIsoDate(r.date) && r.title.trim());
  const blocked = rows.filter((r) => r.include && !(isValidIsoDate(r.date) && r.title.trim()));

  async function save() {
    if (ready.length === 0) return;
    try {
      const res = await bulk.mutateAsync(
        ready.map((r) => ({
          date: r.date,
          title: r.title.trim(),
          memo: [r.time.trim(), r.memo.trim()].filter(Boolean).join(" · ") || undefined,
          remindAt: remindEnabled ? reminderIsoFor(r.date, remindHour, remindMinute) : null,
        })),
      );
      const firstDate = ready.map((r) => r.date).sort()[0] ?? null;
      reset();
      onSaved(firstDate);
      Alert.alert(
        "등록 완료",
        res.skipped > 0 ? `${res.created}건 등록했어요. (이미 있는 일정 ${res.skipped}건 건너뜀)` : `${res.created}건 등록했어요.`,
      );
    } catch (err) {
      Alert.alert("등록 실패", (err as Error).message);
    }
  }

  const costKrw = result?.cost_usd != null ? Math.round(result.cost_usd * KRW_PER_USD) : null;
  const editingRow = rows.find((r) => r.key === dateEditingKey);
  const thisYear = new Date().getFullYear();
  const pickerYears = Array.from({ length: 6 }, (_, i) => thisYear - 2 + i);

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>📷 사진으로 일정 추가</Text>
          <Pressable onPress={close} hitSlop={8} android_ripple={{ color: "#ecdfc0", borderless: true }}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{ padding: 20, paddingBottom: 24 + keyboardHeight }}
          keyboardShouldPersistTaps="handled"
        >
          {!result ? (
            <>
              <Text style={styles.help}>
                일정표·공문·카톡 캡처 등 어떤 형태든 됩니다. 일정이 여러 개 섞여 있어도 각각 읽어서 초안을 만들고, 등록
                전에 하나씩 확인·수정할 수 있어요. (최대 {MAX_SCHEDULE_IMAGES}장)
              </Text>

              <View style={styles.pickRow}>
                <Pressable
                  style={[styles.pickBtn, images.length >= MAX_SCHEDULE_IMAGES && styles.disabled]}
                  disabled={!!busy || images.length >= MAX_SCHEDULE_IMAGES}
                  onPress={() => pick("camera")}
                  android_ripple={{ color: "#f8d4c4" }}
                >
                  <Text style={styles.pickIcon}>📷</Text>
                  <Text style={styles.pickText}>카메라로 찍기</Text>
                </Pressable>
                <Pressable
                  style={[styles.pickBtn, images.length >= MAX_SCHEDULE_IMAGES && styles.disabled]}
                  disabled={!!busy || images.length >= MAX_SCHEDULE_IMAGES}
                  onPress={() => pick("library")}
                  android_ripple={{ color: "#f8d4c4" }}
                >
                  <Text style={styles.pickIcon}>🖼️</Text>
                  <Text style={styles.pickText}>앨범에서 고르기</Text>
                </Pressable>
              </View>

              {images.length > 0 && (
                <View style={styles.thumbRow}>
                  {images.map((img, i) => (
                    <View key={img.uri} style={styles.thumbWrap}>
                      <Image source={{ uri: img.uri }} style={styles.thumb} />
                      <Pressable
                        onPress={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                        style={styles.thumbRemove}
                        hitSlop={6}
                      >
                        <Text style={styles.thumbRemoveText}>✕</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}

              <TextInput
                value={hint}
                onChangeText={setHint}
                placeholder="덧붙일 설명 (선택) — 예: 9월 ○○교육청 강의 일정표"
                placeholderTextColor="#b7ab94"
                style={styles.input}
                multiline
              />

              <Pressable
                style={[styles.primaryBtn, (images.length === 0 || !!busy) && styles.disabled]}
                disabled={images.length === 0 || !!busy}
                onPress={analyze}
                android_ripple={{ color: "#c2410c" }}
              >
                {busy === "analyze" ? (
                  <View style={styles.inline}>
                    <ActivityIndicator color="#fdf8f0" />
                    <Text style={styles.primaryBtnText}>사진을 읽는 중… (수십 초 걸릴 수 있어요)</Text>
                  </View>
                ) : busy === "pick" ? (
                  <ActivityIndicator color="#fdf8f0" />
                ) : (
                  <Text style={styles.primaryBtnText}>일정 초안 만들기</Text>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <View style={styles.summaryRow}>
                <Text style={styles.help}>
                  {rows.length === 0 ? "읽어낸 일정이 없어요. 직접 추가하거나 다른 사진으로 시도해 보세요." : `${rows.length}건을 읽었어요. 확인 후 등록하세요.`}
                </Text>
                {costKrw != null && <Text style={styles.costText}>분석 비용 약 {costKrw}원</Text>}
              </View>
              {result.notes && (
                <View style={styles.notes}>
                  <Text style={styles.notesText}>⚠️ {result.notes}</Text>
                </View>
              )}

              {rows.map((r) => {
                const badge = CONFIDENCE_BADGE[r.confidence];
                const invalid = r.include && !(isValidIsoDate(r.date) && r.title.trim());
                return (
                  <View key={r.key} style={[styles.card, invalid && styles.cardInvalid, !r.include && styles.cardOff]}>
                    <View style={styles.cardTop}>
                      <Pressable
                        onPress={() => patchRow(r.key, { include: !r.include })}
                        style={[styles.check, r.include && styles.checkOn]}
                        hitSlop={8}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: r.include }}
                      >
                        {r.include && <Text style={styles.checkMark}>✓</Text>}
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          Keyboard.dismiss();
                          if (!r.date) patchRow(r.key, { date: defaultDate });
                          setDateEditingKey(r.key);
                        }}
                        style={[styles.datePill, !r.date && styles.datePillMissing]}
                        android_ripple={{ color: "#fbe0d3" }}
                      >
                        <Text style={[styles.datePillText, !r.date && styles.datePillTextMissing]}>
                          {r.date ? fmtSelected(r.date) : "날짜 없음 · 탭해서 선택"}
                        </Text>
                        <Text style={styles.datePillCaret}>▾</Text>
                      </Pressable>
                      <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                        <Text style={[styles.badgeText, { color: badge.color }]}>{badge.text}</Text>
                      </View>
                    </View>
                    <TextInput
                      value={r.title}
                      onChangeText={(v) => patchRow(r.key, { title: v })}
                      placeholder="제목"
                      placeholderTextColor="#b7ab94"
                      style={[styles.input, styles.titleInput]}
                    />
                    <View style={styles.inline}>
                      <TextInput
                        value={r.time}
                        onChangeText={(v) => patchRow(r.key, { time: v })}
                        placeholder="시간 (선택)"
                        placeholderTextColor="#b7ab94"
                        style={[styles.input, styles.smallInput, { flex: 1 }]}
                      />
                      <TextInput
                        value={r.memo}
                        onChangeText={(v) => patchRow(r.key, { memo: v })}
                        placeholder="메모 (선택)"
                        placeholderTextColor="#b7ab94"
                        style={[styles.input, styles.smallInput, { flex: 2 }]}
                      />
                    </View>
                    <View style={styles.cardBottom}>
                      {invalid ? (
                        <Text style={styles.invalidText}>날짜와 제목을 채워야 등록돼요. (빼려면 체크 해제)</Text>
                      ) : (
                        <View />
                      )}
                      <Pressable onPress={() => setRows((prev) => prev.filter((x) => x.key !== r.key))} hitSlop={8}>
                        <Text style={styles.deleteText}>삭제</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}

              <Pressable onPress={addRow} style={styles.addRowBtn} android_ripple={{ color: "#f6e9d1" }}>
                <Text style={styles.addRowText}>+ 직접 추가</Text>
              </Pressable>

              <View style={styles.optionCard}>
                <View style={styles.optionRow}>
                  <Text style={styles.optionLabel}>등록하는 일정 전부 당일 알림</Text>
                  <Switch
                    value={remindEnabled}
                    onValueChange={setRemindEnabled}
                    trackColor={{ true: "#ef5b2b", false: "#d8cdb6" }}
                    thumbColor="#fff"
                  />
                </View>
                {remindEnabled && (
                  <Pressable style={styles.optionPill} onPress={() => setShowTimePicker(true)} android_ripple={{ color: "#f8d4c4" }}>
                    <Text style={styles.optionPillText}>{formatAmPmTime(remindHour, remindMinute)}</Text>
                    <Text style={styles.optionPillHint}>탭해서 변경 ⌄</Text>
                  </Pressable>
                )}
              </View>
            </>
          )}
        </ScrollView>

        {result && (
          <View style={[styles.footer, { paddingBottom: 16 + insets.bottom }]}>
            <Pressable
              onPress={() => {
                setResult(null);
                setRows([]);
              }}
              disabled={bulk.isPending}
              style={styles.cancelBtn}
              android_ripple={{ color: "#ecdfc0" }}
            >
              <Text style={styles.cancelBtnText}>← 다시 고르기</Text>
            </Pressable>
            <Pressable
              onPress={save}
              disabled={ready.length === 0 || blocked.length > 0 || bulk.isPending}
              style={[styles.primaryBtn, { flex: 1, marginTop: 0 }, (ready.length === 0 || blocked.length > 0 || bulk.isPending) && styles.disabled]}
              android_ripple={{ color: "#c2410c" }}
            >
              {bulk.isPending ? (
                <ActivityIndicator color="#fdf8f0" />
              ) : (
                <Text style={styles.primaryBtnText}>{ready.length > 0 ? `${ready.length}건 등록` : "등록할 일정을 선택하세요"}</Text>
              )}
            </Pressable>
          </View>
        )}

        <DateWheelModal
          visible={editingRow !== undefined}
          value={editingRow?.date || defaultDate || toISO(new Date())}
          years={pickerYears}
          onChange={(iso) => dateEditingKey !== null && patchRow(dateEditingKey, { date: iso })}
          onClose={() => setDateEditingKey(null)}
        />
        <TimeWheelModal
          visible={showTimePicker}
          hour={remindHour}
          minute={remindMinute}
          onChange={(h, m) => {
            setRemindHour(h);
            setRemindMinute(m);
          }}
          onClose={() => setShowTimePicker(false)}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fdf8f0" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14 },
  headerTitle: { fontSize: 20, fontWeight: "800", color: "#1f1b16", letterSpacing: -0.3 },
  closeText: { fontSize: 16, color: "#8a7f6a", padding: 6 },
  scroll: { flex: 1 },
  help: { fontSize: 14, lineHeight: 21, color: "#6b6152", flexShrink: 1 },
  pickRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  pickBtn: { flex: 1, alignItems: "center", gap: 6, paddingVertical: 18, borderRadius: 18, backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#e6dcc6", overflow: "hidden" },
  pickIcon: { fontSize: 26 },
  pickText: { fontSize: 14, fontWeight: "700", color: "#1f1b16" },
  thumbRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 },
  thumbWrap: { position: "relative" },
  thumb: { width: 84, height: 84, borderRadius: 12, backgroundColor: "#eee" },
  thumbRemove: { position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: "#1f1b16", alignItems: "center", justifyContent: "center" },
  thumbRemoveText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  input: { borderWidth: 1.5, borderColor: "#e6dcc6", borderRadius: 14, backgroundColor: "#fff", paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: "#1f1b16", marginTop: 12 },
  titleInput: { fontSize: 16, fontWeight: "600", marginTop: 10 },
  smallInput: { fontSize: 13.5, paddingVertical: 9, marginTop: 8 },
  primaryBtn: { marginTop: 16, height: 52, borderRadius: 18, backgroundColor: "#ef5b2b", alignItems: "center", justifyContent: "center", overflow: "hidden", paddingHorizontal: 16 },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  inline: { flexDirection: "row", alignItems: "center", gap: 8 },
  disabled: { opacity: 0.45 },
  summaryRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  costText: { fontSize: 12, color: "#a99e88", fontWeight: "600", marginTop: 2 },
  notes: { marginTop: 12, backgroundColor: "#fdf0c8", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  notesText: { fontSize: 13, lineHeight: 19, color: "#8a5a00" },
  card: { marginTop: 12, backgroundColor: "#fff", borderRadius: 16, borderWidth: 1.5, borderColor: "#e6dcc6", padding: 14 },
  cardInvalid: { borderColor: "#f3a89c" },
  cardOff: { opacity: 0.55 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  check: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: "#d8cdb6", alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: "#ef5b2b", borderColor: "#ef5b2b" },
  checkMark: { color: "#fff", fontSize: 14, fontWeight: "900" },
  datePill: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fbf0dc", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, overflow: "hidden" },
  datePillMissing: { backgroundColor: "#ffe0dc" },
  datePillText: { fontSize: 14, fontWeight: "800", color: "#c2410c", flexShrink: 1 },
  datePillTextMissing: { color: "#a8321f" },
  datePillCaret: { fontSize: 13, fontWeight: "900", color: "#c2410c" },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: "800" },
  cardBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  invalidText: { fontSize: 12, color: "#a8321f", flexShrink: 1 },
  deleteText: { fontSize: 13, fontWeight: "700", color: "#e23d2e", padding: 4 },
  addRowBtn: { alignSelf: "flex-start", marginTop: 12, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 },
  addRowText: { fontSize: 14, fontWeight: "700", color: "#1f1b16", textDecorationLine: "underline" },
  optionCard: { backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#e6dcc6", borderRadius: 16, paddingHorizontal: 16, marginTop: 16 },
  optionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, gap: 10 },
  optionLabel: { fontSize: 15, fontWeight: "600", color: "#1f1b16", flexShrink: 1 },
  optionPill: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 13, backgroundColor: "#fbf0dc", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, overflow: "hidden" },
  optionPillText: { fontSize: 16, fontWeight: "800", color: "#c2410c" },
  optionPillHint: { fontSize: 12, color: "#a99e88", fontWeight: "600" },
  footer: { flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: "#e6dcc6", backgroundColor: "#fdf8f0" },
  cancelBtn: { height: 52, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1.5, borderColor: "#e6dcc6", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  cancelBtnText: { fontSize: 14, fontWeight: "600", color: "#1f1b16" },
});
