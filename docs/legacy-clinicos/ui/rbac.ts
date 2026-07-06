/**
 * RBAC de UI — ÚNICA fuente de navegación y permisos del frontend.
 * Sidebar, bottom-tabs y guards se alimentan de aquí.
 *
 * Modelo: el rol define defaults; `user.modulePermissions` son los permisos
 * EFECTIVOS (el administrador los ajusta por usuario). `auditor` es exclusivo
 * de superadmin (uso interno de la agencia).
 */
import type { ModuleKey, Role, Session } from "@clinicos/contracts";
import { checkTier } from "@clinicos/contracts";
import { CONCIERGE_NAME } from "./flags";
import {
  BarChart3,
  Bell,
  Bot,
  CalendarDays,
  Contact,
  Inbox,
  Settings,
  ShieldCheck,
  Stethoscope,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  module: ModuleKey;
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { module: "concierge", href: "/concierge", label: CONCIERGE_NAME, icon: Bot },
  { module: "inbox", href: "/inbox", label: "Bandeja", icon: Inbox },
  { module: "crm", href: "/crm", label: "CRM", icon: Users },
  { module: "crm", href: "/contactos", label: "Contactos", icon: Contact },
  { module: "crm", href: "/crm/dashboards", label: "Dashboards", icon: BarChart3 },
  { module: "agenda", href: "/agenda", label: "Agenda", icon: CalendarDays },
  { module: "copiloto", href: "/copiloto", label: "Copiloto", icon: Stethoscope },
  { module: "finanzas", href: "/finanzas", label: "Finanzas", icon: Wallet },
  { module: "auditor", href: "/auditor", label: "Auditor", icon: ShieldCheck },
  {
    module: "notificaciones",
    href: "/notificaciones",
    label: "Notificaciones",
    icon: Bell,
  },
  {
    module: "configuracion",
    href: "/configuracion",
    label: "Configuración",
    icon: Settings,
  },
];

export function canAccess(
  session: Session | null | undefined,
  module: ModuleKey
): boolean {
  if (!session) return false;
  // Delega en la MISMA lógica que aplica el engine en `/rpc` (rbac.ts en
  // contracts) para que la nav de la UI y el enforcement del backend no diverjan.
  // `checkTier` ya trata `auditor` como exclusivo de superadmin.
  return checkTier(`MOD:${module}`, session.user);
}

/** Módulos visibles en la navegación para esta sesión. */
export function visibleNav(session: Session | null | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => canAccess(session, item.module));
}

/** A qué módulo pertenece una ruta (para el guard del layout). */
export function moduleForPath(pathname: string): ModuleKey | null {
  const seg = pathname.split("/")[1];
  const found = NAV_ITEMS.find((item) => item.href === `/${seg}`);
  return found?.module ?? null;
}

/**
 * Prioridad de tabs móviles por rol (máx 3 laterales; `concierge` va aparte como
 * botón central elevado y `notificaciones` se manda al menú "Más").
 * Barra resultante: [3 tabs] · [Concierge centro] · [Más].
 */
const MOBILE_MAX = 3;
const MOBILE_EXCLUDE: ModuleKey[] = ["concierge", "notificaciones"];
const MOBILE_PRIORITY: Record<Role, ModuleKey[]> = {
  doctor: ["inbox", "agenda", "copiloto"],
  auxiliar: ["inbox", "agenda", "copiloto"],
  administrador: ["inbox", "agenda", "copiloto"],
  superadmin: ["inbox", "agenda", "copiloto"],
};

export function mobileTabs(session: Session | null | undefined): NavItem[] {
  if (!session) return [];
  const priority = MOBILE_PRIORITY[session.user.rol];
  const byModule = new Map(NAV_ITEMS.map((i) => [i.module, i]));
  const tabs: NavItem[] = [];
  for (const m of priority) {
    if (canAccess(session, m)) tabs.push(byModule.get(m)!);
    if (tabs.length === MOBILE_MAX) return tabs;
  }
  // Completa con lo que tenga acceso (excluye concierge/notificaciones, que van
  // al botón central y a "Más" respectivamente).
  for (const item of NAV_ITEMS) {
    if (tabs.length === MOBILE_MAX) break;
    if (
      !tabs.includes(item) &&
      !MOBILE_EXCLUDE.includes(item.module) &&
      canAccess(session, item.module)
    ) {
      tabs.push(item);
    }
  }
  return tabs;
}

/** Módulos accesibles que NO caben en los tabs móviles (menú "Más"). */
export function overflowNav(session: Session | null | undefined): NavItem[] {
  const tabs = new Set(mobileTabs(session).map((t) => t.module));
  return visibleNav(session).filter((item) => !tabs.has(item.module));
}

export const DEFAULT_ROUTE = "/concierge";
export const LOGIN_ROUTE = "/login";
