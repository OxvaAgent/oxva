// Every four hours on the published site: make a new batch of calls and grade the open ones.
// (Deploy previews do not run schedules; /api/calls makes calls on demand there.)
import { loadCalls } from "../../lib/calls-store.mjs";

export default async (req, context) => {
  const doc = await loadCalls(context, { force: true });
  console.log(`calls cycle: ${doc.calls.length} calls stored, errors: ${JSON.stringify(doc.errors || [])}`);
};

export const config = { schedule: "5 */4 * * *" };
