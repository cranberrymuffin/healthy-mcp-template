// update_settings: the user's time zone. "Today" and every logged date follow the time zone. Daily target metrics are in services/dailyTargetMetrics.ts.
import { setTimeZone, type UserId } from "../data";
import { isValidTimeZone } from "../time";
import { fail, userTimeZone } from "./common";

export interface UpdateSettingsInput { time_zone?: string }

export async function updateSettings(db: D1Database, userId: UserId, input: UpdateSettingsInput) {
	if (input.time_zone === undefined) throw fail("Send a time_zone.", "time_zone");
	if (!isValidTimeZone(input.time_zone)) throw fail("time_zone must be an IANA name such as America/Chicago or Europe/London.", "time_zone");
	await setTimeZone(db, userId, input.time_zone);
	return { time_zone: await userTimeZone(db, userId) };
}
