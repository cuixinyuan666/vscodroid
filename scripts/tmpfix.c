#define _GNU_SOURCE
#include <dlfcn.h>
#include <fcntl.h>
#include <malloc.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

#include <android/dlext.h>

/*
 * LD_PRELOAD helper for the bundled OpenCode CLI.
 *
 * Three jobs, all measured on device:
 *
 *   1. Bun still opens /tmp for a few paths even after the JS graph is pointed
 *      at HOME. Android's /tmp is not writable to an unprivileged app, so those
 *      opens fail and the CLI dies. Rewrite /tmp/... to $TMPDIR/... when
 *      TMPDIR is set.
 *
 *   2. OpenTUI's renderer is a real .so. Bun still dlopens the copy it extracted
 *      from /$bunfs/ into $TMPDIR/.*.so (~9.7 MiB ELF). That path is app data,
 *      which untrusted_app cannot map executable. OPENTUI_LIB_PATH names the
 *      copy in nativeLibraryDir, which is executable. Redirect those dlopens.
 *
 *   3. Bun/JSC NaN-boxes by zeroing the top pointer byte. Bionic software TBI
 *      tags that byte, and free() aborts with "Pointer tag ... was truncated".
 *      The original Guysoft wrapper preloaded libtagfix.so for this; do the
 *      same mallopt here, in this process, before JSC touches the heap.
 */

static const char *rewrite(const char *path, char *buf, size_t n) {
    if (!path) return path;
    if (strncmp(path, "/tmp", 4) != 0) return path;
    if (path[4] != '\0' && path[4] != '/') return path;
    const char *base = getenv("TMPDIR");
    if (!base || !base[0]) return path;
    size_t blen = strlen(base);
    while (blen && base[blen - 1] == '/') blen--;
    const char *rest = path + 4;
    if ((size_t)snprintf(buf, n, "%.*s%s", (int)blen, base, rest) >= n)
        return path;
    return buf;
}

__attribute__((constructor(101)))
static void disable_heap_tagging(void) {
    mallopt(M_BIONIC_SET_HEAP_TAGGING_LEVEL, M_HEAP_TAGGING_LEVEL_NONE);
}

static int looks_like_opentui(const char *path) {
    if (!path || !path[0]) return 0;
    if (strstr(path, "libopentui") || strstr(path, "opentui-") || strstr(path, "/$bunfs/"))
        return 1;
    const char *tmp = getenv("TMPDIR");
    if (!tmp || !tmp[0]) return 0;
    size_t n = strlen(tmp);
    while (n && tmp[n - 1] == '/') n--;
    if (strncmp(path, tmp, n) != 0) return 0;
    if (path[n] != '/' && path[n] != '\0') return 0;
    if (!strstr(path, ".so")) return 0;
    struct stat st;
    if (stat(path, &st) != 0) return 0;
    /* Guysoft's Android OpenTUI ELF is 9795128 bytes before the 110KB overlay.
       Anything in that band is the renderer, not the 5.5MB sidecar extracts. */
    return st.st_size >= 8000000 && st.st_size <= 12000000;
}

static const char *rewrite_dl(const char *path) {
    const char *want = getenv("OPENTUI_LIB_PATH");
    if (!want || !want[0] || !path) return path;
    if (strcmp(path, want) == 0) return path;
    if (!looks_like_opentui(path)) return path;
    return want;
}

int mkdir(const char *path, mode_t mode) {
    char buf[512];
    path = rewrite(path, buf, sizeof buf);
    typedef int (*fn)(const char *, mode_t);
    static fn real;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "mkdir");
    if (!real) return (int)syscall(__NR_mkdirat, AT_FDCWD, path, mode);
    return real(path, mode);
}

int mkdirat(int dirfd, const char *path, mode_t mode) {
    char buf[512];
    if (path && path[0] == '/') path = rewrite(path, buf, sizeof buf);
    typedef int (*fn)(int, const char *, mode_t);
    static fn real;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "mkdirat");
    if (!real) return (int)syscall(__NR_mkdirat, dirfd, path, mode);
    return real(dirfd, path, mode);
}

