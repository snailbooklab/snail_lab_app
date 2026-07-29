import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, StatusBar, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  configureIngest,
  flushQueued,
  isOnboardingDismissed,
  isPermissionGranted,
  isSupported as isListenerSupported,
} from "./src/lib/notificationListener";
import { initNotifications, registerPushToken } from "./src/lib/notifications";
import { resyncDevice } from "./src/lib/resync";
import { supabase } from "./src/lib/supabase";
import CalendarScreen from "./src/screens/CalendarScreen";
import LoginScreen from "./src/screens/LoginScreen";
import NotificationAccessScreen from "./src/screens/NotificationAccessScreen";
import NotificationsScreen from "./src/screens/NotificationsScreen";

const queryClient = new QueryClient();

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <View style={styles.safe}>
            <StatusBar barStyle="dark-content" />
            {session === undefined ? (
              <View style={styles.center}>
                <ActivityIndicator size="large" />
              </View>
            ) : session ? (
              <SignedInApp />
            ) : (
              <LoginScreen />
            )}
          </View>
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

/** 로그인 상태일 때만 마운트 — 알림 초기화 + 동기화, 포그라운드 복귀 재동기화, Realtime 구독을 관리한다. */
function SignedInApp() {
  const qc = useQueryClient();
  const resyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // undefined = 아직 판단 전(깜빡임 방지), true = 권한 안내 화면을 띄운다.
  const [showAccessGuide, setShowAccessGuide] = useState<boolean | undefined>(undefined);
  const [showInbox, setShowInbox] = useState(false);

  // 알림 감지는 시스템 설정(알림 접근)이 켜져 있어야만 동작하는데 앱이 대신 켜줄 수 없다.
  // 아직 안 켰고 "다시 보지 않기"도 안 눌렀다면 안내 화면을 먼저 보여준다.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isListenerSupported) {
        if (!cancelled) setShowAccessGuide(false);
        return;
      }
      await configureIngest();
      const needed = !isPermissionGranted() && !(await isOnboardingDismissed());
      if (!cancelled) setShowAccessGuide(needed);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    function scheduleResync(delayMs: number) {
      if (resyncTimer.current) clearTimeout(resyncTimer.current);
      resyncTimer.current = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["schedules"] });
        void resyncDevice();
      }, delayMs);
    }

    (async () => {
      await initNotifications();
      if (cancelled) return;
      await resyncDevice();
      void registerPushToken();
    })();

    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      scheduleResync(0);
      qc.invalidateQueries({ queryKey: ["notifications"] });
      // 오프라인 동안 기기에 쌓인 알림을 마저 보낸다.
      void flushQueued();
    });

    const channel = supabase
      .channel("schedules-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "schedules" }, () => scheduleResync(500))
      .subscribe((status, err) => {
        if (__DEV__) console.log("[realtime] schedules-changes:", status, err ?? "");
      });

    // 알림함(notification_events)도 schedules와 똑같이 Realtime으로 받는다. 서버가 분류를
    // 끝내면 pending → classified UPDATE가 오므로 event는 "*"로 둔다(INSERT만 받으면 목록에
    // "분류 중…"으로 멈춰 있다). 여기서는 캐시만 무효화하고, 실제 조회는 알림함 화면이 한다.
    let inboxTimer: ReturnType<typeof setTimeout> | null = null;
    const inboxChannel = supabase
      .channel("notification-events-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "notification_events" }, () => {
        if (inboxTimer) clearTimeout(inboxTimer);
        inboxTimer = setTimeout(() => qc.invalidateQueries({ queryKey: ["notifications"] }), 300);
      })
      .subscribe((status, err) => {
        if (__DEV__) console.log("[realtime] notification-events-changes:", status, err ?? "");
      });

    return () => {
      cancelled = true;
      appStateSub.remove();
      supabase.removeChannel(channel);
      supabase.removeChannel(inboxChannel);
      if (inboxTimer) clearTimeout(inboxTimer);
      if (resyncTimer.current) clearTimeout(resyncTimer.current);
    };
  }, [qc]);

  if (showAccessGuide === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (showAccessGuide) {
    return <NotificationAccessScreen onDone={() => setShowAccessGuide(false)} />;
  }

  if (showInbox) {
    return <NotificationsScreen onBack={() => setShowInbox(false)} />;
  }

  return (
    <CalendarScreen
      onOpenInbox={() => setShowInbox(true)}
      onOpenNotificationAccess={
        isListenerSupported ? () => setShowAccessGuide(true) : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fdf8f0" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
