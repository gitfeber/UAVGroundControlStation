/** Injected at build time from the monorepo root package.json version. */
export function appVersion(): string {
  const raw = import.meta.env.VITE_APP_VERSION;
  return typeof raw === "string" && raw.length > 0 ? raw : "dev";
}

export function appVersionLabel(): string {
  return `v${appVersion()}`;
}
