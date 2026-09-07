import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { pad } from "../lib/calendar";
import WheelPicker from "./WheelPicker";

/**
 * CalendarScreen의 날짜/시각 선택기와 같은 모양의 휠 모달 — 사진 초안 확인 화면에서도 같은 UI로
 * 날짜·알림 시각을 고르게 한다. (별도 창에 뜨므로 어떤 시트 위에서든 그 위에만 겹친다.)
 */

export function DateWheelModal({
  visible,
  value,
  years,
  onChange,
  onClose,
  title = "날짜 선택",
}: {
  visible: boolean;
  /** YYYY-MM-DD */
  value: string;
  years: number[];
  onChange: (iso: string) => void;
  onClose: () => void;
  title?: string;
}) {
  const [y, m, d] = value.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  function setPart(part: { y?: number; m?: number; d?: number }) {
    const ny = part.y ?? y;
    const nm = part.m ?? m;
    const dim = new Date(ny, nm, 0).getDate();
    const nd = Math.min(part.d ?? d, dim);
    onChange(`${ny}-${pad(nm)}-${pad(nd)}`);
  }
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} android_ripple={{ color: "transparent" }} />
        <View style={styles.sheet}>
          <Text style={styles.label}>{title}</Text>
          <View style={styles.row}>
            <WheelPicker items={years.map((yy) => ({ label: `${yy}년`, value: yy }))} selectedValue={y} onChange={(v) => setPart({ y: v })} />
            <WheelPicker
              items={Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => ({ label: `${mm}월`, value: mm }))}
              selectedValue={m}
              onChange={(v) => setPart({ m: v })}
            />
            <WheelPicker
              items={Array.from({ length: daysInMonth }, (_, i) => i + 1).map((dd) => ({ label: `${dd}일`, value: dd }))}
              selectedValue={d}
              onChange={(v) => setPart({ d: v })}
            />
          </View>
          <Pressable style={styles.done} onPress={onClose} android_ripple={{ color: "#c2410c" }}>
            <Text style={styles.doneText}>완료</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function TimeWheelModal({
  visible,
  hour,
  minute,
  onChange,
  onClose,
  title = "알림 시각",
}: {
  visible: boolean;
  hour: number;
  minute: number;
  onChange: (hour: number, minute: number) => void;
  onClose: () => void;
  title?: string;
}) {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} android_ripple={{ color: "transparent" }} />
        <View style={styles.sheet}>
          <Text style={styles.label}>{title}</Text>
          <View style={styles.row}>
            <WheelPicker
              items={[
                { label: "오전", value: "AM" as const },
                { label: "오후", value: "PM" as const },
              ]}
              selectedValue={hour < 12 ? "AM" : "PM"}
              onChange={(period) => onChange((h12 % 12) + (period === "PM" ? 12 : 0), minute)}
            />
            <WheelPicker
              items={Array.from({ length: 12 }, (_, i) => i + 1).map((h) => ({ label: `${h}시`, value: h }))}
              selectedValue={h12}
              onChange={(v) => onChange((v % 12) + (hour >= 12 ? 12 : 0), minute)}
            />
            <WheelPicker
              items={Array.from({ length: 12 }, (_, i) => i * 5).map((mm) => ({ label: `${pad(mm)}분`, value: mm }))}
              selectedValue={minute - (minute % 5)}
              onChange={(v) => onChange(hour, v)}
            />
          </View>
          <Pressable style={styles.done} onPress={onClose} android_ripple={{ color: "#c2410c" }}>
            <Text style={styles.doneText}>완료</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { width: "86%", backgroundColor: "#fdf8f0", borderRadius: 24, padding: 20 },
  label: { fontSize: 13, fontWeight: "700", color: "#8a7f6a", marginBottom: 8, marginTop: 4, textAlign: "center" },
  row: { flexDirection: "row", justifyContent: "center", gap: 4, marginTop: 12 },
  done: { marginTop: 16, height: 52, borderRadius: 18, backgroundColor: "#ef5b2b", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  doneText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
