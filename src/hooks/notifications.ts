// choi-media 웹의 app/admin/notifications/_hooks/notifications.ts와 같은 구조.
// 차이점: 일정이 생기면 기기 쪽 파생 상태(로컬 알림 + 위젯)도 함께 맞춘다(resyncDevice).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createScheduleFromEvent,
  getNotifications,
  getUnhandledCount,
  markAllHandled,
  setCategory,
  setHandled,
} from "../api/notifications";
import { resyncDevice } from "../lib/resync";
import type { NotificationCategory, ScheduleFromEventInput } from "../types";

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications", "list"],
    queryFn: getNotifications,
  });
}

/** 헤더 메뉴 뱃지용 미확인 건수. 목록과 같은 ["notifications"] 접두사라 무효화가 함께 걸린다. */
export function useUnhandledCount() {
  return useQuery({
    queryKey: ["notifications", "unhandled-count"],
    queryFn: getUnhandledCount,
  });
}

function useInvalidateNotifications() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["notifications"] });
}

export function useSetHandled() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: ({ id, handled }: { id: string; handled: boolean }) => setHandled(id, handled),
    onSettled: invalidate,
  });
}

export function useMarkAllHandled() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: markAllHandled,
    onSettled: invalidate,
  });
}

export function useSetCategory() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: ({ id, category }: { id: string; category: NotificationCategory }) =>
      setCategory(id, category),
    onSettled: invalidate,
  });
}

export function useCreateScheduleFromEvent() {
  const qc = useQueryClient();
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: (input: ScheduleFromEventInput) => createScheduleFromEvent(input),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["schedules"] });
      void resyncDevice();
      invalidate();
    },
  });
}
