import { useEffect, useState } from 'react';
import { hasTerrain, loadTerrain } from './terrain';

/** Ground height at a position, from the map's height data; null if unknown. */
export default function useElevation(mapName, position) {
  const [terrain, setTerrain] = useState(null);
  useEffect(() => {
    let live = true;
    setTerrain(null);
    if (hasTerrain(mapName)) loadTerrain(mapName).then((t) => { if (live) setTerrain(t); }).catch(() => {});
    return () => { live = false; };
  }, [mapName]);
  if (!terrain || !position || !Number.isFinite(position.x)) return null;
  return Math.max(0, Math.round(terrain.heightAt(position.x, position.y)));
}
