package backend

import (
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

	refreshIPMax    = 10           // max refresh attempts per IP per window
	refreshIPWindow = time.Minute  // sliding window for refresh rate limiting
)

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

// requestLimiter counts requests per authenticated user.
// It is intentionally separate from rateLimiter to keep the two threat models
// (brute-force login vs. authenticated API abuse) decoupled.
type requestLimiter struct {
	mu     sync.Mutex
	byUser map[int]*failEntry // keyed by user ID
	calls  int
}

var apiLimiter = &requestLimiter{
	byUser: make(map[int]*failEntry),
}

// allow records one write request for userID and returns true if the user is
// within their rate limit, false if they have exceeded it.
func (rl *requestLimiter) allow(userID int) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	e, ok := rl.byUser[userID]
	if !ok || now.After(e.windowEnd) {
		rl.byUser[userID] = &failEntry{count: 1, windowEnd: now.Add(apiRateWindow)}
		rl.recordCall()
		return true
	}
	e.count++
	rl.recordCall()
	return e.count <= apiMaxRequests
}

// recordCall increments the call counter and triggers lazy cleanup.
// Must be called with rl.mu held.
func (rl *requestLimiter) recordCall() {
	rl.calls++
	if rl.calls%apiCleanupEvery == 0 {
		rl.cleanup()
	}
}

// cleanup removes entries whose window ended more than rlMaxAge ago.
// Must be called with rl.mu held.
func (rl *requestLimiter) cleanup() {
	cutoff := time.Now().Add(-rlMaxAge)
	for k, e := range rl.byUser {
		if e.windowEnd.Before(cutoff) {
			delete(rl.byUser, k)
		}
	}
}

// isBlocked returns true if the key has exceeded max failures within window.
// If the window has expired, the entry is reset and false is returned.
// Must be called with rl.mu held.
func (rl *rateLimiter) isBlocked(m map[string]*failEntry, key string, max int) bool {
	e, ok := m[key]
	if !ok {
		return false
	}
	if time.Now().After(e.windowEnd) {
		delete(m, key)
		return false
	}
	return e.count >= max
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

// ipLimiter is a per-IP sliding-window rate limiter.
// Used for unauthenticated endpoints where only the IP is known (e.g. token refresh).
type ipLimiter struct {
	mu    sync.Mutex
	byIP  map[string]*failEntry
	calls int
}

var refreshLimiter = &ipLimiter{byIP: make(map[string]*failEntry)}

// allow records one attempt for ip and returns true if the IP is within the limit.
func (rl *ipLimiter) allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	e, ok := rl.byIP[ip]
	if !ok || now.After(e.windowEnd) {
		rl.byIP[ip] = &failEntry{count: 1, windowEnd: now.Add(refreshIPWindow)}
	} else {
		e.count++
	}

	rl.calls++
	if rl.calls%rlCleanupEvery == 0 {
		rl.cleanup()
	}

	return rl.byIP[ip].count <= refreshIPMax
}

// cleanup removes stale entries. Must be called with rl.mu held.
func (rl *ipLimiter) cleanup() {
	cutoff := time.Now().Add(-rlMaxAge)
	for k, e := range rl.byIP {
		if e.windowEnd.Before(cutoff) {
			delete(rl.byIP, k)
		}
	}
}
