/**
 * Pure logic for first-run walkthrough state management.
 * Isolated from vscode APIs so it can be unit-tested independently.
 */

export const FIRST_RUN_STATE_KEY = "chartProfilesFirstRunComplete";
export const WALKTHROUGH_ENABLED_SETTING = "chartProfiles.showWalkthroughOnFirstRun";
export const QUICK_START_URL =
	"https://github.com/chaluvadis/chart-profile-visualizer#readme";

/**
 * Determines whether the first-run walkthrough should be displayed.
 *
 * @param hasCompletedBefore - True when the globalState flag has already been set.
 * @param configEnabled - The value of the `chartProfiles.showWalkthroughOnFirstRun`
 *                        configuration setting (undefined / null is treated as enabled).
 */
export function shouldShowWalkthrough(hasCompletedBefore: boolean, configEnabled: unknown): boolean {
	if (configEnabled === false) {
		return false;
	}
	return !hasCompletedBefore;
}
