import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface MapMarker {
  name: string;
  latitude: number;
  longitude: number;
  subtitle?: string;
  color?: string;
}

interface LeafletMapProps {
  center: [number, number];
  zoom?: number;
  markers: MapMarker[];
  heightClass?: string;
}

export const LeafletMap: React.FC<LeafletMapProps> = ({
  center,
  zoom = 10,
  markers,
  heightClass = 'h-72',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center,
      zoom,
      scrollWheelZoom: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);

    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !layerRef.current) return;
    const layer = layerRef.current;
    layer.clearLayers();

    for (const m of markers) {
      const pinColor = m.color || '#14532D';
      const icon = L.divIcon({
        className: 'eco-map-pin',
        html: `<div style="width:16px;height:16px;border-radius:9999px;background:${pinColor};border:2.5px solid #ffffff;box-shadow:0 2px 6px rgba(15,23,42,0.35);"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      const marker = L.marker([m.latitude, m.longitude], { icon });
      marker.bindPopup(
        `<div style="font-family:sans-serif;font-size:12px;line-height:1.4;"><strong>${m.name.replace(/</g, '&lt;')}</strong>${
          m.subtitle ? `<br/><span>${m.subtitle.replace(/</g, '&lt;')}</span>` : ''
        }</div>`
      );
      marker.addTo(layer);
    }

    if (markers.length > 1) {
      const bounds = L.latLngBounds(markers.map((m) => [m.latitude, m.longitude] as [number, number]));
      mapRef.current.fitBounds(bounds, { padding: [36, 36], maxZoom: 11 });
    } else {
      mapRef.current.setView(center, zoom);
    }
  }, [center, zoom, markers]);

  return (
    <div
      ref={containerRef}
      className={`w-full ${heightClass} rounded-xl border border-slate-200 overflow-hidden z-0`}
      role="region"
      aria-label="Environmental Monitoring Geographical Map"
    />
  );
};
