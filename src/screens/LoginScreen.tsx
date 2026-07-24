import { useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError("로그인에 실패했습니다. 이메일과 비밀번호를 확인해 주세요.");
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()} accessible={false}>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <View style={styles.logoDot}>
            <Text style={styles.logoDotText}>📅</Text>
          </View>
          <Text style={styles.eyebrow}>관리자</Text>
          <Text style={styles.title}>일정 캘린더</Text>
          <Text style={styles.subtitle}>관리자 계정으로 로그인해 주세요.</Text>

          <View style={styles.field}>
            <Text style={styles.label}>이메일</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="you@example.com"
              placeholderTextColor="#b7ab94"
              style={styles.input}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>비밀번호</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
              placeholder="••••••••"
              placeholderTextColor="#b7ab94"
              style={styles.input}
            />
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            onPress={onSubmit}
            disabled={loading || !email || !password}
            style={[styles.button, (loading || !email || !password) && styles.buttonDisabled]}
            android_ripple={{ color: "rgba(255,255,255,0.25)" }}
          >
            {loading ? <ActivityIndicator color="#fdf8f0" /> : <Text style={styles.buttonText}>로그인</Text>}
          </Pressable>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fdf8f0", justifyContent: "center", padding: 24 },
  logoDot: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: "#ffe6da",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  logoDotText: { fontSize: 30 },
  eyebrow: { fontSize: 12, fontWeight: "700", color: "#ef5b2b", textTransform: "uppercase", letterSpacing: 1.5 },
  title: { fontSize: 32, fontWeight: "800", color: "#1f1b16", marginTop: 6, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: "#6b6152", marginTop: 8, marginBottom: 28, lineHeight: 20 },
  field: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: "600", color: "#1f1b16", marginBottom: 6 },
  input: {
    borderWidth: 1.5,
    borderColor: "#e6dcc6",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 16,
    backgroundColor: "#fff",
    color: "#1f1b16",
  },
  error: { color: "#e23d2e", fontSize: 14, marginBottom: 8 },
  button: {
    marginTop: 12,
    height: 54,
    borderRadius: 18,
    backgroundColor: "#ef5b2b",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: "#a3350f",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: { opacity: 0.5, shadowOpacity: 0 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
