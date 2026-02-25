import React from 'react';
import { render, screen, act, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMap } from 'react-map-gl/mapbox';
import App from './App.jsx';

// Provide a fake VITE_MAPBOX_ACCESS_TOKEN so the map initializes without error
beforeEach(() => {
  import.meta.env.VITE_MAPBOX_ACCESS_TOKEN = 'pk.test_token';
});

// Mock the react-map-gl/mapbox components
vi.mock('react-map-gl/mapbox', () => {
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
    getMap: vi.fn(() => ({
      getBounds: vi.fn(() => ({
        toArray: vi.fn(() => [[-125, 45], [-115, 50]]),
      })),
    })),
  };

  const MockMap = React.forwardRef(({ children, onClick }, ref) => {
    React.useImperativeHandle(ref, () => ({
      easeTo: mockMap.easeTo,
      getMap: mockMap.getMap,
    }));

    return (
      <div
        role="application"
        onClick={(e) => {
          if (onClick) {
            onClick({
              features: e.detail?.features || [],
              point: { x: 0, y: 0 },
              lngLat: { lng: 0, lat: 0 },
              originalEvent: e
            });
          }
        }}
        data-testid="map-mock"
      >
        {children}
      </div>
    );
  });
  MockMap.displayName = 'MockMap';

  return {
    default: MockMap,
    Map: MockMap,
    Source: ({ children }) => <div data-testid="source-mock">{children}</div>,
    Layer: () => <div data-testid="layer-mock" />,
    Marker: ({ children }) => <div data-testid="marker-mock">{children}</div>,
    Popup: ({ children, longitude, latitude }) => (
      <div data-testid="popup-mock" data-lng={longitude} data-lat={latitude}>
        {children}
      </div>
    ),
    NavigationControl: () => <div data-testid="nav-control-mock" />,
    useMap: vi.fn(() => ({
      current: mockMap,
    })),
  };
});


describe('App smoke tests', () => {
  it('renders the controls overlay', () => {
    render(<App />);
    const controls = document.querySelector('.controls');
    expect(controls).not.toBeNull();
  });

  it('renders all four agency toggle buttons', () => {
    render(<App />);
    expect(screen.getByText(/WA State Parks/i)).toBeInTheDocument();
    expect(screen.getByText(/National Park Service/i)).toBeInTheDocument();
    expect(screen.getByText(/US Forest Service/i)).toBeInTheDocument();
    expect(screen.getByText(/Bureau of Land Management/i)).toBeInTheDocument();
  });

  it('agency toggle buttons are pressed by default', () => {
    render(<App />);
    const buttons = screen.getAllByRole('button', { name: /State Parks|Park Service|Forest|Land Management/i });
    buttons.forEach((btn) => {
      expect(btn).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('toggling an agency button changes aria-pressed to false', async () => {
    const user = userEvent.setup();
    render(<App />);
    const waBtn = screen.getByText(/WA State Parks/i).closest('button');
    expect(waBtn).toHaveAttribute('aria-pressed', 'true');
    await user.click(waBtn);
    expect(waBtn).toHaveAttribute('aria-pressed', 'false');
  });

  it('detail panel is not shown initially', () => {
    render(<App />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Standalone mode (VITE_STANDALONE=true)', () => {
  let fetchSpy;
  let mockMap;

  const fakeCampsite = {
    id: 'test-site',
    name: 'Rainier Base Camp',
    agency_short: 'nps',
    sites: 30,
    types: '["tent"]',
    availability_windows: '[{"start": "05-01", "end": "09-30", "booking_advance_days": 180}]',
    reservable: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    import.meta.env.VITE_STANDALONE = 'true';
    import.meta.env.VITE_MAPBOX_ACCESS_TOKEN = 'pk.test_token';
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    mockMap = useMap().current;
  });

  afterEach(() => {
    delete import.meta.env.VITE_STANDALONE;
    fetchSpy.mockRestore();
  });

  it('does not call fetch when a campsite is selected', async () => {
    render(<App />);
    const map = screen.getByRole('application');
    act(() => {
      map.dispatchEvent(new CustomEvent('click', {
        bubbles: true,
        detail: { features: [{ 
          layer: { id: 'campsite-circles' }, 
          properties: fakeCampsite,
          geometry: { coordinates: [-121.7, 46.8] }
        }] }
      }));
    });
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('clicking a cluster calls getClusterExpansionZoom and eases to it', async () => {
    const user = userEvent.setup();
    // Force use-supercluster to return a cluster
    const cluster = {
      id: 42,
      geometry: { coordinates: [-122.5, 47.5] },
      properties: { cluster: true, point_count: 5, agency_nps: 5 }
    };
    const { default: useSupercluster } = await import('use-supercluster');
    useSupercluster.mockReturnValue({
      clusters: [cluster],
      supercluster: { getClusterExpansionZoom: vi.fn(() => 12) }
    });

    render(<App />);
    const clusterElement = screen.getByText('5').parentElement;
    await user.click(clusterElement);

    await waitFor(() => expect(mockMap.easeTo).toHaveBeenCalledWith({
      center: [-122.5, 47.5],
      zoom: 12,
      duration: 500
    }));
  });

  it('detail panel renders campsite info from GeoJSON properties', async () => {
    render(<App />);
    const map = screen.getByRole('application');
    act(() => {
      map.dispatchEvent(new CustomEvent('click', {
        bubbles: true,
        detail: { features: [{ 
          layer: { id: 'campsite-circles' }, 
          properties: fakeCampsite,
          geometry: { coordinates: [-121.7, 46.8] }
        }] }
      }));
    });

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const panel = screen.getByRole('dialog');
    expect(within(panel).getByText('Rainier Base Camp')).toBeInTheDocument();
    expect(within(panel).getByText(/30/, { selector: 'strong' })).toBeInTheDocument();
    expect(within(panel).getByText(/National Park Service/i)).toBeInTheDocument();
    expect(within(panel).queryByText(/Loading additional details/i)).not.toBeInTheDocument();
  });

  it('campsite title has drag handle cursor style', async () => {
    render(<App />);
    const map = screen.getByRole('application');
    act(() => {
      map.dispatchEvent(new CustomEvent('click', {
        bubbles: true,
        detail: { features: [{ 
          layer: { id: 'campsite-circles' }, 
          properties: fakeCampsite,
          geometry: { coordinates: [-121.7, 46.8] }
        }] }
      }));
    });

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const panel = screen.getByRole('dialog');
    const title = within(panel).getByText('Rainier Base Camp');
    expect(title).toHaveStyle({ cursor: 'ns-resize' });
  });
});
