import { useState, useMemo, useCallback } from 'react';
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
const CLUSTERS_LAYER_ID = 'campsite-clusters';
const CLUSTER_COUNT_LAYER_ID = 'campsite-cluster-count';
const CIRCLES_LAYER_ID = 'campsite-circles';
const MAP_STYLE = 'mapbox://styles/mapbox/outdoors-v12';
const WA_BOUNDS = [[-124.83, 45.54], [-116.92, 49.00]];

const clustersLayer = {
  id: CLUSTERS_LAYER_ID,
  type: 'circle',
  source: SOURCE_ID,
  filter: ['has', 'point_count'],
  paint: {
    'circle-color': 'rgba(39, 40, 34, 0.72)',
    'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 50, 26],
    'circle-stroke-width': 1.5,
    'circle-stroke-color': 'rgba(248, 248, 242, 0.35)',
  },
};

const clusterCountLayer = {
  id: CLUSTER_COUNT_LAYER_ID,
  type: 'symbol',
  source: SOURCE_ID,
  filter: ['has', 'point_count'],
  layout: {
    'text-field': '{point_count_abbreviated}',
    'text-size': 12,
    'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
  },
  paint: { 'text-color': '#f8f8f2' },
};

const circleLayerPaint = {
  'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 5, 10, 9],
  'circle-color': [
    'match',
    ['get', 'agency_short'],
    'wa-state-parks', AGENCY_COLORS['wa-state-parks'],
    'nps', AGENCY_COLORS.nps,
    'usfs', AGENCY_COLORS.usfs,
    'blm', AGENCY_COLORS.blm,
    '#CCCCCC',
  ],
  'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 3, 1],
  'circle-stroke-color': '#FFFFFF',
  'circle-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0.85],
};


function AppContent() {
  const { current: map } = useMap();
  const [selectedCampsite, setSelectedCampsite] = useState(null);
  const [campsiteDetails, setCampsiteDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [activeAgencies, setActiveAgencies] = useState(Object.keys(AGENCY_COLORS));
  const [mapError, setMapError] = useState(null);
  const isDebug = new URLSearchParams(window.location.search).has('debug');
  const [debugCopied, setDebugCopied] = useState(false);
  const [hoveredInfo, setHoveredInfo] = useState(null);
  const [viewState, setViewState] = useState({
    bounds: WA_BOUNDS,
    fitBoundsOptions: { padding: 40 },
  });

  const agencyFilter = useMemo(() => {
    const notCluster = ['!', ['has', 'point_count']];
    if (activeAgencies.length === 0) {
      return ['all', notCluster, ['==', ['get', 'agency_short'], '']];
    }
    if (activeAgencies.length === Object.keys(AGENCY_COLORS).length) {
      return notCluster;
    }
    return ['all', notCluster, ['in', ['get', 'agency_short'], ['literal', activeAgencies]]];
  }, [activeAgencies]);

  const unclusteredPointLayer = {
    id: CIRCLES_LAYER_ID,
    type: 'circle',
    source: SOURCE_ID,
    filter: agencyFilter,
    paint: circleLayerPaint,
  };

  const handleMapClick = useCallback((event) => {
    if (!map) return;
    const { features } = event;
    const clusterFeature = features?.find(f => f.layer.id === CLUSTERS_LAYER_ID);

    if (clusterFeature) {
      const clusterId = clusterFeature.properties.cluster_id;
      map.getSource(SOURCE_ID).getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err) return;
        map.easeTo({
          center: clusterFeature.geometry.coordinates,
          zoom,
        });
      });
      return;
    }

    const campsiteFeature = features?.find(f => f.layer.id === CIRCLES_LAYER_ID);
    if (campsiteFeature) {
      const p = campsiteFeature.properties;
      setSelectedCampsite({
        ...p,
        types: typeof p.types === 'string' ? JSON.parse(p.types) : p.types,
      });
    } else {
      setSelectedCampsite(null);
    }
  }, [map]);

  const onHover = useCallback(event => {
    const { features, point: { x, y } } = event;
    const hoveredFeature = features?.find(f => f.layer.id === CIRCLES_LAYER_ID);
    setHoveredInfo(hoveredFeature && { feature: hoveredFeature, x, y });
  }, []);

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
        <Map
          {...viewState}
          onMove={evt => setViewState(evt.viewState)}
          mapboxAccessToken={MAPBOX_TOKEN}
          mapStyle={MAP_STYLE}
          onClick={handleMapClick}
          onMouseMove={onHover}
          interactiveLayerIds={[CLUSTERS_LAYER_ID, CIRCLES_LAYER_ID]}
          onError={(e) => {
            console.error('Mapbox error:', e);
            const msg = e?.error?.message || e?.message || String(e);
            setMapError(`Map failed to load: ${msg}`);
          }}
        >
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

          <Source
            id={SOURCE_ID}
            type="geojson"
            data={campsiteData}
            cluster={true}
            clusterMaxZoom={13}
            clusterRadius={40}
          >
            <Layer {...clustersLayer} />
            <Layer {...clusterCountLayer} />
            <Layer {...unclusteredPointLayer} />
          </Source>

          <NavigationControl position="top-right" />

          {hoveredInfo && (
            <div className="tooltip" style={{ left: hoveredInfo.x, top: hoveredInfo.y }}>
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
        </Map>

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
  return <AppContent />;
}
