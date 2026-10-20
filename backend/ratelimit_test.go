package backend

import (
	"testing"
	"time"
)

const (
	testIP1    = "1.2.3.4"          //NOSONAR
	testIP2    = "5.6.7.8"          //NOSONAR
	testEmail1 = "user@example.com" //NOSONAR
	testEmail2 = "a@b.com"          //NOSONAR
	testEmail3 = "x@x.com"          //NOSONAR
)

func newTestLimiter() *rateLimiter {
	return &rateLimiter{
		byIP:         make(map[string]*failEntry),
		byIPAndEmail: make(map[string]*failEntry),
	}
}

func TestRateLimiterNotBlockedInitially(t *testing.T) {
	rl := newTestLimiter()
	if rl.checkIP(testIP1) {
		t.Error("fresh IP should not be blocked")
	}
	if rl.checkIPAndEmail(testIP1, testEmail1) {
		t.Error("fresh email should not be blocked")
	}
}

func TestRateLimiterIPBlockedAfterThreshold(t *testing.T) {
	rl := newTestLimiter()
	for i := range ipMaxFailures {
		if rl.checkIP(testIP1) {
			t.Fatalf("should not be blocked after %d failures (threshold is %d)", i, ipMaxFailures)
		}
		rl.recordFailure(testIP1, testEmail2)
	}
	if !rl.checkIP(testIP1) {
		t.Error("IP should be blocked after reaching threshold")
	}
}

func TestRateLimiterWindowExpiry(t *testing.T) {
	rl := newTestLimiter()
	// Pre-load an entry with an already-expired window.
	rl.byIP[testIP1] = &failEntry{count: ipMaxFailures, windowEnd: time.Now().Add(-time.Second)}
	if rl.checkIP(testIP1) {
		t.Error("expired window should not be blocked")
	}
}

func TestRateLimiterFlow(t *testing.T) {
	rl := newTestLimiter()

	// 1) Test email limits
	for i := range emailMaxFailures {
		if rl.checkIPAndEmail(testIP1, testEmail1) {
			t.Fatalf("blocked too early on IP+email at iteration %d", i)
		}
		rl.recordFailure(testIP1, testEmail1)
	}
	if !rl.checkIPAndEmail(testIP1, testEmail1) {
		t.Fatal("expected IP+email to be blocked")
	}
	// IP alone should not be blocked yet because ipMaxFailures > emailMaxFailures
	if rl.checkIP(testIP1) {
		t.Fatal("expected IP to NOT be blocked yet")
	}

	// 2) Keep failing to trigger IP block
	for i := emailMaxFailures; i < ipMaxFailures; i++ {
		rl.recordFailure(testIP1, testEmail1)
	}
	if !rl.checkIP(testIP1) {
		t.Fatal("expected IP to be blocked now")
	}
}

func TestRateLimiterResetOnSuccess(t *testing.T) {
	rl := newTestLimiter()
	for range ipMaxFailures {
		rl.recordFailure(testIP1, testEmail1)
	}
	if !rl.checkIP(testIP1) {
		t.Fatal("expected IP to be blocked before reset")
	}
	rl.resetOnSuccess(testIP1, testEmail1)
	// Global IP counter must survive a successful login so that an attacker
	// cannot reset IP-wide throttling by authenticating with a sacrificial account.
	if !rl.checkIP(testIP1) {
		t.Error("IP should remain blocked after resetOnSuccess (global counter must not be cleared)")
	}
	if rl.checkIPAndEmail(testIP1, testEmail1) {
		t.Error("IP+email counter should be cleared after resetOnSuccess")
	}
}

func TestRateLimiterIndependentKeys(t *testing.T) {
	rl := newTestLimiter()
	// Exhaust IP testIP1 but not testIP2
	for range ipMaxFailures {
		rl.recordFailure(testIP1, testEmail3)
	}
	if !rl.checkIP(testIP1) {
		t.Error(testIP1 + " should be blocked")
	}
	if rl.checkIP(testIP2) {
		t.Error(testIP2 + " should not be blocked")
	}
}

