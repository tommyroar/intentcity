import { render, screen, act, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMap } from 'react-map-gl/mapbox';
import App from './App.jsx';

// Provide a fake VITE_MAPBOX_ACCESS_TOKEN so the map initializes without error
beforeEach(() => {
  import.meta.env.VITE_MAPBOX_ACCESS_TOKEN = 'pk.test_token';
});

// Mock the useMap hook
vi.mock('react-map-gl/mapbox', async () => {
  const actual = await vi.importActual('react-map-gl/mapbox');
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
    getSource: vi.fn(() => ({
      getClusterExpansionZoom: vi.fn((clusterId, cb) => cb(null, 10)),
    })),
    easeTo: vi.fn(),
    isStyleLoaded: vi.fn(() => true),
    project: vi.fn(([lng, lat]) => ({ x: lng * 10, y: lat * 10 })),
    once: vi.fn((event, cb) => { if (event === 'render') cb(); }),
    triggerRepaint: vi.fn(),
  };

  return {
    ...actual,
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
    year_round: false,
    open_month: 5,
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
      // Simulate click event on the map
      const onClick = map.props.onClick;
      onClick({
        features: [{ layer: { id: 'campsite-circles' }, properties: fakeCampsite }],
        point: { x: 0, y: 0 }
      });
    });
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('clicking a cluster calls getClusterExpansionZoom and eases to it', async () => {
    render(<App />);
    const map = screen.getByRole('application');
    const clusterFeature = {
      layer: { id: 'campsite-clusters' },
      properties: { cluster_id: 42, point_count: 5 },
      geometry: { coordinates: [-122.5, 47.5] }
    };

    act(() => {
      const onClick = map.props.onClick;
      onClick({
        features: [clusterFeature],
        point: { x: 100, y: 100 }
      });
    });

    await waitFor(() => expect(mockMap.easeTo).toHaveBeenCalledWith({
      center: [-122.5, 47.5],
      zoom: 10,
    }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('detail panel renders campsite info from GeoJSON properties', async () => {
    render(<App />);
    const map = screen.getByRole('application');
    act(() => {
      const onClick = map.props.onClick;
      onClick({
        features: [{ layer: { id: 'campsite-circles' }, properties: fakeCampsite }],
        point: { x: 0, y: 0 }
      });
    });

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const panel = screen.getByRole('dialog');
    expect(within(panel).getByText('Rainier Base Camp')).toBeInTheDocument();
    expect(within(panel).getByText(/30/)).toBeInTheDocument();
    expect(within(panel).getByText(/National Park Service/i)).toBeInTheDocument();
    expect(within(panel).queryByText(/Loading additional details/i)).not.toBeInTheDocument();
  });
});
