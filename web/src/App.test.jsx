import { render, screen, act, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mapboxgl from 'mapbox-gl';
import App from './App.jsx';

// Provide a fake VITE_MAPBOX_ACCESS_TOKEN so the map initializes without error
beforeEach(() => {
  import.meta.env.VITE_MAPBOX_ACCESS_TOKEN = 'pk.test_token';
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

  it('renders the map container element', () => {
    render(<App />);
    // The map container div is rendered inside map-wrapper
    const wrapper = document.querySelector('.map-container');
    expect(wrapper).not.toBeNull();
  });
});

describe('Standalone mode (VITE_STANDALONE=true)', () => {
  let fetchSpy;

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
  });

  afterEach(() => {
    delete import.meta.env.VITE_STANDALONE;
    fetchSpy.mockRestore();
  });

  function selectCampsite(campsite) {
    const mapInstance = mapboxgl.Map.mock.results.at(-1).value;
    const clickHandler = mapInstance.on.mock.calls.find(
      ([event, second]) => event === 'click' && typeof second === 'function'
    )?.[1];
    mapInstance.queryRenderedFeatures.mockReturnValueOnce([{ properties: campsite }]);
    act(() => {
      clickHandler({ point: { x: 0, y: 0 } });
    });
  }

  it('does not call fetch when a campsite is selected', async () => {
    render(<App />);
    selectCampsite(fakeCampsite);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows cluster zoom when multiple campsites are in the click buffer', async () => {
    const second = { ...fakeCampsite, name: 'Alpine Meadow Camp', agency_short: 'usfs' };
    render(<App />);
    const mapInstance = mapboxgl.Map.mock.results.at(-1).value;
    const clickHandler = mapInstance.on.mock.calls.find(
      ([event, fn]) => event === 'click' && typeof fn === 'function'
    )?.[1];
    mapInstance.queryRenderedFeatures.mockReturnValueOnce([
      { properties: fakeCampsite, geometry: { coordinates: [-122.50, 47.50] } },
      { properties: second,       geometry: { coordinates: [-122.51, 47.51] } },
    ]);
    act(() => { clickHandler({ point: { x: 100, y: 100 } }); });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Rainier Base Camp' })).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Alpine Meadow Camp' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('selecting from cluster zoom opens the detail panel', async () => {
    const second = { ...fakeCampsite, name: 'Alpine Meadow Camp', agency_short: 'usfs' };
    render(<App />);
    const mapInstance = mapboxgl.Map.mock.results.at(-1).value;
    const clickHandler = mapInstance.on.mock.calls.find(
      ([event, fn]) => event === 'click' && typeof fn === 'function'
    )?.[1];
    mapInstance.queryRenderedFeatures.mockReturnValueOnce([
      { properties: fakeCampsite, geometry: { coordinates: [-122.50, 47.50] } },
      { properties: second,       geometry: { coordinates: [-122.51, 47.51] } },
    ]);
    act(() => { clickHandler({ point: { x: 100, y: 100 } }); });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Alpine Meadow Camp' })).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole('button', { name: 'Alpine Meadow Camp' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Alpine Meadow Camp' })).not.toBeInTheDocument();
  });

  it('detail panel renders campsite info from GeoJSON properties', async () => {
    render(<App />);
    selectCampsite(fakeCampsite);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const panel = screen.getByRole('dialog');
    expect(within(panel).getByText('Rainier Base Camp')).toBeInTheDocument();
    expect(within(panel).getByText(/30/)).toBeInTheDocument();
    expect(within(panel).getByText(/National Park Service/i)).toBeInTheDocument();
    expect(within(panel).queryByText(/Loading additional details/i)).not.toBeInTheDocument();
  });
});
