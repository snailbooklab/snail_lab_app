// react-native-gesture-handler는 부작용 임포트로 엔트리 파일의 가장 첫 줄에 있어야 한다.
import 'react-native-gesture-handler';

import { registerRootComponent } from 'expo';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { registerWidgetTaskHandler } from 'react-native-android-widget';

import App from './App';
import { resyncDevice } from './src/lib/resync';
import { widgetTaskHandler } from './src/widgets/widgetTaskHandler';

// 서버(schedules 변경) → 조용한 FCM 푸시 → 이 백그라운드 태스크가 깨어나서 재동기화한다.
// 앱 종료 상태에서도 로드될 수 있어야 하므로 반드시 엔트리 파일의 모듈 스코프에 정의한다
// (컴포넌트 안에 두면 앱이 안 떠 있을 때 등록되지 않는다).
export const BACKGROUND_NOTIFICATION_TASK = 'BACKGROUND-NOTIFICATION-TASK';

TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, async () => {
  await resyncDevice();
  return Notifications.BackgroundNotificationTaskResult.NewData;
});

if (Platform.OS !== 'web') {
  Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch(() => {
    // Expo Go 등 지원되지 않는 환경에서는 조용히 무시 — 필수 기능이 아니라 보강 기능이므로.
  });
}

// 홈/잠금화면 위젯 렌더링 태스크. 백그라운드 알림 태스크와 같은 이유로 반드시 모듈 스코프에 둔다
// (앱이 종료된 상태에서 위젯이 갱신될 때 이 번들이 로드되면서 등록돼야 한다).
if (Platform.OS === 'android') {
  registerWidgetTaskHandler(widgetTaskHandler);
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
