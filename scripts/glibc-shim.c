/*
 * Bionic-side implementations of the glibc symbols prebuilt Linux addons expect.
 *
 * Some Node addons ship only a linux-arm64 build compiled against glibc. The
 * machine code is fine on Android -- same ISA, same calling convention -- but
 * the dynamic linker refuses them, because their DT_NEEDED names (libc.so.6,
 * libdl.so.2, ...) do not exist here and a handful of the symbols they import
 * are glibc's rather than POSIX's.
 *
 * Bionic already provides the overwhelming majority: memcpy, pthread_*, the
 * stdio family, everything ordinary. What is missing splits into three kinds,
 * and all three are small:
 *
 *   - renamed internals: __errno_location, __environ, __assert_fail
 *   - the stat family, which glibc exports as versioned __xstat wrappers
 *     carrying a struct version glibc uses and Bionic does not
 *   - a few glibc-only conveniences: gnu_get_libc_version, __res_init
 *
 * Built into libglibc-shim.so, which the stub libc.so.6 and friends depend on;
 * see build-glibc-shim.sh. Nothing here is clever, and that is the point -- each
 * function is the Bionic call the glibc name was always standing in for.
 */

#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

/* glibc keeps errno behind a function; Bionic exposes __errno(). */
int *__errno_location(void) { return __errno(); }

/*
 * The environment, under all three names glibc exports.
 *
 * Bionic keeps `environ` internal to libc rather than exporting it for other
 * shared objects to bind against, so a glibc addon that reads it fails to link
 * even though the data is right there. These are re-exported copies, filled from
 * getenv's view at load time.
 *
 * The ceiling: they are copies of the pointer, so an addon reading them after
 * the process has called setenv() sees the array as it was. Bionic reallocates
 * that array when it grows, and nothing here would notice. Fine for reading
 * configuration at startup, which is what these addons do; not a general
 * substitute for the real thing.
 */
char **environ = 0;
char **__environ = 0;
char **_environ = 0;

/*
 * Bionic keeps its environment array private -- it is not in libc's dynamic
 * symbol table, so a glibc addon that binds to `environ` fails to load even
 * though the data exists. These copies are built at load time from
 * /proc/self/environ, which the kernel maintains for every process and which is
 * the only view of it reachable from a shared object here.
 *
 * The ceiling: it is a snapshot. An addon reading it after the process calls
 * setenv() sees the environment as it was at load. That covers reading
 * configuration during initialisation, which is what these addons do with it,
 * and nothing more. Raising it would mean intercepting setenv, which is a much
 * larger promise than this file should make.
 */
__attribute__((constructor)) static void init_environ(void) {
    FILE *f = fopen("/proc/self/environ", "rb");
    if (!f) return;

    static char buf[64 * 1024];
    size_t n = fread(buf, 1, sizeof(buf) - 1, f);
    fclose(f);
    if (n == 0) return;
    buf[n] = '\0';

    size_t count = 0;
    for (size_t i = 0; i < n; i++) {
        if (buf[i] == '\0') count++;
    }

    static char *slots[1024];
    size_t used = 0;
    for (size_t i = 0; i < n && used < (sizeof(slots) / sizeof(*slots)) - 1; ) {
        slots[used++] = &buf[i];
        while (i < n && buf[i] != '\0') i++;
        i++;
    }
    slots[used] = 0;

    environ = slots;
    __environ = slots;
    _environ = slots;
}

/*
 * The stat family. glibc's public stat() is a thin inline over __xstat(ver, ...),
 * where ver names the struct layout. Bionic has one layout and no versioning, so
 * the version argument is read and discarded -- addons built against modern
 * glibc always pass the current one.
 */
