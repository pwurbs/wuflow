package backend

import (
	"net/netip"
	"sync"
	"time"
)

const (
	ipMaxFailures    = 20
	emailMaxFailures = 10
	ipWindow         = 15 * time.Minute
	emailWindow      = 15 * time.Minute
	rlCleanupEvery   = 500       // run lazy cleanup every N recordFailure calls
	rlMaxAge         = time.Hour // evict entries this long after their window ends

	apiMaxRequests  = 60          // max requests per authenticated user per window
	apiRateWindow   = time.Minute // sliding window for API rate limiting
	apiCleanupEvery = 200         // run lazy cleanup every N allow() calls

	refreshIPMax    = 10          // max refresh attempts per IP per window
	refreshIPWindow = time.Minute // sliding window for refresh rate limiting

	// An IPv6 client usually controls a whole /64, so the per-IP limits count
	// per /64 instead of per address.
	ipv6LimitPrefix = 64
)

// limiterKey returns the per-IP rate-limit key for a client IP: IPv4 as is,
// IPv6 masked to its /64. Unparsable input is returned unchanged. Logs keep
// the full IP; only the limiters use this key.
func limiterKey(ip string) string {
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return ip
	}
	addr = addr.Unmap()
	if addr.Is4() {
		return addr.String()
	}
	prefix, err := addr.Prefix(ipv6LimitPrefix)
	if err != nil {
		return ip
	}
	return prefix.String()
}

type failEntry struct {
	count     int
	windowEnd time.Time
}

type rateLimiter struct {
	mu           sync.Mutex
	byIP         map[string]*failEntry
	byIPAndEmail map[string]*failEntry
	calls        int
}

var loginLimiter = &rateLimiter{
	byIP:         make(map[string]*failEntry),
	byIPAndEmail: make(map[string]*failEntry),
}

// keyedLimiter is a generic per-key sliding-window rate limiter, shared by the
// per-authenticated-user and per-IP limiters below. It is intentionally
// separate from rateLimiter to keep the two threat models (brute-force login
// vs. authenticated API abuse / unauthenticated endpoint abuse) decoupled.
type keyedLimiter[K comparable] struct {
	mu           sync.Mutex
	counts       map[K]*failEntry
	calls        int
	max          int
	window       time.Duration
	cleanupEvery int
}

func newKeyedLimiter[K comparable](limit int, window time.Duration, cleanupEvery int) *keyedLimiter[K] {
	return &keyedLimiter[K]{counts: make(map[K]*failEntry), max: limit, window: window, cleanupEvery: cleanupEvery}
}

var apiLimiter = newKeyedLimiter[int](apiMaxRequests, apiRateWindow, apiCleanupEvery)

// allow records one attempt for key and returns true if it is within the
// limiter's rate limit, false if it has exceeded it.
func (rl *keyedLimiter[K]) allow(key K) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	e, ok := rl.counts[key]
	if !ok || now.After(e.windowEnd) {
		rl.counts[key] = &failEntry{count: 1, windowEnd: now.Add(rl.window)}
		rl.recordCall()
		return true
	}
	e.count++
	rl.recordCall()
	return e.count <= rl.max
}

// recordCall increments the call counter and triggers lazy cleanup.
// Must be called with rl.mu held.
func (rl *keyedLimiter[K]) recordCall() {
	rl.calls++
	if rl.calls%rl.cleanupEvery == 0 {
		rl.cleanup()
	}
}

// cleanup removes entries whose window ended more than rlMaxAge ago.
// Must be called with rl.mu held.
func (rl *keyedLimiter[K]) cleanup() {
	cutoff := time.Now().Add(-rlMaxAge)
	for k, e := range rl.counts {
		if e.windowEnd.Before(cutoff) {
			delete(rl.counts, k)
		}
	}
}

// isBlocked returns true if the key has reached limit failures within window.
// If the window has expired, the entry is reset and false is returned.
// Must be called with rl.mu held.
func (rl *rateLimiter) isBlocked(m map[string]*failEntry, key string, limit int) bool {
	e, ok := m[key]
	if !ok {
		return false
	}
	if time.Now().After(e.windowEnd) {
		delete(m, key)
		return false
	}
	return e.count >= limit
}

// checkIP reports whether the IP is currently rate-limited.
func (rl *rateLimiter) checkIP(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	return rl.isBlocked(rl.byIP, ip, ipMaxFailures)
}

// checkIPAndEmail reports whether the IP+Email combination is currently rate-limited.
func (rl *rateLimiter) checkIPAndEmail(ip, email string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	key := ip + "|" + email
	return rl.isBlocked(rl.byIPAndEmail, key, emailMaxFailures)
}

// recordFailure increments failure counters for the given IP and email.
func (rl *rateLimiter) recordFailure(ip, email string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	record := func(m map[string]*failEntry, key string, window time.Duration) {
		e, ok := m[key]
		if !ok || now.After(e.windowEnd) {
			m[key] = &failEntry{count: 1, windowEnd: now.Add(window)}
		} else {
			e.count++
		}
	}
	record(rl.byIP, ip, ipWindow)
	record(rl.byIPAndEmail, ip+"|"+email, emailWindow)

	rl.calls++
	if rl.calls%rlCleanupEvery == 0 {
		rl.cleanup()
	}
}

// resetOnSuccess clears the per-IP+Email failure counter on a successful login.
// The global per-IP counter is intentionally left intact so that an attacker
// cannot reset IP-wide throttling by authenticating with a sacrificial account.
func (rl *rateLimiter) resetOnSuccess(ip, email string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	delete(rl.byIPAndEmail, ip+"|"+email)
}

// cleanup removes stale entries. Must be called with rl.mu held.
func (rl *rateLimiter) cleanup() {
	cutoff := time.Now().Add(-rlMaxAge)
	for k, e := range rl.byIP {
		if e.windowEnd.Before(cutoff) {
			delete(rl.byIP, k)
		}
	}
	for k, e := range rl.byIPAndEmail {
		if e.windowEnd.Before(cutoff) {
			delete(rl.byIPAndEmail, k)
		}
	}
}

// refreshLimiter is a per-IP sliding-window rate limiter used for
// unauthenticated endpoints where only the IP is known (e.g. token refresh).
var refreshLimiter = newKeyedLimiter[string](refreshIPMax, refreshIPWindow, rlCleanupEvery)
