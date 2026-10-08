/** Marketplace mode is independent of the build/runtime NODE_ENV. Production is the default. */
export function appEnvironment() { return process.env.APP_ENV === 'demo' ? 'demo' : process.env.APP_ENV === 'development' ? 'development' : 'production'; }
export function isProductionMarketplace() { return appEnvironment() === 'production'; }
export function isDemoMarketplace() { return appEnvironment() === 'demo'; }
export function allowSimulation() { return !isProductionMarketplace() && process.env.MONITOR_ALLOW_SIMULATION === 'true'; }
export function publicData() { return isDemoMarketplace() ? {} : { isDemo: false }; }
export function publicPrograms() { return { ...publicData(), catalogActive: true }; }
export function activeAccount(user: { isSuspended: boolean; accountStatus?: string; isDemo?: boolean }) { return !user.isSuspended && (!user.accountStatus || user.accountStatus === 'ACTIVE') && (!isProductionMarketplace() || !user.isDemo); }
export function assertMarketplaceAccount(user: { isSuspended: boolean; accountStatus?: string; isDemo?: boolean; emailVerified?: boolean; role?: string }) {
 if (!activeAccount(user)) throw new Error('Marketplace activity is unavailable for this account.');
 if (!user.emailVerified) throw new Error('Verify your email in account settings before using marketplace actions.');
}
