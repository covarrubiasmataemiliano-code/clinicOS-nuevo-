/**
 * Estilo de control segmentado (ToggleGroup) homologado en toda la app:
 * pista gris (bg-muted) + pastilla activa blanca con sombra y transición suave,
 * igual que las pestañas de la Bandeja. Usar en CRM, Agenda, etc. para
 * mantener consistencia visual.
 */
export const SEGMENT_TRACK = "h-9 gap-0.5 rounded-lg bg-muted p-[3px]";

export const SEGMENT_ITEM =
  "h-full gap-1.5 rounded-md px-3 text-sm font-medium text-foreground/60 transition-all hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm";
