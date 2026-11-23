import { useState, type DragEvent, type ReactNode } from "react";
import type { SidebarCardId } from "../lib/sidebarCardOrder";
import { applySidebarReorder, filterTextOrder } from "../lib/sidebarCardOrder";

export interface SidebarDragHandlers {
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
}

interface SidebarSortableListProps {
  mode: "text" | "instruments";
  order: SidebarCardId[];
  onOrderChange: (order: SidebarCardId[]) => void;
  renderCard: (id: SidebarCardId, drag: SidebarDragHandlers) => ReactNode;
}

export function SidebarSortableList({ mode, order, onOrderChange, renderCard }: SidebarSortableListProps) {
  const [dragId, setDragId] = useState<SidebarCardId | null>(null);
  const [overId, setOverId] = useState<SidebarCardId | null>(null);
  const displayOrder = mode === "text" ? filterTextOrder(order) : order;

  function dragHandlers(id: SidebarCardId): SidebarDragHandlers {
    return {
      onDragStart: (event) => {
        setDragId(id);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", id);
      },
      onDragEnd: () => {
        setDragId(null);
        setOverId(null);
      },
      onDragOver: (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOverId(id);
      },
      onDrop: (event) => {
        event.preventDefault();
        if (dragId && dragId !== id) {
          onOrderChange(applySidebarReorder(order, dragId, id, mode));
        }
        setDragId(null);
        setOverId(null);
      }
    };
  }

  return (
    <div className="flex flex-col gap-3">
      {displayOrder.map((id) => (
        <div
          key={id}
          className={`${dragId === id ? "opacity-45" : ""} ${overId === id && dragId !== id ? "border-t border-emerald-400/70" : ""}`}
          onDragOver={dragHandlers(id).onDragOver}
          onDrop={dragHandlers(id).onDrop}
        >
          {renderCard(id, dragHandlers(id))}
        </div>
      ))}
    </div>
  );
}