func TestRateLimiterNoDoS(t *testing.T) {
	rl := newTestLimiter()
	// Exhaust IP testIP1 for testEmail1
	for range emailMaxFailures {
		rl.recordFailure(testIP1, testEmail1)
	}
	if !rl.checkIPAndEmail(testIP1, testEmail1) {
		t.Error(testIP1 + "|" + testEmail1 + " should be blocked")
	}
	// A different IP trying the same email should not be blocked
	if rl.checkIPAndEmail(testIP2, testEmail1) {
		t.Error(testIP2 + "|" + testEmail1 + " should NOT be blocked")
	}
}

// --- keyedLimiter (apiLimiter) tests ---

func newTestRequestLimiter() *keyedLimiter[int] {
	return newKeyedLimiter[int](apiMaxRequests, apiRateWindow, apiCleanupEvery)
}

func TestRequestLimiterAllowsUnderLimit(t *testing.T) {
	rl := newTestRequestLimiter()
	for i := range apiMaxRequests {
		if !rl.allow(1) {
			t.Fatalf("should be allowed at request %d (limit %d)", i+1, apiMaxRequests)
		}
	}
}

func TestRequestLimiterBlocksAtLimit(t *testing.T) {
	rl := newTestRequestLimiter()
	for range apiMaxRequests {
		rl.allow(1)
	}
	if rl.allow(1) {
		t.Error("request beyond limit should be denied")
	}
}

func TestRequestLimiterWindowExpiry(t *testing.T) {
	rl := newTestRequestLimiter()
	rl.counts[1] = &failEntry{count: apiMaxRequests + 1, windowEnd: time.Now().Add(-time.Second)}
	if !rl.allow(1) {
		t.Error("expired window should reset counter and allow request")
	}
}

func TestRequestLimiterIndependentUsers(t *testing.T) {
	rl := newTestRequestLimiter()
	for range apiMaxRequests + 1 {
		rl.allow(1)
	}
	if !rl.allow(2) {
		t.Error("user 2 should not be blocked because user 1 hit the limit")
	}
}

func TestRequestLimiterCleanup(t *testing.T) {
	rl := newTestRequestLimiter()
	rl.counts[99] = &failEntry{count: 1, windowEnd: time.Now().Add(-(rlMaxAge + time.Second))}
	rl.mu.Lock()
	rl.cleanup()
	rl.mu.Unlock()
	if _, ok := rl.counts[99]; ok {
		t.Error("stale entry should have been evicted")
	}
}

func TestRequestLimiterCleanupPreservesActive(t *testing.T) {
	rl := newTestRequestLimiter()
	rl.counts[42] = &failEntry{count: 1, windowEnd: time.Now().Add(apiRateWindow)}
	rl.mu.Lock()
	rl.cleanup()
	rl.mu.Unlock()
	if _, ok := rl.counts[42]; !ok {
		t.Error("active entry should not be evicted")
	}
}

func TestRateLimiterCleanup(t *testing.T) {
	rl := newTestLimiter()
	// Insert a stale entry (window ended more than rlMaxAge ago).
	rl.byIP["stale"] = &failEntry{count: 1, windowEnd: time.Now().Add(-(rlMaxAge + time.Second))}
	rl.byIPAndEmail["stale|x@x.com"] = &failEntry{count: 1, windowEnd: time.Now().Add(-(rlMaxAge + time.Second))}

	rl.mu.Lock()
	rl.cleanup()
	rl.mu.Unlock()

	if _, ok := rl.byIP["stale"]; ok {
		t.Error("stale IP entry should have been cleaned up")
	}
	if _, ok := rl.byIPAndEmail["stale|x@x.com"]; ok {
		t.Error("stale email entry should have been cleaned up")
	}
}

