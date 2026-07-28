import { useCallback, useEffect, useState } from "react";
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  dismissOnboarding,
  getStats,
  isPermissionGranted,
  openNotificationAccessSettings,
} from "../lib/notificationListener";

/**
 * 알림 감지 권한 안내.
 *
 * 세 가지가 모두 갖춰져야 동작하는데 셋 다 시스템 설정이라 앱이 대신 켜줄 수 없다.
 * 하나라도 빠지면 "아무 일도 일어나지 않는" 방식으로 실패하므로, 현재 상태를 눈으로
 * 확인할 수 있게 보여주는 것이 이 화면의 핵심이다.
 */
export default function NotificationAccessScreen({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [granted, setGranted] = useState(() => isPermissionGranted());
  const [stats, setStats] = useState(() => getStats());

  const refresh = useCallback(() => {
    setGranted(isPermissionGranted());
    setStats(getStats());
  }, []);

  // 설정 화면에 다녀오면 권한이 바뀌어 있을 수 있다 — 복귀할 때마다 다시 확인한다.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  async function skip() {
    await dismissOnboarding();
    onDone();
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 40 },
      ]}
    >
      <Text style={styles.eyebrow}>알림 감지</Text>
      <Text style={styles.title}>카톡·문자에서{"\n"}강의 문의만 골라냅니다</Text>
      <Text style={styles.lead}>
        휴대폰에 도착한 카카오톡·문자 알림 중 강의 관련 메시지를 찾아 관리자 페이지에 모아 둡니다.
        아래 세 가지를 켜야 동작합니다.
      </Text>

      <Step
        n={1}
        title="알림 접근 허용"
        done={granted}
        desc="시스템 설정에서 이 앱의 알림 접근을 켜주세요. 목록에서 '최미선 캘린더'를 찾아 켜면 됩니다."
        action={granted ? undefined : { label: "설정 열기", onPress: openNotificationAccessSettings }}
        doneLabel="허용됨"
      />

      <Step
        n={2}
        title="배터리 최적화 제외"
        desc={
          "설정 > 배터리 > 백그라운드 사용 제한(또는 앱 절전)에서 이 앱을 '제한 없음'으로 두세요.\n" +
          "삼성 절전 모드가 감지 서비스를 끊으면 며칠 뒤 조용히 수집이 멈춥니다."
        }
      />

      <Step
        n={3}
        title="카톡 알림 미리보기 켜기"
        desc={
          "카카오톡 > 설정 > 알림에서 '메시지 내용 표시'를 켜주세요.\n" +
          "내용이 숨겨져 있으면 알림에 '새로운 메시지'만 와서 분류할 수 없습니다."
        }
      />

      <View style={styles.statusCard}>
        <Text style={styles.statusTitle}>현재 상태</Text>
        <Row label="알림 접근" value={granted ? "허용됨" : "꺼짐"} warn={!granted} />
        <Row
          label="마지막 감지"
          value={stats.lastPostedAt ? fmtWhen(stats.lastPostedAt) : "아직 없음"}
        />
        <Row
          label="전송 대기"
          value={stats.queued > 0 ? `${stats.queued}건` : "없음"}
          warn={stats.queued > 0}
        />
        <Pressable onPress={refresh} style={styles.refreshBtn} android_ripple={{ color: "#f6e9d1" }}>
          <Text style={styles.refreshText}>새로고침</Text>
        </Pressable>
      </View>

      <Pressable onPress={onDone} style={styles.primaryBtn} android_ripple={{ color: "#3a332c" }}>
        <Text style={styles.primaryBtnText}>{granted ? "완료" : "일단 캘린더로"}</Text>
      </Pressable>
      {!granted && (
        <Pressable onPress={skip} style={styles.skipBtn} hitSlop={8}>
          <Text style={styles.skipText}>다시 보지 않기</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

function Step({
  n,
  title,
  desc,
  done,
  doneLabel,
  action,
}: {
  n: number;
  title: string;
  desc: string;
  done?: boolean;
  doneLabel?: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.step}>
      <View style={styles.stepHead}>
        <View style={[styles.stepNum, done && styles.stepNumDone]}>
          <Text style={[styles.stepNumText, done && styles.stepNumTextDone]}>
            {done ? "✓" : n}
          </Text>
        </View>
        <Text style={styles.stepTitle}>{title}</Text>
        {done && doneLabel && <Text style={styles.stepDone}>{doneLabel}</Text>}
      </View>
      <Text style={styles.stepDesc}>{desc}</Text>
      {action && (
        <Pressable onPress={action.onPress} style={styles.stepBtn} android_ripple={{ color: "#f6e9d1" }}>
          <Text style={styles.stepBtnText}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, warn && styles.rowValueWarn]}>{value}</Text>
    </View>
  );
}

function fmtWhen(ms: number): string {
  const diffMin = Math.floor((Date.now() - ms) / 60_000);
  if (diffMin < 1) return "방금";
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}시간 전`;
  return `${Math.floor(diffMin / (60 * 24))}일 전`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fdf8f0" },
  content: { paddingHorizontal: 22, gap: 14 },

  eyebrow: { fontSize: 13, fontWeight: "700", color: "#cf4500", letterSpacing: 0.5 },
  title: { fontSize: 27, fontWeight: "700", color: "#1f1b16", lineHeight: 36, marginTop: 6 },
  lead: { fontSize: 15, lineHeight: 23, color: "#6b6259", marginTop: 2, marginBottom: 8 },

  step: {
    backgroundColor: "#fffdf8",
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: "#eee2cf",
  },
  stepHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3e6d2",
  },
  stepNumDone: { backgroundColor: "#3f9d5a" },
  stepNumText: { fontSize: 13, fontWeight: "700", color: "#8a6b3d" },
  stepNumTextDone: { color: "#ffffff" },
  stepTitle: { fontSize: 17, fontWeight: "700", color: "#1f1b16", flex: 1 },
  stepDone: { fontSize: 13, fontWeight: "600", color: "#3f9d5a" },
  stepDesc: { fontSize: 14, lineHeight: 21, color: "#6b6259", marginTop: 10 },
  stepBtn: {
    alignSelf: "flex-start",
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#1f1b16",
  },
  stepBtnText: { fontSize: 14, fontWeight: "600", color: "#1f1b16" },

  statusCard: {
    backgroundColor: "#f7efe2",
    borderRadius: 20,
    padding: 18,
    marginTop: 4,
  },
  statusTitle: { fontSize: 14, fontWeight: "700", color: "#1f1b16", marginBottom: 10 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: "#e9dcc7",
  },
  rowLabel: { fontSize: 14, color: "#6b6259" },
  rowValue: { fontSize: 14, fontWeight: "600", color: "#1f1b16" },
  rowValueWarn: { color: "#cf4500" },
  refreshBtn: { alignSelf: "flex-start", marginTop: 12, paddingVertical: 6, paddingHorizontal: 4 },
  refreshText: { fontSize: 14, fontWeight: "600", color: "#cf4500" },

  primaryBtn: {
    marginTop: 8,
    borderRadius: 999,
    backgroundColor: "#1f1b16",
    paddingVertical: 15,
    alignItems: "center",
  },
  primaryBtnText: { fontSize: 16, fontWeight: "700", color: "#fdf8f0" },
  skipBtn: { alignItems: "center", paddingVertical: 10 },
  skipText: { fontSize: 14, color: "#8a8078", textDecorationLine: "underline" },
});