int open(const char *path, int flags, ...) {
    mode_t mode = 0;
    if (flags & O_CREAT) {
        va_list ap;
        va_start(ap, flags);
        mode = (mode_t)va_arg(ap, int);
        va_end(ap);
    }
    char buf[512];
    path = rewrite(path, buf, sizeof buf);
    typedef int (*fn)(const char *, int, ...);
    static fn real;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "open");
    if (flags & O_CREAT) return real(path, flags, mode);
    return real(path, flags);
}

int openat(int dirfd, const char *path, int flags, ...) {
    mode_t mode = 0;
    if (flags & O_CREAT) {
        va_list ap;
        va_start(ap, flags);
        mode = (mode_t)va_arg(ap, int);
        va_end(ap);
    }
    char buf[512];
    if (path && path[0] == '/') path = rewrite(path, buf, sizeof buf);
    typedef int (*fn)(int, const char *, int, ...);
    static fn real;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "openat");
    if (flags & O_CREAT) return real(dirfd, path, flags, mode);
    return real(dirfd, path, flags);
}

int stat(const char *path, struct stat *st) {
    char buf[512];
    path = rewrite(path, buf, sizeof buf);
    typedef int (*fn)(const char *, struct stat *);
    static fn real;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "stat");
    if (!real) return (int)syscall(__NR_newfstatat, AT_FDCWD, path, st, 0);
    return real(path, st);
}

int fstatat(int dirfd, const char *path, struct stat *st, int flags) {
    char buf[512];
    if (path && path[0] == '/') path = rewrite(path, buf, sizeof buf);
    typedef int (*fn)(int, const char *, struct stat *, int);
    static fn real;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "fstatat");
    if (!real) return (int)syscall(__NR_newfstatat, dirfd, path, st, flags);
    return real(dirfd, path, st, flags);
}

int access(const char *path, int amode) {
    char buf[512];
    path = rewrite(path, buf, sizeof buf);
    typedef int (*fn)(const char *, int);
    static fn real;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "access");
    if (!real) return (int)syscall(__NR_faccessat, AT_FDCWD, path, amode);
    return real(path, amode);
}

int faccessat(int dirfd, const char *path, int amode, int flags) {
    char buf[512];
    if (path && path[0] == '/') path = rewrite(path, buf, sizeof buf);
    typedef int (*fn)(int, const char *, int, int);
    static fn real;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "faccessat");
    if (!real) return (int)syscall(__NR_faccessat, dirfd, path, amode);
    return real(dirfd, path, amode, flags);
}

int unlink(const char *path) {
    char buf[512];
    path = rewrite(path, buf, sizeof buf);
    typedef int (*fn)(const char *);
    static fn real;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "unlink");
    if (!real) return (int)syscall(__NR_unlinkat, AT_FDCWD, path, 0);
    return real(path);
}

int rmdir(const char *path) {
    char buf[512];
    path = rewrite(path, buf, sizeof buf);
    typedef int (*fn)(const char *);
    static fn real;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "rmdir");
    if (!real) return (int)syscall(__NR_unlinkat, AT_FDCWD, path, AT_REMOVEDIR);
    return real(path);
}

void *dlopen(const char *path, int flags) {
    path = rewrite_dl(path);
    typedef void *(*fn)(const char *, int);
    static fn real;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "dlopen");
    if (!real) return NULL;
    return real(path, flags);
}

void *android_dlopen_ext(const char *path, int flags, const android_dlextinfo *info) {
    path = rewrite_dl(path);
    typedef void *(*fn)(const char *, int, const android_dlextinfo *);
    static fn real;
    if (!real) real = (fn)dlsym(RTLD_NEXT, "android_dlopen_ext");
    if (!real) return NULL;
    return real(path, flags, info);
}
