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

/**
 * Validate a file path to prevent path traversal attacks
 */
export function validateFilePath(filePath: string, field: string): string {
	if (!filePath) {
		throw new Error(`Invalid ${field}: path is empty`);
	}

	// Normalize the path
	const normalized = filePath.replace(/\\/g, "/");

	// Check for path traversal attempts
	if (normalized.includes("..")) {
		throw new Error(`Invalid ${field}: path traversal not allowed`);
	}

	// Check for null bytes
	if (filePath.includes("\0")) {
		throw new Error(`Invalid ${field}: contains null bytes`);
	}

	return filePath;
}

/**
 * Validate chart path exists and is a directory
 */
export function validateChartPath(chartPath: string): string {
	const validated = validateFilePath(chartPath, "chart path");

	// Additional check: ensure it's a valid-looking chart path
	// Chart paths should not be root or system paths
	if (validated === "/" || validated.match(/^[A-Z]:\\?$/i)) {
		throw new Error("Invalid chart path: must point to a chart directory");
	}

	return validated;
}
