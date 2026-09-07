import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAllSchedules } from "../hooks/schedules";
import { toISO, WEEKDAYS } from "../lib/calendar";
import { searchSchedules, splitByMatch, type MatchRange, type SearchHit } from "../lib/scheduleSearch";
import type { ScheduleItem } from "../types";

type Row = { kind: "header"; key: string; label: string } | { kind: "hit"; key: string; hit: SearchHit<ScheduleItem> };

function fmtDate(iso: string, todayYear: number): string {
  const d = new Date(`${iso}T00:00:00`);
  const year = d.getFullYear() !== todayYear ? `${d.getFullYear()}년 ` : "";
  return `${year}${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}

/** 일치 구간만 강조해서 그리는 텍스트. */
function Highlighted({ text, match, style, numberOfLines }: { text: string; match: MatchRange | null; style: object; numberOfLines?: number }) {
  const [before, hit, after] = splitByMatch(text, match);
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {before}
      {hit ? <Text style={styles.mark}>{hit}</Text> : null}
      {after}
    </Text>
  );
}

/**
 * 일정 검색 — 전체 일정을 한 번 받아두고 앱 안에서 거른다(공백 무시·초성 검색, lib/scheduleSearch).
 * 결과를 누르면 달력이 그 날짜로 이동하고 상세 시트가 열린다.
 */
export default function SearchSheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (iso: string) => void }) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const today = useMemo(() => new Date(), []);
  const todayIso = toISO(today);
  const active = query.trim().length > 0;
  // 시트를 처음 열 때부터 받아두면 첫 글자를 칠 때 바로 결과가 나온다.
  const { data, isPending, isError, error } = useAllSchedules(visible);

  const rows = useMemo<Row[]>(() => {
    if (!active || !data) return [];
    const hits = searchSchedules(data, query, todayIso);
    const upcoming = hits.filter((h) => h.item.date >= todayIso);
    const past = hits.filter((h) => h.item.date < todayIso);
    const out: Row[] = [];
    if (upcoming.length) out.push({ kind: "header", key: "h-up", label: `다가오는 일정 ${upcoming.length}건` });
    for (const hit of upcoming) out.push({ kind: "hit", key: hit.item.id, hit });
    if (past.length) out.push({ kind: "header", key: "h-past", label: `지난 일정 ${past.length}건` });
    for (const hit of past) out.push({ kind: "hit", key: hit.item.id, hit });
    return out;
  }, [active, data, query, todayIso]);

  function close() {
    setQuery("");
    onClose();
  }

  function pick(iso: string) {
    setQuery("");
    onPick(iso);
  }

  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
      <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
        <View style={styles.searchRow}>
          <View style={styles.inputWrap}>
            <Text style={styles.inputIcon}>🔍</Text>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="일정 검색 (초성도 돼요: ㅎㅂㅊ)"
              placeholderTextColor="#b7ab94"
              style={styles.input}
              autoFocus
              returnKeyType="search"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery("")} hitSlop={8}>
                <Text style={styles.clearText}>✕</Text>
              </Pressable>
            )}
          </View>
          <Pressable onPress={close} hitSlop={8} style={styles.cancelBtn} android_ripple={{ color: "#ecdfc0", borderless: true }}>
            <Text style={styles.cancelText}>닫기</Text>
          </Pressable>
        </View>

        {!active ? (
          <Text style={styles.hint}>제목이나 메모에 들어간 말을 입력하세요. 띄어쓰기는 무시하고, 초성만 쳐도 찾습니다.</Text>
        ) : isPending ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#ef5b2b" />
          </View>
        ) : isError ? (
          <Text style={styles.hint}>일정을 불러오지 못했습니다 — {(error as Error).message}</Text>
        ) : rows.length === 0 ? (
          <Text style={styles.hint}>"{query.trim()}"에 맞는 일정이 없습니다.</Text>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(r) => r.key}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 + insets.bottom }}
            renderItem={({ item: r }) =>
              r.kind === "header" ? (
                <Text style={styles.groupLabel}>{r.label}</Text>
              ) : (
                <Pressable onPress={() => pick(r.hit.item.date)} style={styles.card} android_ripple={{ color: "#f6e9d1" }}>
                  <Text style={[styles.date, r.hit.item.date < todayIso && styles.datePast]}>{fmtDate(r.hit.item.date, today.getFullYear())}</Text>
                  <Highlighted text={r.hit.item.title} match={r.hit.titleMatch} style={styles.title} />
                  {r.hit.item.memo ? <Highlighted text={r.hit.item.memo} match={r.hit.memoMatch} style={styles.memo} numberOfLines={2} /> : null}
                </Pressable>
              )
            }
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fdf8f0" },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  inputWrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#e6dcc6", borderRadius: 16, paddingHorizontal: 12 },
  inputIcon: { fontSize: 15 },
  input: { flex: 1, paddingVertical: 11, fontSize: 16, color: "#1f1b16" },
  clearText: { fontSize: 14, color: "#8a7f6a", padding: 4 },
  cancelBtn: { paddingHorizontal: 6, paddingVertical: 8 },
  cancelText: { fontSize: 15, fontWeight: "700", color: "#1f1b16" },
  hint: { marginTop: 32, marginHorizontal: 32, textAlign: "center", color: "#a99e88", fontSize: 14, lineHeight: 21 },
  center: { paddingTop: 48, alignItems: "center" },
  groupLabel: { fontSize: 12.5, fontWeight: "800", color: "#8a7f6a", marginTop: 16, marginBottom: 8, letterSpacing: 0.2 },
  card: { backgroundColor: "#fff", borderRadius: 16, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 8, borderLeftWidth: 2.5, borderLeftColor: "#ef5b2b", overflow: "hidden" },
  date: { fontSize: 12.5, fontWeight: "800", color: "#c2410c", marginBottom: 3 },
  datePast: { color: "#8a7f6a" },
  title: { fontSize: 16, fontWeight: "700", color: "#1f1b16" },
  memo: { marginTop: 3, fontSize: 13, color: "#6b6152", lineHeight: 18 },
  mark: { backgroundColor: "#ffe6da", color: "#9a3411" },
});
