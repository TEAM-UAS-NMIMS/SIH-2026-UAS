import { useEffect } from "react";
import { useMap } from "react-leaflet";

/**
 * MapAutoResize — keeps Leaflet's internal size in step with its container.
 *
 * Leaflet measures its container once at mount and caches that size. Inside a
 * flex/grid layout the container's final height often isn't known yet at that
 * moment, so the map keeps a stale (sometimes zero) size and renders no tiles —
 * a blank grey panel with working controls, which is exactly how this presented
 * after the console layout changed.
 *
 * A ResizeObserver on the container calls invalidateSize() whenever the box
 * actually changes, which covers the initial layout settle, window resizes,
 * and panels being shown/hidden or resized around the map.
 */
export default function MapAutoResize() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();

    // Settle the first measurement after the current layout pass.
    const raf = requestAnimationFrame(() => map.invalidateSize({ animate: false }));

    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    observer.observe(container);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [map]);

  return null;
}