func TestIPLimiterCleanupTriggered(t *testing.T) {
	rl := newKeyedLimiter[string](refreshIPMax, refreshIPWindow, rlCleanupEvery)

	// Pre-seed a stale entry (window ended more than rlMaxAge ago).
	rl.counts["stale"] = &failEntry{count: 1, windowEnd: time.Now().Add(-(rlMaxAge + time.Second))}
	// Pre-seed a fresh entry that must survive cleanup.
	rl.counts["fresh"] = &failEntry{count: 1, windowEnd: time.Now().Add(refreshIPWindow)}
	// Set calls so the next allow() call is the rlCleanupEvery-th, triggering cleanup.
	rl.calls = rlCleanupEvery - 1

	rl.allow("trigger")

	if _, ok := rl.counts["stale"]; ok {
		t.Error("stale entry should have been removed by refreshLimiter cleanup")
	}
	if _, ok := rl.counts["fresh"]; !ok {
		t.Error("fresh entry should not have been removed by refreshLimiter cleanup")
	}
}

func TestRateLimiterCleanupPreservesActiveEntries(t *testing.T) {
	rl := newTestLimiter()
	rl.byIP["active"] = &failEntry{count: 1, windowEnd: time.Now().Add(ipWindow)}

	rl.mu.Lock()
	rl.cleanup()
	rl.mu.Unlock()

	if _, ok := rl.byIP["active"]; !ok {
		t.Error("active entry should not have been cleaned up")
	}
}

// The per-IP limiters count IPv6 clients per /64 themselves, so callers can
// pass the full client IP.
func TestRateLimiterCountsIPv6Per64(t *testing.T) {
	const addrA, addrB, otherNet = "2001:db8::a", "2001:db8::b", "2001:db8:0:1::a" //NOSONAR - documentation range
	rl := newTestLimiter()
	for range emailMaxFailures {
		rl.recordFailure(addrA, testEmail1)
	}
	if !rl.checkIPAndEmail(addrB, testEmail1) {
		t.Error("another address in the same /64 should share the IP+email limit")
	}
	if rl.checkIPAndEmail(otherNet, testEmail1) {
		t.Error("an address in another /64 should have its own IP+email limit")
	}
	rl.resetOnSuccess(addrB, testEmail1)
	if rl.checkIPAndEmail(addrA, testEmail1) {
		t.Error("a success from the same /64 should reset the IP+email limit")
	}

	for range ipMaxFailures {
		rl.recordFailure(addrA, testEmail2)
	}
	if !rl.checkIP(addrB) {
		t.Error("another address in the same /64 should share the IP limit")
	}
	if rl.checkIP(otherNet) {
		t.Error("an address in another /64 should have its own IP limit")
	}
}

func TestIPLimiterCountsIPv6Per64(t *testing.T) {
	const addrA, addrB, otherNet = "2001:db8::a", "2001:db8::b", "2001:db8:0:1::a" //NOSONAR - documentation range
	l := ipLimiter{newKeyedLimiter[string](1, time.Minute, rlCleanupEvery)}
	if !l.allow(addrA) {
		t.Fatal("first request should be allowed")
	}
	if l.allow(addrB) {
		t.Error("another address in the same /64 should share the limit")
	}
	if !l.allow(otherNet) {
		t.Error("an address in another /64 should have its own limit")
	}
}

func TestLimiterKey(t *testing.T) {
	tests := []struct {
		name string
		ip   string
		want string
	}{
		{"IPv4 unchanged", testIP1, testIP1},
		{"IPv6 masked to /64", "2001:db8:1:2:aaaa:bbbb:cccc:dddd", "2001:db8:1:2::/64"},
		{"IPv6 other address in same /64", "2001:db8:1:2::1", "2001:db8:1:2::/64"},
		{"IPv6 other /64", "2001:db8:1:3::1", "2001:db8:1:3::/64"},
		{"IPv4-mapped IPv6 as IPv4", "::ffff:192.0.2.1", "192.0.2.1"},
		{"zone dropped", "fe80::1%eth0", "fe80::/64"},
		{"unparsable unchanged", "not-an-ip", "not-an-ip"},
		{"empty unchanged", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := limiterKey(tt.ip); got != tt.want {
				t.Errorf("limiterKey(%q) = %q, want %q", tt.ip, got, tt.want)
			}
		})
	}
}
