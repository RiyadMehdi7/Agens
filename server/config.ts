export function getConfig(env: NodeJS.ProcessEnv = process.env) {
  const liveModel = env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';
  const plannerModel = env.GEMINI_PLANNER_MODEL || 'gemini-3.8-flash';
  if (!['gemini-3.8-live', 'gemini-3.8-live-extended-thinking'].includes(liveModel)) {
    throw new Error('This project requires Gemini 3.8 Live.');
  }
  if (plannerModel !== 'gemini-3.8-flash') throw new Error('This project requires Gemini 3.8 Flash for planning.');
  const port = Number(env.PORT || 5190);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  return { liveModel, plannerModel, port, configured: Boolean(env.GEMINI_API_KEY?.trim()) };
}
