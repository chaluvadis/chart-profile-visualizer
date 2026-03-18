/**
 * Simple in-memory cache with TTL support
 */
export class Cache<T> {
	private cache = new Map<string, { value: T; expiry: number }>();

	/**
	 * Get a value from cache if it exists and hasn't expired
	 */
	get(key: string): T | undefined {
		const entry = this.cache.get(key);
		if (!entry) return undefined;

		if (Date.now() > entry.expiry) {
			this.cache.delete(key);
			return undefined;
		}

		return entry.value;
	}

	/**
	 * Set a value in cache with TTL (in milliseconds)
	 */
	set(key: string, value: T, ttlMs: number): void {
		this.cache.set(key, {
			value,
			expiry: Date.now() + ttlMs,
		});
	}

	/**
	 * Get or set a value - computes value if not in cache
	 */
	async getOrSet(key: string, ttlMs: number, factory: () => Promise<T> | T): Promise<T> {
		const cached = this.get(key);
		if (cached !== undefined) {
			return cached;
		}

		const value = await factory();
		this.set(key, value, ttlMs);
		return value;
	}

	/**
	 * Clear all cached entries
	 */
	clear(): void {
		this.cache.clear();
	}

	/**
	 * Delete a specific entry
	 */
	delete(key: string): void {
		this.cache.delete(key);
	}

	/**
	 * Clean up all expired entries from cache
	 * Call this periodically to prevent memory leaks
	 */
	cleanup(): void {
		const now = Date.now();
		for (const [key, entry] of this.cache.entries()) {
			if (now > entry.expiry) {
				this.cache.delete(key);
			}
		}
	}
}

/**
 * Create a new cache instance
 */
export function createCache<T>(): Cache<T> {
	return new Cache<T>();
}
