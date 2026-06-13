export type SidebarCardId =
  | "vehicle"
  | "motion"
  | "attitude"
  | "compass"
  | "gps"
  | "battery"
  | "radio"
  | "system"
  | "session";

/** Recommended flight-priority order (armed/mode → motion → attitude/heading → nav → power/link → FC → session). */
export const DEFAULT_SIDEBAR_ORDER: SidebarCardId[] = [
  "vehicle",
  "motion",
  "attitude",
  "compass",
  "gps",
  "battery",
  "radio",
  "system",
  "session"
];

const STORAGE_KEY = "uav-gcs.sidebar.order";
const LEGACY_KEYS = ["uav-gcs.sidebar.order.text", "uav-gcs.sidebar.order.instruments"] as const;

const TEXT_VISIBLE = new Set<SidebarCardId>([
  "vehicle",
  "attitude",
  "gps",
  "battery",
  "radio",
  "system",
  "session"
]);

export function isTextSidebarCard(id: SidebarCardId): boolean {
  return TEXT_VISIBLE.has(id);
}

export function filterTextOrder(order: SidebarCardId[]): SidebarCardId[] {
  return order.filter(isTextSidebarCard);
}

export function loadSidebarOrder(): SidebarCardId[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return normalizeOrder(parsed, DEFAULT_SIDEBAR_ORDER);
      }
    } catch {
      /* fall through to migration */
    }
  }

  for (const legacyKey of LEGACY_KEYS) {
    const legacyRaw = localStorage.getItem(legacyKey);
    if (!legacyRaw) continue;
    try {
      const parsed = JSON.parse(legacyRaw) as unknown;
      if (Array.isArray(parsed)) {
        const migrated = normalizeOrder(parsed, DEFAULT_SIDEBAR_ORDER);
        saveSidebarOrder(migrated);
        return migrated;
      }
    } catch {
      continue;
    }
  }

  return [...DEFAULT_SIDEBAR_ORDER];
}

export function saveSidebarOrder(order: SidebarCardId[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
}

export function defaultSidebarOrder(): SidebarCardId[] {
  return [...DEFAULT_SIDEBAR_ORDER];
}

const DEPRECATED_CARD_IDS = new Set(["groundTarget"]);

function normalizeOrder(stored: unknown[], defaults: SidebarCardId[]): SidebarCardId[] {
  const allowed = new Set(defaults);
  const seen = new Set<SidebarCardId>();
  const result: SidebarCardId[] = [];

  for (const entry of stored) {
    if (typeof entry !== "string" || DEPRECATED_CARD_IDS.has(entry) || !allowed.has(entry as SidebarCardId)) continue;
    const id = entry as SidebarCardId;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }

  for (const id of defaults) {
    if (!seen.has(id)) result.push(id);
  }

  return result;
}

export function reorderSidebarCards(order: SidebarCardId[], dragId: SidebarCardId, targetId: SidebarCardId): SidebarCardId[] {
  if (dragId === targetId) return order;

  const from = order.indexOf(dragId);
  const to = order.indexOf(targetId);
  if (from < 0 || to < 0) return order;

  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, dragId);
  return next;
}

/** Reorder visible cards in Text mode while keeping hidden Inst-only slots (motion, compass) in place. */
export function mergeTextReorder(fullOrder: SidebarCardId[], reorderedVisible: SidebarCardId[]): SidebarCardId[] {
  let visibleIndex = 0;

  return fullOrder.map((id) => {
    if (!isTextSidebarCard(id)) return id;
    const next = reorderedVisible[visibleIndex];
    visibleIndex += 1;
    return next ?? id;
  });
}

export function applySidebarReorder(
  fullOrder: SidebarCardId[],
  dragId: SidebarCardId,
  targetId: SidebarCardId,
  mode: "text" | "instruments"
): SidebarCardId[] {
  if (mode === "instruments") {
    return reorderSidebarCards(fullOrder, dragId, targetId);
  }

  const visible = filterTextOrder(fullOrder);
  const reorderedVisible = reorderSidebarCards(visible, dragId, targetId);
  return mergeTextReorder(fullOrder, reorderedVisible);
}
