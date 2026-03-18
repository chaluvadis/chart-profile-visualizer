/**
 * Validate identifiers passed to CLI tools.
 * Keep this conservative to reject shell metacharacters and control chars.
 */
export function validateCliIdentifier(value: string, field: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		throw new Error(`Invalid ${field}: value is empty`);
	}

	// Reject flag-like values that start with '-' to prevent option injection
	if (trimmed.startsWith("-")) {
		throw new Error(`Invalid ${field}: must not start with '-'`);
	}

	// K8s/Helm identifiers are DNS-like and should not contain shell metacharacters.
	if (!/^[a-zA-Z0-9._:@/-]+$/.test(trimmed)) {
		throw new Error(`Invalid ${field}: contains unsafe characters`);
	}

	return trimmed;
}
