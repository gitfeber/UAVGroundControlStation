import { MAP_BASEMAP_OPTIONS, type MapBasemapId } from "../lib/mapBasemaps";

interface MapBasemapSwitcherProps {
  value: MapBasemapId;
  onChange: (id: MapBasemapId) => void;
}

export function MapBasemapSwitcher({ value, onChange }: MapBasemapSwitcherProps) {
  return (
    <div
      data-tour="map-basemap"
      className="map-basemap-switcher absolute right-4 top-4 z-10 flex"
      role="group"
      aria-label="Map basemap"
    >
      {MAP_BASEMAP_OPTIONS.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            className={`map-basemap-switcher__btn${active ? " map-basemap-switcher__btn--active" : ""}`}
            aria-pressed={active}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
