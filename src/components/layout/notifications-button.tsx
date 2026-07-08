"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";

import { cn } from "@/lib/utils";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";

/**
 * Botón circular de Notificaciones — vive en el Header, junto al toggle
 * de tema. Reemplaza la entrada que antes estaba en el menú lateral.
 * Navega a /notifications y muestra un badge con el número de no leídas
 * (misma fuente que usaba el sidebar: useUnreadNotifications).
 */
export function NotificationsButton({ className }: { className?: string }) {
  const pathname = usePathname();
  const unread = useUnreadNotifications();
  const isActive =
    pathname === "/notifications" || pathname.startsWith("/notifications/");

  return (
    <Link
      href="/notifications"
      aria-label={
        unread > 0
          ? `Notificaciones, ${unread} sin leer`
          : "Notificaciones"
      }
      title="Notificaciones"
      className={cn(
        // Mismo tamaño que ModeToggle (40×40) pero circular, como pidió el diseño.
        "relative flex h-10 w-10 items-center justify-center rounded-full transition-colors",
        isActive
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      <Bell className="h-5 w-5" />
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground ring-2 ring-background"
        >
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
