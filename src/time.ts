// Time zone helpers. A log's `date` is the user's LOCAL calendar day, derived from `eaten_at`.

export function isValidTimeZone(tz: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

export function isValidDate(s: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
	const d = new Date(`${s}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

/** The local calendar day (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(instant: Date, tz: string): string {
	return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

function offsetMs(tz: string, utcMs: number): number {
	const p = Object.fromEntries(
		new Intl.DateTimeFormat("en-US", {
			timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
			hour: "2-digit", minute: "2-digit", second: "2-digit",
		}).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]),
	);
	const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
	return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant at which the wall clock in `tz` reads `date` `hour`:`minute`. */
export function localToUtc(date: string, hour: number, minute: number, tz: string): Date {
	const [y, m, d] = date.split("-").map(Number);
	const guess = Date.UTC(y, m - 1, d, hour, minute);
	const first = guess - offsetMs(tz, guess);
	return new Date(guess - offsetMs(tz, first));
}

/** Noon on a local day, as an ISO UTC string. Used when a log has a date but no time. */
export const localNoonUtc = (date: string, tz: string) => localToUtc(date, 12, 0, tz).toISOString();

/** The day n days after (or before, if negative) a YYYY-MM-DD day. */
export function addDays(date: string, n: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}

/** The Monday of the week a day is in. Weeks run Monday to Sunday. */
export function mondayOf(date: string): string {
	return addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
}

/** The first day of the month a day is in, moved by `months` (negative goes back). */
export function monthStart(date: string, months = 0): string {
	const [y, m] = date.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 10);
}

/** The last day of the month a day is in. */
export const monthEnd = (date: string) => addDays(monthStart(date, 1), -1);

/** The hour (0 to 23) on the wall clock in `tz` at an instant. */
export function localHour(instant: Date, tz: string): number {
	return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "2-digit" }).format(instant));
}

/** An instant as ISO 8601 on the wall clock in `tz`, with its offset, for example 2026-03-14T08:30:00-05:00. */
export function localIso(instant: Date, tz: string): string {
	const off = offsetMs(tz, instant.getTime());
	const sign = off < 0 ? "-" : "+";
	const mins = Math.abs(off) / 60000;
	const hh = String(Math.floor(mins / 60)).padStart(2, "0");
	const mm = String(mins % 60).padStart(2, "0");
	return `${new Date(instant.getTime() + off).toISOString().slice(0, 19)}${sign}${hh}:${mm}`;
}
