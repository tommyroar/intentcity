import '@testing-library/jest-dom';

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
    getCanvas: vi.fn(() => Object.assign(document.createElement('canvas'), { style: {} })),
    isStyleLoaded: vi.fn(() => true),
    project: vi.fn(([lng, lat]) => ({ x: lng * 10, y: lat * 10 })),
    // Call render callback synchronously so zoomcluster tests don't need to await a frame
    once: vi.fn((event, cb) => { if (event === 'render') cb(); }),
    triggerRepaint: vi.fn(),
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
