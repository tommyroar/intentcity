import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import campsiteData from '../../data/campsites.json';

const AGENCY_COLORS = {
  'wa-state-parks': '#A6E22E',
  nps: '#FD971F',
  usfs: '#66D9EF',
  blm: '#E6DB74',
};

const AGENCY_LABELS = {
  'wa-state-parks': 'WA State Parks',
  nps: 'National Park Service',
  usfs: 'US Forest Service',
  blm: 'Bureau of Land Management',
};

const MONTH_NAMES = [
  '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const SOURCE_ID = 'campsites';
const CIRCLES_LAYER = 'campsite-circles';
const MAP_STYLE = 'mapbox://styles/mapbox/outdoors-v12';
const WA_BOUNDS = [[-124.83, 45.54], [-116.92, 49.00]];
const ZOOM_FACTOR = 4;   // how much the zoomcluster magnifies the map
const ZOOM_R = 100;      // radius of the zoomcluster circle in px

export default function App() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const hoveredIdRef = useRef(null);

  const [selectedCampsite, setSelectedCampsite] = useState(null);
  const [zoomcluster, setZoomcluster] = useState(null);
  const [campsiteDetails, setCampsiteDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [activeAgencies, setActiveAgencies] = useState(
    Object.keys(AGENCY_COLORS)
  );
  const [mapError, setMapError] = useState(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const isDebug = new URLSearchParams(window.location.search).has('debug');
  const [debugInfo, setDebugInfo] = useState({ zoom: '—', lng: '—', lat: '—' });
  const [debugCopied, setDebugCopied] = useState(false);

  // Build Mapbox filter expression for active agencies
  const buildFilter = useCallback((agencies) => {
    if (agencies.length === 0) return ['==', ['get', 'agency_short'], ''];
    if (agencies.length === Object.keys(AGENCY_COLORS).length) return null;
    return ['in', ['get', 'agency_short'], ['literal', agencies]];
  }, []);

  // Initialize map
  useEffect(() => {
    const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
    if (!token) {
      setMapError(
        'No Mapbox token found. Set VITE_MAPBOX_ACCESS_TOKEN in your .env file.'
      );
      return;
    }

    mapboxgl.accessToken = token;

    let map;
    try {
      map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: MAP_STYLE,
        bounds: WA_BOUNDS,
        fitBoundsOptions: { padding: 40 },
        failIfMajorPerformanceCaveat: false,
        preserveDrawingBuffer: true,
      });
    } catch (e) {
      setMapError(`Map failed to load: ${e.message}`);
      return;
    }

    mapRef.current = map;

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    if (isDebug) {
      const updateDebug = () => {
        const c = map.getCenter();
        setDebugInfo({
          zoom: map.getZoom().toFixed(2),
          lng: c.lng.toFixed(4),
          lat: c.lat.toFixed(4),
        });
      };
      map.on('idle', updateDebug);
      map.on('move', updateDebug);
    }

    map.on('error', (e) => {
      console.error('Mapbox error:', e);
      const msg = e?.error?.message || e?.message || String(e);
      setMapError(`Map failed to load: ${msg}`);
    });

    map.on('load', () => {
      // Add campsite GeoJSON source
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: campsiteData,
        generateId: true,
      });

      // Base circle layer
      map.addLayer({
        id: CIRCLES_LAYER,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5, 5,
            10, 9,
          ],
          'circle-color': [
            'match',
            ['get', 'agency_short'],
            'wa-state-parks', AGENCY_COLORS['wa-state-parks'],
            'nps', AGENCY_COLORS.nps,
            'usfs', AGENCY_COLORS.usfs,
            'blm', AGENCY_COLORS.blm,
            '#CCCCCC',
          ],
          'circle-stroke-width': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            3,
            1,
          ],
          'circle-stroke-color': '#FFFFFF',
          'circle-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            1,
            0.85,
          ],
        },
      });

      setMapLoaded(true);
    });

    // Hover interaction
    map.on('mousemove', CIRCLES_LAYER, (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const id = e.features[0]?.id;
      if (id === undefined) return;
      if (hoveredIdRef.current !== null && hoveredIdRef.current !== id) {
        map.setFeatureState(
          { source: SOURCE_ID, id: hoveredIdRef.current },
          { hover: false }
        );
      }
      hoveredIdRef.current = id;
      map.setFeatureState({ source: SOURCE_ID, id }, { hover: true });
    });

    map.on('mouseleave', CIRCLES_LAYER, () => {
      map.getCanvas().style.cursor = '';
      if (hoveredIdRef.current !== null) {
        map.setFeatureState(
          { source: SOURCE_ID, id: hoveredIdRef.current },
          { hover: false }
        );
        hoveredIdRef.current = null;
      }
    });

    // Click to select campsite, with a pixel buffer for easier tapping.
    // When multiple campsites fall within the buffer, show a picker instead
    // of silently selecting an arbitrary one.
    const CLICK_BUFFER = 10;
    const parseFeature = (f) => {
      const p = f.properties;
      return {
        ...p,
        types: typeof p.types === 'string' ? JSON.parse(p.types) : p.types,
        _coordinates: f.geometry?.coordinates,
      };
    };
    map.on('click', (e) => {
      const { x, y } = e.point;
      const features = map.queryRenderedFeatures(
        [[x - CLICK_BUFFER, y - CLICK_BUFFER], [x + CLICK_BUFFER, y + CLICK_BUFFER]],
        { layers: [CIRCLES_LAYER] }
      );
      if (features.length === 0) {
        setSelectedCampsite(null);
        setZoomcluster(null);
        return;
      }
      if (features.length === 1) {
        setSelectedCampsite(parseFeature(features[0]));
        setZoomcluster(null);
        return;
      }
      // Multiple nearby campsites — show the zoomcluster.
      // Centre it on the geographic centroid so it is equidistant from all points.
      const items = features.map(parseFeature);
      const coords = items.filter((i) => i._coordinates).map((i) => i._coordinates);
      const avgLng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
      const avgLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
      const centroid = map.project([avgLng, avgLat]);

      // Capture a ZOOM_FACTOR× zoomed crop of the map centred on the cluster.
      const DIAM = ZOOM_R * 2;
      const srcW = DIAM / ZOOM_FACTOR;
      const srcH = DIAM / ZOOM_FACTOR;
      const offscreen = document.createElement('canvas');
      offscreen.width = DIAM;
      offscreen.height = DIAM;
      const ctx = offscreen.getContext('2d');
      try {
        ctx.drawImage(
          map.getCanvas(),
          centroid.x - srcW / 2, centroid.y - srcH / 2, srcW, srcH,
          0, 0, DIAM, DIAM,
        );
      } catch (_) { /* canvas unreadable in some environments */ }
      const mapSnapshot = offscreen.toDataURL();

      // Compute each dot's position within the zoomcluster SVG.
      const svgItems = items.map((item) => {
        if (!item._coordinates) return { ...item, svgX: ZOOM_R, svgY: ZOOM_R };
        const px = map.project(item._coordinates);
        return {
          ...item,
          svgX: ZOOM_R + (px.x - centroid.x) * ZOOM_FACTOR,
          svgY: ZOOM_R + (px.y - centroid.y) * ZOOM_FACTOR,
        };
      });

      setSelectedCampsite(null);
      setZoomcluster({ screenX: centroid.x, screenY: centroid.y, mapSnapshot, items: svgItems });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [isDebug]);

  // Apply agency filters when activeAgencies or map load state changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const filter = buildFilter(activeAgencies);
    map.setFilter(CIRCLES_LAYER, filter);
  }, [activeAgencies, mapLoaded, buildFilter]);

  // Fetch campsite details from API when one is selected
  useEffect(() => {
    if (!selectedCampsite) {
      setCampsiteDetails(null);
      return;
    }

    // Standalone mode: all data is embedded in GeoJSON, no backend needed
    if (import.meta.env.VITE_STANDALONE === 'true') {
      return;
    }

    setLoadingDetails(true);
    // Use the ID from the selected campsite feature properties
    const id = selectedCampsite.id;
    if (!id) {
        console.warn('No ID found for selected campsite');
        setLoadingDetails(false);
        return;
    }

    const backendUrl = window.location.hostname === 'localhost' 
      ? 'http://localhost:8787' 
      : `http://${window.location.hostname}:8787`;

    fetch(`${backendUrl}/campsite/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch details');
        return res.json();
      })
      .then((data) => {
        setCampsiteDetails(data);
        setLoadingDetails(false);
      })
      .catch((err) => {
        console.error('Error fetching campsite details:', err);
        setLoadingDetails(false);
      });
  }, [selectedCampsite]);

  const toggleAgency = (agency) => {
    setActiveAgencies((prev) =>
      prev.includes(agency)
        ? prev.filter((a) => a !== agency)
        : [...prev, agency]
    );
  };

  return (
    <div className="app">
      <div className="map-wrapper">
        <div className="controls">
          {Object.entries(AGENCY_LABELS).map(([key, label]) => (
            <button
              key={key}
              className={`agency-toggle ${activeAgencies.includes(key) ? 'active' : 'inactive'}`}
              style={
                activeAgencies.includes(key)
                  ? { borderColor: AGENCY_COLORS[key], color: AGENCY_COLORS[key] }
                  : {}
              }
              onClick={() => toggleAgency(key)}
              aria-pressed={activeAgencies.includes(key)}
            >
              <span
                className="agency-dot"
                style={
                  activeAgencies.includes(key)
                    ? { backgroundColor: AGENCY_COLORS[key] }
                    : {}
                }
              />
              {label}
            </button>
          ))}
        </div>

        {mapError && (
          <div className="map-error" role="alert">
            <strong>Map Error:</strong> {mapError}
          </div>
        )}
        <div ref={mapContainerRef} className="map-container" />

        {isDebug && (
          <div
            className="debug-panel"
            onClick={() => {
              const text = JSON.stringify(debugInfo);
              if (navigator.clipboard) {
                navigator.clipboard.writeText(text);
              } else {
                const el = document.createElement('textarea');
                el.value = text;
                el.style.cssText = 'position:fixed;opacity:0';
                document.body.appendChild(el);
                el.select();
                document.execCommand('copy');
                document.body.removeChild(el);
              }
              setDebugCopied(true);
              setTimeout(() => setDebugCopied(false), 1500);
            }}
            style={{ cursor: 'copy', pointerEvents: 'auto' }}
          >
            {debugCopied
              ? 'copied!'
              : `zoom: ${debugInfo.zoom} | lng: ${debugInfo.lng} | lat: ${debugInfo.lat}`}
          </div>
        )}

      {zoomcluster && (
        <div
          className="zoomcluster"
          style={{ left: zoomcluster.screenX, top: zoomcluster.screenY }}
          aria-label="Nearby campsites"
          onClick={() => setZoomcluster(null)}
        >
          {/* Zoomed map snapshot — forms the glass background */}
          <img src={zoomcluster.mapSnapshot} className="zoomcluster-map" alt="" draggable={false} />

          {/* Invisible hit targets + hover rings over each campsite dot */}
          <svg className="zoomcluster-overlay" width={ZOOM_R * 2} height={ZOOM_R * 2} style={{ pointerEvents: 'none' }}>
            {zoomcluster.items.map((item) => (
              <g
                key={item.name}
                role="button"
                aria-label={item.name}
                className="zoomcluster-point"
                style={{ pointerEvents: 'all', cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedCampsite(item);
                  setZoomcluster(null);
                }}
              >
                <circle cx={item.svgX} cy={item.svgY} r={24} fill="transparent" />
                <circle cx={item.svgX} cy={item.svgY} r={20} fill="transparent" stroke="white" strokeWidth={2} className="zoomcluster-ring" />
              </g>
            ))}
          </svg>
        </div>
      )}

      {selectedCampsite && (
        <div className="detail-panel" role="dialog" aria-label="Campsite details">
          <button
            className="panel-close"
            onClick={() => setSelectedCampsite(null)}
            aria-label="Close panel"
          >
            ✕
          </button>

          <div className="panel-agency" style={{ color: AGENCY_COLORS[selectedCampsite.agency_short] }}>
            {AGENCY_LABELS[selectedCampsite.agency_short] || selectedCampsite.agency}
          </div>

          <h2 className="panel-name">{selectedCampsite.name}</h2>

          <div className="panel-meta">
            <span className="panel-sites">
              <strong>{selectedCampsite.sites}</strong> sites
            </span>
            {selectedCampsite.year_round ? (
              <span className="panel-badge year-round">Year-round</span>
            ) : selectedCampsite.open_month ? (
              <span className="panel-badge seasonal">
                Opens {MONTH_NAMES[selectedCampsite.open_month]}
              </span>
            ) : null}
            {selectedCampsite.reservable ? (
              <span className="panel-badge reservable">Reservable</span>
            ) : (
              <span className="panel-badge first-come">First-come</span>
            )}
          </div>

          <div className="panel-types">
            {selectedCampsite.types.map((t) => (
              <span key={t} className="type-badge">
                {t}
              </span>
            ))}
          </div>

          {selectedCampsite.notes && (
            <p className="panel-notes">{selectedCampsite.notes}</p>
          )}

          {loadingDetails ? (
            <div className="loading-indicator">Loading additional details...</div>
          ) : campsiteDetails?.reservation_dates?.length > 0 ? (
            <div className="panel-reservations">
              <h3>Opening Reservation Dates</h3>
              <ul className="res-list">
                {campsiteDetails.reservation_dates.map((date) => (
                  <li key={date} className="res-item">
                    ðŸ—“ï¸  {new Date(date).toLocaleDateString(undefined, {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="panel-actions">
            <a
              href={selectedCampsite.reservation_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-reserve"
            >
              Reserve / Info →
            </a>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
