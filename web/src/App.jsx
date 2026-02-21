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

export default function App() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const hoveredIdRef = useRef(null);

  const [selectedCampsite, setSelectedCampsite] = useState(null);
  const [clusterCandidates, setClusterCandidates] = useState(null);
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
        setClusterCandidates(null);
        return;
      }
      if (features.length === 1) {
        setSelectedCampsite(parseFeature(features[0]));
        setClusterCandidates(null);
        return;
      }
      // Multiple nearby campsites — let the user choose
      setSelectedCampsite(null);
      setClusterCandidates({ x, y, items: features.map(parseFeature) });
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

      {clusterCandidates && (() => {
        const R = 100;
        const PADDING = 18;
        const DOT_R = 7;
        const { x, y, items } = clusterCandidates;

        // Project each campsite's geographic coordinates to pixel offsets
        // from the click point, preserving their relative spatial arrangement.
        const withOffsets = items.map((item) => ({
          ...item,
          ox: item._coordinates
            ? mapRef.current.project(item._coordinates).x - x
            : 0,
          oy: item._coordinates
            ? mapRef.current.project(item._coordinates).y - y
            : 0,
        }));

        const maxDist = Math.max(...withOffsets.map((p) => Math.hypot(p.ox, p.oy)), 1);
        const scale = (R - PADDING) / maxDist;

        return (
          <svg
            className="cluster-zoom"
            style={{ left: x, top: y, pointerEvents: 'none' }}
            width={R * 2}
            height={R * 2}
            aria-label="Nearby campsites"
          >
            {/* Dark background — clicking it dismisses the zoom view */}
            <circle
              cx={R} cy={R} r={R - 1}
              fill="rgba(30, 30, 30, 0.88)"
              style={{ pointerEvents: 'all', cursor: 'default' }}
              onClick={() => setClusterCandidates(null)}
            />

            {/* Campsite dots at their scaled relative positions */}
            {withOffsets.map((item) => {
              const cx = R + item.ox * scale;
              const cy = R + item.oy * scale;
              return (
                <g
                  key={item.name}
                  role="button"
                  aria-label={item.name}
                  style={{ pointerEvents: 'all', cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedCampsite(item);
                    setClusterCandidates(null);
                  }}
                >
                  <circle cx={cx} cy={cy} r={DOT_R + 8} fill="transparent" />
                  <circle
                    cx={cx} cy={cy} r={DOT_R}
                    fill={AGENCY_COLORS[item.agency_short] || '#CCCCCC'}
                    stroke="#FFFFFF"
                    strokeWidth={1.5}
                  />
                </g>
              );
            })}

            {/* Border ring */}
            <circle
              cx={R} cy={R} r={R - 1}
              fill="none"
              stroke="#3e3e3e"
              strokeWidth={1.5}
              style={{ pointerEvents: 'none' }}
            />
          </svg>
        );
      })()}

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
