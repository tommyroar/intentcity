import { useState, useCallback, useMemo } from 'react';
import Map, { Source, Layer, NavigationControl, useMap } from 'react-map-gl/mapbox';
import campsiteData from '../../data/campsites.json';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

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
const CIRCLES_LAYER_ID = 'campsite-circles';
const MAP_STYLE = 'mapbox://styles/mapbox/outdoors-v12';
const ZOOM_FACTOR = 4;   // how much the zoomcluster magnifies the map
const ZOOM_R = 100;      // radius of the zoomcluster circle in px

const circleLayerPaint = {
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
};

function AppContent() {
  const { current: map } = useMap();
  const [selectedCampsite, setSelectedCampsite] = useState(null);
  const [zoomcluster, setZoomcluster] = useState(null);
  const [campsiteDetails, setCampsiteDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [activeAgencies, setActiveAgencies] = useState(
    Object.keys(AGENCY_COLORS)
  );
  const [mapError, setMapError] = useState(null);
  const isDebug = new URLSearchParams(window.location.search).has('debug');
  const [debugCopied, setDebugCopied] = useState(false);
  const [hoveredInfo, setHoveredInfo] = useState(null);

  const agencyFilter = useMemo(() => {
    if (activeAgencies.length === 0) return ['==', ['get', 'agency_short'], ''];
    if (activeAgencies.length === Object.keys(AGENCY_COLORS).length) return null;
    return ['in', ['get', 'agency_short'], ['literal', activeAgencies]];
  }, [activeAgencies]);

  const handleMapClick = useCallback((event) => {
    if (!map) return;

    const CLICK_BUFFER = 10;
    const { x, y } = event.point;
    const features = map.queryRenderedFeatures(
      [[x - CLICK_BUFFER, y - CLICK_BUFFER], [x + CLICK_BUFFER, y + CLICK_BUFFER]],
      { layers: [CIRCLES_LAYER_ID] }
    );

    const parseFeature = (f) => {
      const p = f.properties;
      return {
        ...p,
        types: typeof p.types === 'string' ? JSON.parse(p.types) : p.types,
        _coordinates: f.geometry?.coordinates,
      };
    };

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

    const items = features.map(parseFeature);
    const coords = items.filter((i) => i._coordinates).map((i) => i._coordinates);
    const avgLng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
    const avgLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    const centroid = map.project([avgLng, avgLat]);

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

    map.setLayoutProperty(CIRCLES_LAYER_ID, 'visibility', 'none');
    map.once('render', () => {
      const dpr = window.devicePixelRatio || 1;
      const DIAM = ZOOM_R * 2;
      const srcW = DIAM / ZOOM_FACTOR;
      const srcH = DIAM / ZOOM_FACTOR;
      const offscreen = document.createElement('canvas');
      offscreen.width = DIAM * dpr;
      offscreen.height = DIAM * dpr;
      const ctx = offscreen.getContext('2d');
      try {
        ctx.drawImage(
          map.getCanvas(),
          (centroid.x - srcW / 2) * dpr, (centroid.y - srcH / 2) * dpr,
          srcW * dpr, srcH * dpr,
          0, 0, DIAM * dpr, DIAM * dpr,
        );
      } catch (_) { /* canvas unreadable */ }
      const mapSnapshot = offscreen.toDataURL();
      map.setLayoutProperty(CIRCLES_LAYER_ID, 'visibility', 'visible');
      setZoomcluster({ screenX: centroid.x, screenY: centroid.y, mapSnapshot, items: svgItems });
    });
    map.triggerRepaint();
  }, [map]);

  const onHover = useCallback(event => {
    const {
      features,
      point: {x, y}
    } = event;
    const hoveredFeature = features && features[0];
    setHoveredInfo(hoveredFeature && {feature: hoveredFeature, x, y});
  }, []);

  const toggleAgency = (agency) => {
    setActiveAgencies((prev) =>
      prev.includes(agency)
        ? prev.filter((a) => a !== agency)
        : [...prev, agency]
    );
  };
  
  const circleLayer = {
    id: CIRCLES_LAYER_ID,
    type: 'circle',
    paint: circleLayerPaint,
  };
  if (agencyFilter) {
    circleLayer.filter = agencyFilter;
  }

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
        <Source id={SOURCE_ID} type="geojson" data={campsiteData}>
            <Layer {...circleLayer} />
        </Source>
        <NavigationControl position="top-right" />
        {hoveredInfo && (
          <div className="tooltip" style={{left: hoveredInfo.x, top: hoveredInfo.y}}>
            <div>{hoveredInfo.feature.properties.name}</div>
          </div>
        )}


        {isDebug && (
          <div
            className="debug-panel"
            onClick={() => {
              const text = JSON.stringify(viewState);
              navigator.clipboard.writeText(text).then(() => {
                setDebugCopied(true);
                setTimeout(() => setDebugCopied(false), 1500);
              });
            }}
            style={{ cursor: 'copy', pointerEvents: 'auto' }}
          >
            {debugCopied
              ? 'copied!'
              : `zoom: ${viewState.zoom.toFixed(2)} | lng: ${viewState.longitude.toFixed(4)} | lat: ${viewState.latitude.toFixed(4)}`}
          </div>
        )}

      {zoomcluster && (
        <div
          className="zoomcluster"
          style={{ left: zoomcluster.screenX, top: zoomcluster.screenY }}
          aria-label="Nearby campsites"
          onClick={() => setZoomcluster(null)}
        >
          <img src={zoomcluster.mapSnapshot} className="zoomcluster-map" alt="" draggable={false} />
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
                <circle cx={item.svgX} cy={item.svgY} r={8} fill={AGENCY_COLORS[item.agency_short] || '#CCCCCC'} stroke="white" strokeWidth={1.5} />
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
                    <span role="img" aria-label="calendar">🗓️</span> {new Date(date).toLocaleDateString(undefined, {
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


export default function App() {
  if (!MAPBOX_TOKEN) {
    return (
      <div className="map-error" role="alert">
        <strong>Map Error:</strong> No Mapbox token found. Set VITE_MAPBOX_ACCESS_TOKEN in your .env file.
      </div>
    );
  }

  return (
    <Map
        initialViewState={{
            bounds: [[-124.83, 45.54], [-116.92, 49.00]],
            fitBoundsOptions: { padding: 40 },
        }}
        mapboxAccessToken={MAPBOX_TOKEN}
        mapStyle={MAP_STYLE}
        onClick={useCallback(e => handleMapClick(e), [])}
        onMouseMove={useCallback(e => onHover(e), [])}
        interactiveLayerIds={[CIRCLES_LAYER_ID]}
        preserveDrawingBuffer={true}
    >
        <AppContent />
    </Map>
  );
}
