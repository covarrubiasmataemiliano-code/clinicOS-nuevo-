"use client";

import {
  Check,
  LogOut,
  Menu,
  Monitor,
  Moon,
  MoreHorizontal,
  RotateCcw,
  Sparkles,
  Sun,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { createContext, useContext, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { BrandingStyle } from "@/components/shell/branding-style";
import { NotificationBell } from "@/components/shell/notification-bell";
import { ConciergeLauncher } from "@/components/concierge/concierge-launcher";
import { UserAvatar } from "@/components/shared/user-avatar";
import {
  useLogout,
  useResetDemo,
  useSession,
  useSettings,
  useUpdateSettings,
} from "@/lib/data";
import {
  canAccess,
  mobileTabs,
  moduleForPath,
  overflowNav,
  visibleNav,
} from "@/lib/rbac";
import { MODULE_LABEL, ROLE_LABEL } from "@/lib/status-maps";
import { cn } from "@/lib/utils";
import { MOBILE_V2 } from "@/lib/flags";
import { useKeyboardInsets } from "@/hooks/use-keyboard-insets";

function UserMenu() {
  const { data: session } = useSession();
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const resetDemo = useResetDemo();
  const logout = useLogout();
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  if (!session) return null;
  const user = session.user;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Menú de usuario"
          className="interactive rounded-full ring-offset-background hover:ring-2 hover:ring-ring/40"
        >
          <UserAvatar nombre={user.nombre} avatarUrl={user.avatarUrl} className="size-8" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 shadow-floating">
        <DropdownMenuLabel>
          <p className="text-sm font-semibold">{user.nombre}</p>
          <p className="text-xs font-normal text-muted-foreground">
            {ROLE_LABEL[user.rol]} · {session.clinicNombre}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="flex items-center gap-2 text-sm">
            <Sparkles className="size-4 text-muted-foreground" />
            Modo demo
          </span>
          <Switch
            checked={settings?.demoMode ?? false}
            onCheckedChange={(on) =>
              updateSettings.mutate(
                { demoMode: on },
                {
                  onSuccess: () =>
                    toast.success(
                      on
                        ? "Modo demo encendido: llegarán mensajes simulados"
                        : "Modo demo apagado"
                    ),
                }
              )
            }
            aria-label="Modo demo"
          />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Tema
        </DropdownMenuLabel>
        {(
          [
            ["light", "Claro", Sun],
            ["dark", "Oscuro", Moon],
            ["system", "Sistema", Monitor],
          ] as const
        ).map(([value, label, Icon]) => (
          <DropdownMenuItem key={value} onClick={() => setTheme(value)}>
            <Icon className="size-4" />
            {label}
            {theme === value ? <Check className="ml-auto size-4" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            resetDemo.mutate(undefined, {
              onSuccess: () => toast.success("Demo reiniciada con datos frescos"),
            })
          }
        >
          <RotateCcw className="size-4" />
          Reiniciar demo
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            logout.mutate(undefined, {
              onSuccess: () => router.replace("/login"),
            })
          }
        >
          <LogOut className="size-4" />
          Cambiar de usuario
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MobileTabs({ keyboardOpen }: { keyboardOpen?: boolean }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  // El concierge NO es un tab normal: es el botón central elevado que monta
  // ConciergeLauncher. Lo excluimos de los tabs y del overflow.
  const hasConcierge = canAccess(session, "concierge");
  const tabs = mobileTabs(session).filter((t) => t.module !== "concierge");
  const overflow = overflowNav(session).filter((t) => t.module !== "concierge");

  if (!session || tabs.length === 0) return null;

  // Cuando hay concierge, reservamos un hueco central → mitad de tabs a cada lado.
  const mid = hasConcierge ? Math.ceil(tabs.length / 2) : tabs.length;
  const leftTabs = tabs.slice(0, mid);
  const rightTabs = tabs.slice(mid);

  const renderTab = (item: (typeof tabs)[number]) => {
    const active = pathname.startsWith(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          "interactive flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium",
          active ? "text-primary" : "text-muted-foreground"
        )}
      >
        <item.icon
          className={cn("size-5", active && "drop-shadow-sm")}
          strokeWidth={active ? 2.2 : 1.8}
        />
        {item.label}
      </Link>
    );
  };

  const moreButton = overflow.length ? (
    <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="interactive flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium text-muted-foreground"
        >
          <MoreHorizontal className="size-5" strokeWidth={1.8} />
          Más
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-2xl pb-[max(env(safe-area-inset-bottom),1rem)]">
        <SheetHeader>
          <SheetTitle>Más módulos</SheetTitle>
        </SheetHeader>
        <div className="grid grid-cols-3 gap-2 px-4 pb-2">
          {overflow.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMoreOpen(false)}
              className="interactive flex flex-col items-center gap-1.5 rounded-xl border bg-card p-4 text-xs font-medium shadow-soft hover:shadow-lifted"
            >
              <item.icon className="size-5 text-primary" strokeWidth={1.8} />
              {item.label}
            </Link>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  ) : null;

  return (
    <nav
      aria-label="Navegación principal"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)] transition-transform duration-200 md:hidden",
        // Al escribir, la barra se desliza hacia abajo para no estorbar.
        keyboardOpen && "translate-y-full"
      )}
    >
      <div className="flex items-stretch">
        <div className="flex flex-1 items-stretch">{leftTabs.map(renderTab)}</div>
        {/* Hueco central para el botón elevado del Concierge (ConciergeLauncher). */}
        {hasConcierge && <div className="w-16 shrink-0" aria-hidden />}
        <div className="flex flex-1 items-stretch">
          {rightTabs.map(renderTab)}
          {moreButton}
        </div>
      </div>
    </nav>
  );
}

