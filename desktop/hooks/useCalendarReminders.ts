"use client";

import { useEffect, useRef } from "react";
import { dueCalendarReminders } from "@/lib/bt-reminder";
import type { CalendarBook } from "@/lib/bt-calendar-model";

const STORAGE_KEY = "bt-calendar-reminders-v1";
const POLL_MS = 30_000;

function loadSeen(): Record<string, number> {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return value && typeof value === "object" ? value as Record<string, number> : {};
  } catch { return {}; }
}

export function useCalendarReminders() {
  const seen = useRef<Record<string, number>>({});
  useEffect(() => {
    seen.current = loadSeen();
    let stopped = false;
    const check = async () => {
      if (stopped || typeof window === "undefined" || !window.piDesktop?.showNotification) return;
      try {
        const response = await fetch("/api/bt/calendar", { cache: "no-store" });
        if (!response.ok) return;
        const book = await response.json() as CalendarBook;
        const now = Date.now();
        for (const reminder of dueCalendarReminders(book.events, now)) {
          if (seen.current[reminder.key] && now - seen.current[reminder.key] < 24 * 60 * 60 * 1000) continue;
          seen.current[reminder.key] = now;
          const detail = reminder.minutesBefore === 0 ? "现在开始" : `${reminder.minutesBefore} 分钟后开始`;
          void window.piDesktop.showNotification({ title: `日程提醒：${reminder.event.title}`, detail: `${detail} · ${reminder.event.timeZone}`, duration: "60" });
        }
        const cutoff = now - 7 * 24 * 60 * 60 * 1000;
        for (const [key, timestamp] of Object.entries(seen.current)) if (timestamp < cutoff) delete seen.current[key];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(seen.current));
      } catch { /* Calendar reminders are best effort and never block the chat UI. */ }
    };
    void check();
    const timer = window.setInterval(() => void check(), POLL_MS);
    return () => { stopped = true; window.clearInterval(timer); };
  }, []);
}
