import { create } from 'zustand';
import { fetchNotifications } from '../lib/slots';

// Unread-notification count shared by the TopBar badge and the
// Profile notifications section. Refreshed on route change (TopBar) and
// after read mutations (section) — no polling loop, no realtime channel.
interface NotificationsState {
  /** Null until the first successful fetch (badge hidden while unknown). */
  unread: number | null;
  refresh: () => Promise<void>;
}

export const useNotifications = create<NotificationsState>()((set) => ({
  unread: null,

  refresh: async () => {
    try {
      const res = await fetchNotifications();
      set({ unread: res.unreadCount });
    } catch {
      // Badge is advisory: a failed refresh keeps the last known count
      // rather than flashing the badge off and on.
    }
  },
}));