/**
 * Drawer de navegación móvil (rediseño v2). Reemplaza la barra inferior por una
 * hamburguesa estilo app de Claude: panel deslizante con la lista completa de
 * módulos (concierge = "Sherlock" va primero). Solo móvil (`md:hidden`).
 */
function MobileDrawer() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const nav = visibleNav(session);

  if (!session) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Abrir menú"
        >
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[17rem] gap-0 p-0">
        <SheetHeader className="border-b px-4 py-3 text-left">
          <SheetTitle className="flex items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-soft">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">
                ClinicOS
              </p>
              <p className="truncate text-[11px] font-normal text-muted-foreground">
                {session.clinicNombre}
              </p>
            </div>
          </SheetTitle>
        </SheetHeader>
        <nav
          aria-label="Navegación principal"
          className="flex flex-col gap-1 overflow-y-auto p-2"
        >
          {nav.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "interactive flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium",
                  active
                    ? "bg-primary/15 text-primary ring-1 ring-inset ring-primary/25"
                    : "text-foreground hover:bg-muted"
                )}
              >
                <item.icon
                  className="size-5 shrink-0"
                  strokeWidth={active ? 2.1 : 1.8}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Chrome (header superior + barra inferior móvil) ocultable: el chat lo apaga en
 * mobile para ser inmersivo. En desktop NUNCA se oculta (mandan las clases md:).
 */
const ChromeContext = createContext<{
  hideChrome: boolean;
  setHideChrome: (v: boolean) => void;
}>({ hideChrome: false, setHideChrome: () => {} });

export function useChrome() {
  return useContext(ChromeContext);
}

export function AppShell({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const nav = visibleNav(session);
  const activeModule = moduleForPath(pathname);
  // Maneja el teclado virtual: fija `--app-height` y avisa cuando está abierto.
  const keyboardOpen = useKeyboardInsets();
  const [hideChrome, setHideChrome] = useState(false);

  return (
    <ChromeContext.Provider value={{ hideChrome, setHideChrome }}>
    <SidebarProvider
      // Fijado al viewport visual: el documento no puede scrollear (sin "área
      // muerta") y la altura por estilo inline anula el `min-h-svh` del shell
      // (en Tailwind v4 el important es sufijo; el estilo inline es a prueba de
      // balas), así el shell se encoge al alto del teclado.
      className="fixed inset-x-0 overflow-hidden"
      style={{
        top: "var(--app-top, 0px)",
        height: "var(--app-height, 100svh)",
        minHeight: 0,
      }}
    >
      <BrandingStyle />
      <Sidebar collapsible="icon" className="hidden md:flex">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-1.5 py-1">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-soft">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="truncate text-sm font-semibold leading-tight">
                ClinicOS
              </p>
              <p className="truncate text-[10px] text-muted-foreground">
                {session?.clinicNombre ?? "Plataforma de agentes IA"}
              </p>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              {nav.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.label}
                      className={cn(
                        "relative transition-colors",
                        active &&
                          "!bg-primary/15 font-semibold !text-primary ring-1 ring-inset ring-primary/25 hover:!bg-primary/20 before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-r-full before:bg-primary"
                      )}
                    >
                      <Link href={item.href}>
                        <item.icon strokeWidth={active ? 2.1 : 1.8} />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <SidebarInset className="h-full min-h-0 overflow-hidden">
        <header
          className={cn(
            "sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur-sm md:px-4",
            // Inmersivo: oculto en mobile cuando hay chat abierto; en desktop md:flex manda.
            hideChrome && "hidden md:flex"
          )}
        >
          {/* Móvil v2: hamburguesa → drawer de navegación (sin barra inferior). */}
          {MOBILE_V2 && <MobileDrawer />}
          <SidebarTrigger className="hidden md:inline-flex" aria-label="Colapsar menú" />
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold md:text-base">
              {activeModule ? MODULE_LABEL[activeModule] : "ClinicOS"}
            </p>
          </div>
          <div className="flex-1" />
          <NotificationBell />
          <UserMenu />
        </header>
        {/* `main` es el único scroller (altura fija vía el shell): el chat
            scrollea adentro y el documento no, así el teclado de iOS no se
            cierra. pb móvil = alto de la barra + safe-area (0 al escribir, que
            la barra se esconde). En v2 no hay barra inferior → solo safe-area. */}
        <main
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-y-auto md:pb-0",
            keyboardOpen
              ? // Con el teclado abierto, un respiro para que el contenido (p. ej.
                // el buscador) no quede pegado al teclado.
                "pb-3"
              : hideChrome
                ? "pb-[env(safe-area-inset-bottom)]"
                : MOBILE_V2
                  ? // v2 no-inmersivo: sin barra inferior ni FAB → el contenido
                    // llena hasta el borde (sin "piso"). El safe-area solo lo
                    // necesita el composer del chat (rama hideChrome).
                    "pb-0"
                  : "pb-[calc(env(safe-area-inset-bottom)+4rem)]"
          )}
        >
          {children}
        </main>
        {/* Legacy: barra inferior + botón central elevado. v2: el drawer del
            header sustituye a la barra (abajo despejado) y el launcher solo
            conserva la burbuja de escritorio. */}
        {!MOBILE_V2 && !hideChrome && <MobileTabs keyboardOpen={keyboardOpen} />}
        <ConciergeLauncher
          keyboardOpen={keyboardOpen}
          mobileButton={!MOBILE_V2 && !hideChrome}
        />
      </SidebarInset>
    </SidebarProvider>
    </ChromeContext.Provider>
  );
}
