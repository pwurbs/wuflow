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
	for i := 0; i < ipMaxFailures; i++ {
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
	for i := 0; i < emailMaxFailures; i++ {
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
	for i := 0; i < ipMaxFailures; i++ {
		rl.recordFailure(testIP1, testEmail1)
	}
	if !rl.checkIP(testIP1) {
		t.Fatal("expected IP to be blocked before reset")
	}
	rl.resetOnSuccess(testIP1, testEmail1)
	if rl.checkIP(testIP1) {
		t.Error("IP should not be blocked after resetOnSuccess")
	}
	if rl.checkIPAndEmail(testIP1, testEmail1) {
		t.Error("email should not be blocked after resetOnSuccess")
	}
}

func TestRateLimiterIndependentKeys(t *testing.T) {
	rl := newTestLimiter()
	// Exhaust IP testIP1 but not testIP2
	for i := 0; i < ipMaxFailures; i++ {
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
	for i := 0; i < emailMaxFailures; i++ {
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
