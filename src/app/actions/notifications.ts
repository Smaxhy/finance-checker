"use server";
// Server wrappers - the logic lives in src/lib/actions/notifications.ts.
import * as impl from "@/lib/actions/notifications";

export async function markNotificationRead(...args: Parameters<typeof impl.markNotificationRead>): ReturnType<typeof impl.markNotificationRead> {
  return impl.markNotificationRead(...args);
}

export async function markAllNotificationsRead(...args: Parameters<typeof impl.markAllNotificationsRead>): ReturnType<typeof impl.markAllNotificationsRead> {
  return impl.markAllNotificationsRead(...args);
}

export async function deleteNotification(...args: Parameters<typeof impl.deleteNotification>): ReturnType<typeof impl.deleteNotification> {
  return impl.deleteNotification(...args);
}

export async function refreshNotifications(...args: Parameters<typeof impl.refreshNotifications>): ReturnType<typeof impl.refreshNotifications> {
  return impl.refreshNotifications(...args);
}
