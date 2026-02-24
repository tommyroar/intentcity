import '@testing-library/jest-dom';

// Provide a dummy token for tests
vi.stubEnv('VITE_MAPBOX_ACCESS_TOKEN', 'pk.test-token');

// Mock use-supercluster
vi.mock('use-supercluster', () => ({
  default: vi.fn(({ points }) => ({
    clusters: points || [],
    supercluster: {
      getClusterExpansionZoom: vi.fn(() => 10),
    },
  })),
}));

// Mock mapbox-gl for tests (it requires a browser canvas)
vi.mock('mapbox-gl', () => {
  const mockMap = {
    on: vi.fn(),
    off: vi.fn(),
    remove: vi.fn(),
    addControl: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    setFilter: vi.fn(),
    setLayoutProperty: vi.fn(),
    setFeatureState: vi.fn(),
    queryRenderedFeatures: vi.fn(() => []),
    getCanvas: vi.fn(() => ({ style: {} })),
    getSource: vi.fn(() => ({
      getClusterExpansionZoom: vi.fn((clusterId, cb) => cb(null, 10)),
    })),
    easeTo: vi.fn(),
    isStyleLoaded: vi.fn(() => true),
  };

  return {
    default: {
      Map: vi.fn(() => mockMap),
      NavigationControl: vi.fn(),
      accessToken: null,
    },
    Map: vi.fn(() => mockMap),
    NavigationControl: vi.fn(),
  };
});

// Suppress mapbox-gl CSS import warnings
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
