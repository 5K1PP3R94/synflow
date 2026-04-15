export const state = {
  user: null,
  jobs: [],
  advisors: [],
  meta: null,
  currentView: 'dashboard'
};

export function setUser(user) { state.user = user; }
export function setJobs(jobs) { state.jobs = jobs; }
export function setAdvisors(advisors) { state.advisors = advisors; }
export function setMeta(meta) { state.meta = meta; }
export function setCurrentView(view) { state.currentView = view; }
