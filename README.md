# 최미디어 캘린더 (Expo)

`choi-media` 웹 관리자(`/admin/calendar`)와 같은 Supabase `schedules` 테이블을 공유하는
갤럭시(Android)용 일정 리마인더 앱. 웹과 동일하게 일정 조회/추가/수정/삭제/매주 반복이
가능하고, 서버 푸시 대신 `expo-notifications`의 **로컬 알림**으로 당일 오전 8시 알림을 보낸다.

- 로그인: 웹 관리자와 동일한 Supabase Auth 이메일/비밀번호 계정
- 동기화: 앱을 열 때, 포그라운드로 복귀할 때, 일정을 추가/수정/삭제할 때마다 서버의
  `remind_at` 목록을 읽어 기기에 예약된 로컬 알림을 전부 다시 맞춘다
- 보너스: Supabase Realtime으로 `schedules` 테이블 변경을 구독해 앱이 켜져 있는 동안
  웹에서의 변경도 반영한다
- 백그라운드 재동기화: 앱이 꺼져있거나 백그라운드에 있어도, `schedules`가 바뀌면 서버가 조용한
  FCM 푸시를 보내 앱을 잠깐 깨우고 `syncNotifications()`를 실행한다(§ 푸시 기반 백그라운드
  재동기화 참고) — 단, EAS 빌드 + Firebase 설정이 끝나야 동작한다

## 시작하기

```bash
npm install
```

`.env` 파일에 choi-media 웹의 `.env`와 동일한 Supabase 값을 `EXPO_PUBLIC_` 접두사로 넣는다
(`.env.example` 참고). 이 리포에는 이미 값이 채워진 `.env`가 있다(`.gitignore`에 포함되어
커밋되지 않음) — 다른 환경에서 새로 받았다면 `.env.example`을 복사해서 채울 것.

```bash
npx expo start
```

갤럭시 기기에 [Expo Go](https://expo.dev/go)를 설치하고 같은 Wi-Fi에서 QR코드를 스캔하면 바로
실행된다. 같은 네트워크가 아니면 `npx expo start --tunnel`.

> 로컬 알림(`expo-notifications`)은 Expo Go에서도 동작한다(원격 푸시만 SDK 53+ Expo Go에서
> 제한됨). 실제 기기에 상시 설치해서 쓰려면 아래 APK 빌드가 필요하다.

## APK 빌드 (사이드로드 배포용) — 나중에

`eas.json`은 이미 준비되어 있다 (`development` / `preview` / `production` 프로필,
`preview`는 사이드로드용 APK로 빌드됨). Expo 계정으로 로그인 후 직접 빌드한다:

```bash
npx eas login
npx eas build -p android --profile preview
```

빌드가 끝나면 Expo 대시보드(또는 CLI가 출력하는 링크)에서 `.apk`를 내려받아 갤럭시에
사이드로드로 설치한다(설정 > 출처를 알 수 없는 앱 허용 필요).

## 푸시 기반 백그라운드 재동기화 (설정 필요)

로컬 알림/Realtime/AppState만으로는 **앱 JS가 살아있을 때만** 동기화된다 — 앱이 완전히 꺼져있으면
웹에서 바꾼 일정이 기기에 반영될 방법이 없다. 이를 보완하려고 "schedules 변경 → 서버가 조용한
푸시 발송 → 앱이 백그라운드 태스크로 받아서 재동기화" 구조를 추가했다. 실제 알람은 여전히 로컬
알림이 담당 — 푸시는 화면에 아무것도 안 뜨는 순수 "깨우기" 신호다.

**Expo Go로는 테스트 불가** (SDK 53+부터 Android 푸시가 Expo Go에서 빠짐). 아래를 순서대로
해야 동작한다:

1. [Firebase 콘솔](https://console.firebase.google.com)에서 프로젝트 생성 → Android 앱 추가
   (패키지명 `com.choimedia.calendarapp`) → `google-services.json` 다운로드 → 이 프로젝트 루트에
   저장 → `app.json`의 `expo.android`에 `"googleServicesFile": "./google-services.json"` 한 줄 추가.
2. `npx eas login` → `npx eas init` (EAS 프로젝트 연결, `app.json`에 `extra.eas.projectId` 자동 기록).
3. `npx eas credentials` → Android → Push Notifications → Firebase 콘솔
   "프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성"으로 받은 JSON 업로드 (FCM V1 자격증명 등록).
4. `npx eas build -p android --profile preview` (또는 `development`)로 실제 빌드해서 설치.
5. Supabase SQL Editor에서 `supabase/schema.sql`(choi-media 웹 리포)의 `expo_push_tokens` 블록
   실행 (`alter publication ... schedules` 블록과 마찬가지로 대시보드에서 직접 실행해야 함).
6. Vercel 프로젝트 환경변수에 `SCHEDULE_WEBHOOK_SECRET`(임의의 랜덤 문자열) 추가 후 재배포.
7. Supabase 대시보드 → Database → Webhooks → 새 웹훅: 테이블 `schedules`, 이벤트 insert+update,
   URL `https://<배포 도메인>/api/webhooks/schedule-changed`, 커스텀 헤더
   `x-webhook-secret: <6번과 같은 값>`.

앱을 로그인하면 자동으로 Expo push token을 받아 `expo_push_tokens`에 등록한다(`src/lib/notifications.ts`의
`registerPushToken`). 실패해도(Expo Go, 자격증명 미설정 등) 로컬 알림 기능엔 영향 없다.

## 구조

```
index.ts                  # 엔트리 — 백그라운드 알림 태스크를 모듈 스코프에서 정의/등록
App.tsx                   # 세션 분기(Login/Calendar), 알림 초기화, AppState/Realtime 재동기화
src/lib/supabase.ts        # Supabase 클라이언트 (AsyncStorage 세션 저장)
src/lib/calendar.ts        # 날짜 계산 순수 함수 (choi-media 웹과 동일 로직)
src/lib/notifications.ts   # 권한/채널/로컬 알림 동기화(syncNotifications), 푸시 토큰 등록
src/api/schedules.ts       # schedules 테이블 CRUD 쿼리
src/api/pushTokens.ts      # expo_push_tokens upsert
src/hooks/schedules.ts     # react-query 훅
src/screens/               # LoginScreen, CalendarScreen
```

## 알아둘 점

- `schedules` 테이블 RLS는 `authenticated` role만 허용 — 이 앱도 반드시 로그인해야 데이터를
  볼 수 있다(별도 서비스 role 불필요).
- 서버의 `remind_sent` 컬럼은 웹의 기존 Web Push 크론(`/api/cron/send-reminders`)이 쓰는
  값이고, 이 앱은 참조하지 않는다 — 그 인프라를 걷어내도 이 앱 동작에는 영향 없음.
- `syncNotifications()`는 매번 기기의 예약 알림을 전부 취소하고 서버 상태로 다시 예약한다.
  서버가 유일한 소스이므로 이 방식이 가장 단순하고 정확하다.
