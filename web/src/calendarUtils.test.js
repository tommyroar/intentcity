import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatWindowDate, fmtDate, resolveBookingOpenDate, buildCalendarUrl } from './calendarUtils.js';

// Pin "today" to 2026-06-15 for all date-dependent tests
const TODAY = new Date(2026, 5, 15); // June 15, 2026

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TODAY);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// fmtDate
// ---------------------------------------------------------------------------
describe('fmtDate', () => {
  it('formats a date to YYYYMMDD', () => {
    expect(fmtDate(new Date(2026, 10, 2))).toBe('20261102');
  });

  it('zero-pads single-digit month and day', () => {
    expect(fmtDate(new Date(2026, 0, 5))).toBe('20260105');
  });

  it('handles December 31', () => {
    expect(fmtDate(new Date(2026, 11, 31))).toBe('20261231');
  });
});

// ---------------------------------------------------------------------------
// formatWindowDate
// ---------------------------------------------------------------------------
describe('formatWindowDate', () => {
  it('formats May 1st', () => {
    expect(formatWindowDate('05-01')).toBe('May 1');
  });

  it('formats December 31st', () => {
    expect(formatWindowDate('12-31')).toBe('Dec 31');
  });

  it('formats January 1st', () => {
    expect(formatWindowDate('01-01')).toBe('Jan 1');
  });
});

// ---------------------------------------------------------------------------
// resolveBookingOpenDate
// ---------------------------------------------------------------------------
describe('resolveBookingOpenDate', () => {
  it('returns this year when booking-open date is in the future', () => {
    // Season Nov 1, advance 30 days → booking opens Oct 2, 2026 (future)
    const result = resolveBookingOpenDate({ start: '11-01', end: '11-30', booking_advance_days: 30 });
    expect(fmtDate(result)).toBe('20261002');
  });

  it('rolls to next year when booking-open date has already passed this year', () => {
    // Season May 1, advance 180 days → booking opens ~Nov 2, 2025 (past)
    // Next candidate: May 1, 2027 - 180 = Nov 2, 2026 (future)
    const result = resolveBookingOpenDate({ start: '05-01', end: '10-31', booking_advance_days: 180 });
    expect(fmtDate(result)).toBe('20261102');
  });

  it('returns season start when booking_advance_days is 0', () => {
    // Season Aug 1, no advance → booking opens Aug 1, 2026 (future)
    const result = resolveBookingOpenDate({ start: '08-01', end: '10-31', booking_advance_days: 0 });
    expect(fmtDate(result)).toBe('20260801');
  });

  it('returns season start when booking_advance_days is null', () => {
    const result = resolveBookingOpenDate({ start: '08-01', end: '10-31', booking_advance_days: null });
    expect(fmtDate(result)).toBe('20260801');
  });

  it('returns today when booking-open date is exactly today', () => {
    // Season Sept 3, advance 80 days → Sept 3 - 80 = June 15, 2026 = today
    const result = resolveBookingOpenDate({ start: '09-03', end: '10-31', booking_advance_days: 80 });
    expect(fmtDate(result)).toBe('20260615');
  });

  it('rolls to next year for a year-round campsite with advance days already passed', () => {
    // Season Jan 1, advance 90 days → Oct 3, 2025 (past) → Oct 3, 2026 (future)
    const result = resolveBookingOpenDate({ start: '01-01', end: '12-31', booking_advance_days: 90 });
    expect(fmtDate(result)).toBe('20261003');
  });
});

// ---------------------------------------------------------------------------
// buildCalendarUrl
// ---------------------------------------------------------------------------
describe('buildCalendarUrl', () => {
  const campsite = { name: 'Rainier Base Camp', agency: 'National Park Service', official_url: null };

  it('uses www.google.com/calendar/render', () => {
    const url = buildCalendarUrl(campsite, { start: '11-01', end: '11-30', booking_advance_days: 30 });
    expect(url).toMatch(/^https:\/\/www\.google\.com\/calendar\/render/);
  });

  it('encodes dates as YYYYMMDD/YYYYMMDD+1', () => {
    // Booking opens Oct 2, 2026 → end date Oct 3, 2026
    const url = buildCalendarUrl(campsite, { start: '11-01', end: '11-30', booking_advance_days: 30 });
    expect(url).toContain('dates=20261002/20261003');
  });

  it('sets title to "Book X (reservations open)" when advance days > 0', () => {
    const url = buildCalendarUrl(campsite, { start: '11-01', end: '11-30', booking_advance_days: 30 });
    expect(url).toContain(encodeURIComponent('Book Rainier Base Camp (reservations open)'));
  });

  it('sets title to "X season opens" when no advance days', () => {
    const url = buildCalendarUrl(campsite, { start: '08-01', end: '10-31', booking_advance_days: 0 });
    expect(url).toContain(encodeURIComponent('Rainier Base Camp season opens'));
  });

  it('includes official_url in details when present', () => {
    const cs = { ...campsite, official_url: 'https://example.com' };
    const url = buildCalendarUrl(cs, { start: '11-01', end: '11-30', booking_advance_days: 30 });
    expect(decodeURIComponent(url)).toContain('Info: https://example.com');
  });

  it('omits Info line when official_url is null', () => {
    const url = buildCalendarUrl(campsite, { start: '11-01', end: '11-30', booking_advance_days: 30 });
    expect(decodeURIComponent(url)).not.toContain('Info:');
  });

  it('mentions advance days count in details', () => {
    const url = buildCalendarUrl(campsite, { start: '11-01', end: '11-30', booking_advance_days: 30 });
    expect(decodeURIComponent(url)).toContain('30 days before');
  });
});
