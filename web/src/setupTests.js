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
    setFeatureState: vi.fn(),
    queryRenderedFeatures: vi.fn(() => []),
    getCanvas: vi.fn(() => ({ style: {} })),
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
