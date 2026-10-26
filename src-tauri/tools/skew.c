// A wall clock the live harness moves, for the clock-skew scenario (F6).
// SHARDX_SKEW_FILE names a file holding whole seconds to add to the wall
// clock; the harness rewrites it while the run goes on. The monotonic clock is
// left alone: the launcher measures how long a permission has left by it.
//
// Test tooling, never shipped. Build it before a run with the clock cases:
//
//   cc -dynamiclib -o /tmp/skew.dylib src-tauri/tools/skew.c
//   SHARDX_LIVE_SKEW=/tmp/skew.dylib SHARDX_LIVE_SET=F cargo test --lib live_e2e::run -- --ignored --nocapture

#include <stdio.h>
#include <stdlib.h>
#include <sys/time.h>
#include <time.h>

/// Read afresh every call: the harness moves the clock between calls.
static long skew(void) {
    const char *path = getenv("SHARDX_SKEW_FILE");
    if (!path) {
        return 0;
    }
    FILE *f = fopen(path, "r");
    if (!f) {
        return 0;
    }
    long seconds = 0;
    if (fscanf(f, "%ld", &seconds) != 1) {
        seconds = 0;
    }
    fclose(f);
    return seconds;
}

// A call made here is not interposed, so these reach the real clock.
static int shim_gettimeofday(struct timeval *tv, void *tz) {
    int r = gettimeofday(tv, (struct timezone *)tz);
    if (r == 0 && tv) {
        tv->tv_sec += skew();
    }
    return r;
}

static int shim_clock_gettime(clockid_t id, struct timespec *ts) {
    int r = clock_gettime(id, ts);
    if (r == 0 && ts && (id == CLOCK_REALTIME)) {
        ts->tv_sec += skew();
    }
    return r;
}

static time_t shim_time(time_t *out) {
    time_t t = time(NULL);
    if (t != (time_t)-1) {
        t += skew();
    }
    if (out) {
        *out = t;
    }
    return t;
}

__attribute__((used)) static struct {
    const void *replacement;
    const void *replacee;
} interposers[] __attribute__((section("__DATA,__interpose"))) = {
    { (const void *)&shim_gettimeofday, (const void *)&gettimeofday },
    { (const void *)&shim_clock_gettime, (const void *)&clock_gettime },
    { (const void *)&shim_time, (const void *)&time },
};
