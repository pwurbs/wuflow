package backend

import (
	"net"
	"net/http"
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

// resetOnSuccess clears failure counters for the given IP and email.
func (rl *rateLimiter) resetOnSuccess(ip, email string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	delete(rl.byIP, ip)
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

// remoteIP extracts the host portion of r.RemoteAddr.
// Consistent with the WithLogging middleware in server.go.
func remoteIP(r *http.Request) string {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}