int __xstat(int ver, const char *path, struct stat *buf) { (void)ver; return stat(path, buf); }
int __xstat64(int ver, const char *path, struct stat *buf) { (void)ver; return stat(path, buf); }
int __lxstat(int ver, const char *path, struct stat *buf) { (void)ver; return lstat(path, buf); }
int __lxstat64(int ver, const char *path, struct stat *buf) { (void)ver; return lstat(path, buf); }
int __fxstat(int ver, int fd, struct stat *buf) { (void)ver; return fstat(fd, buf); }
int __fxstat64(int ver, int fd, struct stat *buf) { (void)ver; return fstat(fd, buf); }
int __fxstatat(int ver, int fd, const char *path, struct stat *buf, int flags) {
    (void)ver; return fstatat(fd, path, buf, flags);
}
int __fxstatat64(int ver, int fd, const char *path, struct stat *buf, int flags) {
    (void)ver; return fstatat(fd, path, buf, flags);
}

/* 64-bit by default on this ABI, so the suffixed names are the same calls. */
int fcntl64(int fd, int cmd, ...) {
    va_list ap;
    va_start(ap, cmd);
    void *arg = va_arg(ap, void *);
    va_end(ap);
    return fcntl(fd, cmd, arg);
}

/*
 * glibc's assert calls this; Bionic's is __assert2 with the same information in
 * a different argument order.
 */
void __assert2(const char *, int, const char *, const char *) __attribute__((noreturn));

void __assert_fail(const char *assertion, const char *file, unsigned line,
                   const char *function) {
    __assert2(file, (int)line, function, assertion);
}

/*
 * ctype tables. glibc returns a pointer to a pointer into a table offset by 128
 * so that EOF (-1) indexes validly. The table is built once with the C locale,
 * which is what these addons run under anyway.
 */
