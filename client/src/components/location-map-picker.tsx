import { useState, useEffect, useRef, useCallback } from "react";
import { Search, MapPin, Loader2, Navigation } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address?: {
    road?: string;
    city?: string;
    town?: string;
    village?: string;
    country?: string;
    postcode?: string;
  };
}

interface LocationValue {
  address: string;
  lat: number;
  lng: number;
}

interface LocationMapPickerProps {
  value?: LocationValue | null;
  onChange: (val: LocationValue) => void;
  placeholder?: string;
}

export function LocationMapPicker({ value, onChange, placeholder = "Search address…" }: LocationMapPickerProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [searchQuery, setSearchQuery] = useState(value?.address || "");
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leafletRef = useRef<any>(null);

  const defaultLat = value?.lat ?? 34.9;
  const defaultLng = value?.lng ?? 33.0;
  const defaultZoom = value?.lat ? 16 : 9;

  useEffect(() => {
    let destroyed = false;

    async function initMap() {
      if (!mapContainerRef.current) return;
      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      if (destroyed || !mapContainerRef.current) return;
      leafletRef.current = L;

      if (mapRef.current) return;

      const map = L.default.map(mapContainerRef.current, { zoomControl: true }).setView(
        [defaultLat, defaultLng],
        defaultZoom
      );
      mapRef.current = map;

      L.default.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      const icon = L.default.divIcon({
        html: `<div style="width:32px;height:40px;display:flex;align-items:flex-start;justify-content:center;">
          <svg viewBox="0 0 24 32" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:32px;height:40px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4))">
            <path d="M12 0C7.03 0 3 4.03 3 9c0 6.75 9 18 9 18s9-11.25 9-18c0-4.97-4.03-9-9-9z" fill="#9b2c2c"/>
            <circle cx="12" cy="9" r="3.5" fill="white"/>
          </svg>
        </div>`,
        className: "",
        iconSize: [32, 40],
        iconAnchor: [16, 40],
      });

      if (value?.lat) {
        const marker = L.default.marker([value.lat, value.lng], { icon, draggable: true }).addTo(map);
        markerRef.current = marker;
        marker.on("dragend", () => {
          const pos = marker.getLatLng();
          reverseGeocode(pos.lat, pos.lng);
        });
      }

      map.on("click", (e: any) => {
        const { lat, lng } = e.latlng;
        placeMarker(lat, lng);
        reverseGeocode(lat, lng);
      });
    }

    initMap();
    return () => { destroyed = true; };
  }, []);

  function placeMarker(lat: number, lng: number) {
    const L = leafletRef.current;
    if (!L || !mapRef.current) return;

    const icon = L.default.divIcon({
      html: `<div style="width:32px;height:40px;display:flex;align-items:flex-start;justify-content:center;">
        <svg viewBox="0 0 24 32" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:32px;height:40px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4))">
          <path d="M12 0C7.03 0 3 4.03 3 9c0 6.75 9 18 9 18s9-11.25 9-18c0-4.97-4.03-9-9-9z" fill="#9b2c2c"/>
          <circle cx="12" cy="9" r="3.5" fill="white"/>
        </svg>
      </div>`,
      className: "",
      iconSize: [32, 40],
      iconAnchor: [16, 40],
    });

    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
    } else {
      const marker = L.default.marker([lat, lng], { icon, draggable: true }).addTo(mapRef.current);
      markerRef.current = marker;
      marker.on("dragend", () => {
        const pos = marker.getLatLng();
        reverseGeocode(pos.lat, pos.lng);
      });
    }
  }

  async function reverseGeocode(lat: number, lng: number) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
        { headers: { "Accept-Language": "en" } }
      );
      const data = await res.json();
      const addr = data.display_name || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      setSearchQuery(addr);
      onChange({ address: addr, lat, lng });
    } catch {
      onChange({ address: `${lat.toFixed(6)}, ${lng.toFixed(6)}`, lat, lng });
    }
  }

  const searchNominatim = useCallback(async (q: string) => {
    if (q.length < 3) { setSuggestions([]); return; }
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5&addressdetails=1`,
        { headers: { "Accept-Language": "en" } }
      );
      const results: NominatimResult[] = await res.json();
      setSuggestions(results);
      setShowSuggestions(true);
    } catch {
      setSuggestions([]);
    } finally {
      setSearching(false);
    }
  }, []);

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setSearchQuery(q);
    setShowSuggestions(false);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => searchNominatim(q), 400);
  }

  function handleSelectSuggestion(result: NominatimResult) {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    setSearchQuery(result.display_name);
    setSuggestions([]);
    setShowSuggestions(false);
    placeMarker(lat, lng);
    if (mapRef.current) mapRef.current.setView([lat, lng], 16);
    onChange({ address: result.display_name, lat, lng });
  }

  function handleUseMyLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude } = pos.coords;
      placeMarker(latitude, longitude);
      if (mapRef.current) mapRef.current.setView([latitude, longitude], 16);
      reverseGeocode(latitude, longitude);
    });
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={handleSearchChange}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder={placeholder}
            className="pl-8 pr-8"
            data-testid="input-map-search"
          />
          {searching && <Loader2 className="absolute right-2.5 w-4 h-4 animate-spin text-muted-foreground" />}
        </div>

        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-50 w-full mt-1 rounded-md border bg-popover shadow-lg max-h-52 overflow-y-auto">
            {suggestions.map((s) => (
              <button
                key={s.place_id}
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-start gap-2"
                onMouseDown={() => handleSelectSuggestion(s)}
              >
                <MapPin className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                <span className="line-clamp-2">{s.display_name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleUseMyLocation}
          className="text-xs"
          data-testid="button-use-my-location"
        >
          <Navigation className="w-3 h-3 mr-1" />
          Use my location
        </Button>
        <p className="text-xs text-muted-foreground self-center">or click on the map to pin</p>
      </div>

      <div
        ref={mapContainerRef}
        className="w-full h-56 rounded-md border overflow-hidden bg-muted"
        data-testid="location-map"
      />
    </div>
  );
}
