import { useState, useMemo, useCallback, useRef, useEffect, memo } from 'react';
import Map, { Source, Layer, NavigationControl, Marker } from 'react-map-gl/mapbox';
import useSupercluster from 'use-supercluster';
import debounce from 'lodash.debounce';
import campsiteData from '../../data/campsites.json';
import 'mapbox-gl/dist/mapbox-gl.css';

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

const SOURCE_ID = 'campsites';
const CIRCLES_LAYER_ID = 'campsite-circles';
const MAP_STYLE = 'mapbox://styles/mapbox/outdoors-v12';
const WA_BOUNDS = [[-124.83, 45.54], [-116.92, 49.00]];

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
  'circle-stroke-width': 1.5,
  'circle-stroke-color': '#FFFFFF',
  'circle-opacity': 0.85,
};

// Memoize the ClusterMarker to prevent heavy SVG re-renders
const ClusterMarker = memo(({ count, agencyCounts, onClick }) => {
  const total = count;
  // Determine ring thickness based on count to keep it from exploding
  const strokeWidth = total > 50 ? 0.8 : total > 20 ? 1.2 : 2;
  const gap = 0.5;
  const baseRadius = 8;
  const rings = [];

  // Group by agency for the "bands" look
  Object.entries(agencyCounts).forEach(([agency, c]) => {
    for (let i = 0; i < c; i++) {
      rings.push(AGENCY_COLORS[agency] || '#ccc');
    }
  });

  const size = (baseRadius + total * (strokeWidth + gap)) * 2 + 4;

  return (
    <div onClick={onClick} style={{ cursor: 'pointer', transform: 'translate(-50%, -50%)' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={baseRadius - 2} fill="none" />
        {rings.map((color, i) => (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={baseRadius + i * (strokeWidth + gap)}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            opacity={0.8}
          />
        ))}
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dy=".3em"
          fill="#f8f8f2"
          fontSize="10px"
          fontWeight="bold"
          style={{ pointerEvents: 'none', fontFamily: 'monospace' }}
        >
          {total}
        </text>
      </svg>
    </div>
  );
});

ClusterMarker.displayName = 'ClusterMarker';

function AppContent({ mapboxAccessToken }) {
  const [selectedCampsite, setSelectedCampsite] = useState(null);
  const [campsiteDetails] = useState(null);
  const [loadingDetails] = useState(false);
  const [activeAgencies, setActiveAgencies] = useState(Object.keys(AGENCY_COLORS));
  const [reservableOnly, setReservableOnly] = useState(false);
  const [yearRoundOnly, setYearRoundOnly] = useState(false);
  const [mapError, setMapError] = useState(null);
  const isDebug = new URLSearchParams(window.location.search).has('debug');
  const [debugCopied, setDebugCopied] = useState(false);
  const [hoveredInfo, setHoveredInfo] = useState(null);
  const [panelHeight, setPanelHeight] = useState(window.innerHeight * 0.3);
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  const [viewState, setViewState] = useState({
    longitude: -120.5,
    latitude: 47.3,
    zoom: 6.5,
    padding: { top: 0, bottom: 0, left: 0, right: 0 }
  });

  const handleDragStart = useCallback((e) => {
    isDragging.current = true;
    startY.current = e.clientY || e.touches?.[0].clientY;
    startHeight.current = panelHeight;
    document.body.style.cursor = 'ns-resize';
  }, [panelHeight]);

  const handleDragMove = useCallback((e) => {
    if (!isDragging.current) return;
    const clientY = e.clientY || e.touches?.[0].clientY;
    const deltaY = startY.current - clientY;
    const newHeight = Math.max(100, Math.min(window.innerHeight * 0.8, startHeight.current + deltaY));
    setPanelHeight(newHeight);
  }, []);

  const handleDragEnd = useCallback(() => {
    isDragging.current = false;
    document.body.style.cursor = 'default';
  }, []);

  useEffect(() => {
    if (selectedCampsite) {
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
      window.addEventListener('touchmove', handleDragMove, { passive: false });
      window.addEventListener('touchend', handleDragEnd);
    }
    return () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('touchmove', handleDragMove);
      window.removeEventListener('touchend', handleDragEnd);
    };
  }, [selectedCampsite, handleDragMove, handleDragEnd]);

  const filteredFeatures = useMemo(() => {
    return campsiteData.features.filter(f => {
      const p = f.properties;
      if (!activeAgencies.includes(p.agency_short)) return false;
      if (reservableOnly && !p.reservable) return false;
      
      const isYearRound = p.availability_windows?.some(w => w.start === '01-01' && w.end === '12-31');
      if (yearRoundOnly && !isYearRound) return false;
      
      return true;
    }).map(f => ({
      ...f,
      properties: {
        ...f.properties,
        cluster: false // required by supercluster
      }
    }));
  }, [activeAgencies, reservableOnly, yearRoundOnly]);

  const mapRef = useRef();
  const [bounds, setBounds] = useState(WA_BOUNDS.flat());

  // Debounce the bounds update so clustering only runs after movement stops/slows
  const debouncedUpdateBounds = useMemo(
    () => debounce(() => {
      if (mapRef.current) {
        const b = mapRef.current.getMap().getBounds().toArray().flat();
        setBounds(b);
      }
    }, 100),
    []
  );

  useEffect(() => {
    return () => debouncedUpdateBounds.cancel();
  }, [debouncedUpdateBounds]);

  const superclusterOptions = useMemo(() => ({
    radius: 60,
    maxZoom: 13,
    map: (props) => ({
      agency_wa_state_parks: props.agency_short === 'wa-state-parks' ? 1 : 0,
      agency_nps: props.agency_short === 'nps' ? 1 : 0,
      agency_usfs: props.agency_short === 'usfs' ? 1 : 0,
      agency_blm: props.agency_short === 'blm' ? 1 : 0,
    }),
    reduce: (acc, props) => {
      acc.agency_wa_state_parks += props.agency_wa_state_parks;
      acc.agency_nps += props.agency_nps;
      acc.agency_usfs += props.agency_usfs;
      acc.agency_blm += props.agency_blm;
    }
  }), []);

  const { clusters, supercluster } = useSupercluster({
    points: filteredFeatures,
    bounds,
    zoom: Math.round(viewState.zoom),
    options: superclusterOptions
  });

  const handleMapClick = useCallback((event) => {
    const { features, lngLat } = event;
    const campsiteFeature = features?.find(f => f.layer.id === CIRCLES_LAYER_ID);
    if (campsiteFeature) {
      const p = campsiteFeature.properties;
      setSelectedCampsite({
        ...p,
        types: typeof p.types === 'string' ? JSON.parse(p.types) : p.types,
        availability_windows: typeof p.availability_windows === 'string' ? JSON.parse(p.availability_windows) : p.availability_windows,
        availability: typeof p.availability === 'string' ? JSON.parse(p.availability) : p.availability,
      });

      // Center the map on the clicked campsite and add padding for the info box
      const bottomPadding = window.innerHeight * 0.3;
      setViewState(prev => ({
        ...prev,
        longitude: lngLat.lng,
        latitude: lngLat.lat,
        padding: { ...prev.padding, bottom: bottomPadding }
      }));
    } else {
      setSelectedCampsite(null);
      setViewState(prev => ({
        ...prev,
        padding: { ...prev.padding, bottom: 0 }
      }));
    }
  }, []);

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

  const unclusteredGeoJSON = useMemo(() => ({
    type: 'FeatureCollection',
    features: clusters.filter(c => !c.properties.cluster)
  }), [clusters]);

  return (
    <div className="app">
      <div className="map-wrapper">
        <div className="map-container">
          <Map
            {...viewState}
            ref={mapRef}
            onMove={evt => {
              setViewState(evt.viewState);
              debouncedUpdateBounds();
            }}
            onLoad={() => debouncedUpdateBounds()}
            mapboxAccessToken={mapboxAccessToken}
            mapStyle={MAP_STYLE}
            onClick={handleMapClick}
            onMouseMove={onHover}
            interactiveLayerIds={[CIRCLES_LAYER_ID]}
            onError={(e) => {
              console.error('Mapbox error:', e);
              const msg = e?.error?.message || e?.message || String(e);
              setMapError(`Map failed to load: ${msg}`);
            }}
          >
            {clusters.map(cluster => {
              const [longitude, latitude] = cluster.geometry.coordinates;
              const { cluster: isCluster, point_count: pointCount } = cluster.properties;

              if (isCluster) {
                const agencyCounts = {
                  'wa-state-parks': cluster.properties.agency_wa_state_parks,
                  'nps': cluster.properties.agency_nps,
                  'usfs': cluster.properties.agency_usfs,
                  'blm': cluster.properties.agency_blm,
                };

                return (
                  <Marker
                    key={`cluster-${cluster.id}`}
                    longitude={longitude}
                    latitude={latitude}
                  >
                    <ClusterMarker
                      count={pointCount}
                      agencyCounts={agencyCounts}
                      onClick={() => {
                        const expansionZoom = Math.min(
                          supercluster.getClusterExpansionZoom(cluster.id),
                          20
                        );
                        mapRef.current.easeTo({
                          center: [longitude, latitude],
                          zoom: expansionZoom,
                          duration: 500
                        });
                      }}
                    />
                  </Marker>
                );
              }

              return null;
            })}

            <Source id={SOURCE_ID} type="geojson" data={unclusteredGeoJSON}>
              <Layer
                id={CIRCLES_LAYER_ID}
                type="circle"
                paint={circleLayerPaint}
              />
            </Source>

            <NavigationControl position="top-right" />
          </Map>
        </div>

        <div className="controls">
          <div className="filter-group">
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

          <div className="filter-group">
            <button
              className={`filter-toggle ${reservableOnly ? 'active' : 'inactive'}`}
              onClick={() => setReservableOnly(!reservableOnly)}
              aria-pressed={reservableOnly}
            >
              Reservable
            </button>
            <button
              className={`filter-toggle ${yearRoundOnly ? 'active' : 'inactive'}`}
              onClick={() => setYearRoundOnly(!yearRoundOnly)}
              aria-pressed={yearRoundOnly}
            >
              Year-round
            </button>
          </div>
        </div>

        {mapError && (
          <div className="map-error" role="alert">
            <strong>Map Error:</strong> {mapError}
          </div>
        )}

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

        {selectedCampsite && (
          <div 
            className="detail-panel" 
            role="dialog" 
            aria-label="Campsite details"
            style={{ height: `${panelHeight}px` }}
          >
            <div 
              className="panel-drag-handle" 
              onMouseDown={handleDragStart}
              onTouchStart={handleDragStart}
            >
              <div className="handle-bar" />
            </div>

            <button
              className="panel-close"
              onClick={() => {
                setSelectedCampsite(null);
                setViewState(prev => ({
                  ...prev,
                  padding: { ...prev.padding, bottom: 0 }
                }));
              }}
              aria-label="Close panel"
            >
              ✕
            </button>

            <div className="panel-content">
              <div className="panel-agency" style={{ color: AGENCY_COLORS[selectedCampsite.agency_short] }}>
                {AGENCY_LABELS[selectedCampsite.agency_short] || selectedCampsite.agency}
              </div>

              <h2 className="panel-name">{selectedCampsite.name}</h2>

              <div className="panel-meta">
                <span className="panel-sites">
                  <strong>{selectedCampsite.sites}</strong> sites
                </span>
                {selectedCampsite.availability_windows?.some(w => w.start === '01-01' && w.end === '12-31') ? (
                  <span className="panel-badge year-round">Year-round</span>
                ) : selectedCampsite.availability_windows?.[0] ? (
                  <span className="panel-badge seasonal">
                    Seasonal ({selectedCampsite.availability_windows[0].start} to {selectedCampsite.availability_windows[0].end})
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

              {selectedCampsite.availability?.summary?.first_available && (
                <div className="availability-summary">
                  <span className="availability-label">First Available:</span>
                  <span className="availability-date">
                    {new Date(selectedCampsite.availability.summary.first_available).toLocaleDateString(undefined, {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </div>
              )}

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
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const mapboxAccessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
  if (!mapboxAccessToken) {
    return (
      <div className="map-error" role="alert">
        <strong>Map Error:</strong> No Mapbox token found. Set VITE_MAPBOX_ACCESS_TOKEN in your .env file.
      </div>
    );
  }
  return <AppContent mapboxAccessToken={mapboxAccessToken} />;
}