static const unsigned short *ctype_b_table(void) {
    static unsigned short table[384];
    static const unsigned short *ptr;
    if (!ptr) {
        for (int c = 0; c < 256; c++) {
            unsigned short f = 0;
            if (c >= 'A' && c <= 'Z') f |= 0x0100 | 0x0400;            /* upper, alpha */
            if (c >= 'a' && c <= 'z') f |= 0x0200 | 0x0400;            /* lower, alpha */
            if (c >= '0' && c <= '9') f |= 0x0800 | 0x1000;            /* digit, xdigit */
            if ((c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) f |= 0x1000;
            if (c == ' ' || (c >= '\t' && c <= '\r')) f |= 0x2000;     /* space */
            if (c == ' ' || c == '\t') f |= 0x4000;                    /* blank */
            if (c < 32 || c == 127) f |= 0x0002;                       /* cntrl */
            if (c >= 33 && c <= 126) f |= 0x0004 | 0x8000;             /* punct-ish, print */
            if (c >= 32 && c <= 126) f |= 0x8000;                      /* print */
            table[c + 128] = f;
        }
        ptr = table + 128;
    }
    return ptr;
}
const unsigned short **__ctype_b_loc(void) {
    static const unsigned short *p;
    p = ctype_b_table();
    return &p;
}

/* Version strings addons occasionally log or gate on. Nothing branches on the
 * exact value in practice; a modern one keeps any comparison happy. */
const char *gnu_get_libc_version(void) { return "2.31"; }
const char *gnu_get_libc_release(void) { return "stable"; }

/* Resolver reinitialisation. Bionic re-reads its configuration per query, so
 * there is nothing to do and success is the honest answer. */
int __res_init(void) { return 0; }

/*
 * The XPG variant returns int and always writes into the caller's buffer. Bionic
 * follows the GNU shape instead, returning a pointer that may be a static string
 * it never copied, so the copy has to happen here.
 */
int __xpg_strerror_r(int code, char *buf, size_t len) {
    const char *msg = strerror_r(code, buf, len);
    if (msg != buf) {
        if (len == 0) return 34; /* ERANGE */
        strncpy(buf, msg, len - 1);
        buf[len - 1] = '\0';
    }
    return 0;
}

/* glibc's internal atfork registration. Bionic's public one covers the same
 * three handlers; the DSO handle glibc passes is not needed here. */
int __register_atfork(void (*prepare)(void), void (*parent)(void),
                      void (*child)(void), void *dso) {
    (void)dso;
    return pthread_atfork(prepare, parent, child);
}

/*
 * __libc_current_sigrtmin and __libc_current_sigrtmax are deliberately absent.
 * Bionic already defines both, and SIGRTMIN/SIGRTMAX are macros that call them
 * -- writing the obvious wrapper here produces a function that calls itself.
 */

/* jemalloc's sized deallocation. Bionic's allocator does not expose it, and the
 * size is only a hint -- free() is always correct, just less informed. */
void sdallocx(void *ptr, size_t size, int flags) { (void)size; (void)flags; free(ptr); }

/*
 * Symbol resolution for the generated stubs.
 *
 * It lives here, and that is the whole point. Those stubs export glibc names --
 * dlopen@GLIBC_2.17 among them -- so a call to dlopen from inside one of them
 * binds to its own trampoline, whose pointer is not filled yet. It aborts on the
 * first thing it tries to resolve. This file exports none of those names, so the
 * same call reaches Bionic.
 *
 * libdl is consulted separately because Bionic's dl family is provided by the
 * dynamic linker rather than by libc, and taking its address here is the only
 * way to get the real one.
 */
#include <dlfcn.h>
#include <link.h>

static void *shim_libc;
static void *shim_libdl;

__attribute__((constructor(101))) static void shim_open_handles(void) {
    shim_libc = dlopen("libc.so", RTLD_LAZY | RTLD_NOLOAD);
    shim_libdl = dlopen("libdl.so", RTLD_LAZY | RTLD_NOLOAD);
}

void *__shim_resolve(const char *name) {
    if (!shim_libc) shim_open_handles();

    /* The linker owns these; dlsym does not find them by name. */
    if (!__builtin_strcmp(name, "dlopen")) return (void *)&dlopen;
    if (!__builtin_strcmp(name, "dlsym")) return (void *)&dlsym;
    if (!__builtin_strcmp(name, "dlclose")) return (void *)&dlclose;
    if (!__builtin_strcmp(name, "dlerror")) return (void *)&dlerror;
    if (!__builtin_strcmp(name, "dladdr")) return (void *)&dladdr;
    if (!__builtin_strcmp(name, "dl_iterate_phdr")) return (void *)&dl_iterate_phdr;

    void *p = shim_libc ? dlsym(shim_libc, name) : 0;
    if (!p && shim_libdl) p = dlsym(shim_libdl, name);
    if (!p) p = dlsym(RTLD_NEXT, name);
    return p;
}

char **__shim_environ(void) { return environ; }

/*
 * The last few glibc keeps and Bionic does not.
 *
 * bcmp is the BSD spelling of memcmp with only its zero/non-zero result
 * meaningful, which is exactly what memcmp already promises.
 */
int bcmp(const void *a, const void *b, size_t n) { return memcmp(a, b, n); }

/*
 * pidfd helpers, glibc 2.36 and later. Bionic has the syscalls but not these
 * wrappers. Reporting "not implemented" is honest and is a case callers of these
 * already handle -- they exist precisely because older kernels lack them.
 */
int pidfd_getpid(int fd) { (void)fd; errno = ENOSYS; return -1; }
int pidfd_spawnp(int *pidfd, const char *file, const void *facts,
                 const void *attrp, char *const argv[], char *const envp[]) {
    (void)pidfd; (void)file; (void)facts; (void)attrp; (void)argv; (void)envp;
    errno = ENOSYS;
    return ENOSYS;
}

/*
 * posix_spawn's chdir action. Bionic has it under the _np name POSIX had not yet
 * standardised when it was added; the declaration is guarded by API level in the
 * headers, so it is declared here rather than relying on the guard.
 */
int posix_spawn_file_actions_addchdir_np(posix_spawn_file_actions_t *, const char *);

int posix_spawn_file_actions_addchdir(posix_spawn_file_actions_t *acts,
                                      const char *path) {
    return posix_spawn_file_actions_addchdir_np(acts, path);
}
