// Returns a "MMM D" label from a "MM-DD" string, e.g. "05-01" → "May 1"
export function formatWindowDate(mmdd) {
  const [month, day] = mmdd.split('-').map(Number);
  return new Date(2000, month - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Returns a YYYYMMDD string from a Date object
export function fmtDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// Returns the next upcoming booking-open date for a window:
// season_start - booking_advance_days. If advance days is 0/null, uses season start.
export function resolveBookingOpenDate(w) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [startMonth, startDay] = w.start.split('-').map(Number);
  const advance = w.booking_advance_days || 0;

  for (let year = today.getFullYear(); year <= today.getFullYear() + 1; year++) {
    const seasonStart = new Date(year, startMonth - 1, startDay);
    const bookingOpen = new Date(seasonStart);
    bookingOpen.setDate(bookingOpen.getDate() - advance);
    if (bookingOpen >= today) return bookingOpen;
  }
  // Fallback: next year
  const seasonStart = new Date(today.getFullYear() + 1, startMonth - 1, startDay);
  const bookingOpen = new Date(seasonStart);
  bookingOpen.setDate(bookingOpen.getDate() - advance);
  return bookingOpen;
}

export function buildCalendarUrl(campsite, w) {
  const bookingOpen = resolveBookingOpenDate(w);
  const nextDay = new Date(bookingOpen);
  nextDay.setDate(nextDay.getDate() + 1);

  const hasAdvance = w.booking_advance_days > 0;
  const title = hasAdvance
    ? `Book ${campsite.name} (reservations open)`
    : `${campsite.name} season opens`;
  const seasonRange = w.start === '01-01' && w.end === '12-31'
    ? 'year-round'
    : `${formatWindowDate(w.start)} \u2013 ${formatWindowDate(w.end)}`;
  const details = [
    hasAdvance
      ? `Reservations open today \u2014 ${w.booking_advance_days} days before the ${seasonRange} season.`
      : `${campsite.name} opens for the ${seasonRange} season.`,
    campsite.official_url ? `Info: ${campsite.official_url}` : '',
  ].filter(Boolean).join('\n');

  return `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${fmtDate(bookingOpen)}/${fmtDate(nextDay)}&details=${encodeURIComponent(details)}`;
}

export function generateWindowICS(campsite, w) {
  const bookingOpen = resolveBookingOpenDate(w);
  const nextDay = new Date(bookingOpen);
  nextDay.setDate(nextDay.getDate() + 1);

  const hasAdvance = w.booking_advance_days > 0;
  const summary = hasAdvance
    ? `Book ${campsite.name} (reservations open)`
    : `${campsite.name} season opens`;
  const seasonRange = w.start === '01-01' && w.end === '12-31'
    ? 'year-round'
    : `${formatWindowDate(w.start)} \u2013 ${formatWindowDate(w.end)}`;
  const desc = (hasAdvance
    ? `Reservations open today \u2014 ${w.booking_advance_days} days before the ${seasonRange} season.`
    : `${campsite.name} opens for the ${seasonRange} season.`
  ).replace(/,/g, '\\,');

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    `DTSTART;VALUE=DATE:${fmtDate(bookingOpen)}`,
    `DTEND;VALUE=DATE:${fmtDate(nextDay)}`,
    `SUMMARY:${summary.replace(/,/g, '\\,')}`,
    `DESCRIPTION:${desc}`,
    campsite.official_url ? `URL:${campsite.official_url}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `${campsite.name.replace(/\s+/g, '-').toLowerCase()}-booking.ics`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
