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
 *
 * The bit values are glibc's _ISbit(): bits 0-7 are shifted up a byte, bits
 * 8-11 down a byte, so the "obvious" hex guesses are wrong in both directions.
 * The first version of this table guessed, and got 5 of the 12 classes wrong -
 * isalnum() false for everything, isprint() false, ispunct('A') true - which an
 * addon consumes through the __ctype_b_loc() macro expansion with no error to
 * see anywhere. Values below are copied from glibc's ctype.h, not derived.
 */
#define SHIM_ISupper  0x0100
#define SHIM_ISlower  0x0200
#define SHIM_ISalpha  0x0400
#define SHIM_ISdigit  0x0800
#define SHIM_ISxdigit 0x1000
#define SHIM_ISspace  0x2000
#define SHIM_ISprint  0x4000
#define SHIM_ISgraph  0x8000
#define SHIM_ISblank  0x0001
#define SHIM_IScntrl  0x0002
#define SHIM_ISpunct  0x0004
#define SHIM_ISalnum  0x0008

static const unsigned short *ctype_b_table(void) {
    static unsigned short table[384];
    static const unsigned short *ptr;
    if (!ptr) {
        for (int c = 0; c < 256; c++) {
            unsigned short f = 0;
            if (c >= 'A' && c <= 'Z') f |= SHIM_ISupper | SHIM_ISalpha;
            if (c >= 'a' && c <= 'z') f |= SHIM_ISlower | SHIM_ISalpha;
            if (c >= '0' && c <= '9') f |= SHIM_ISdigit;
            if ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))
                f |= SHIM_ISxdigit;
            if (f & (SHIM_ISalpha | SHIM_ISdigit)) f |= SHIM_ISalnum;
            if (c == ' ' || (c >= '\t' && c <= '\r')) f |= SHIM_ISspace;
            if (c == ' ' || c == '\t') f |= SHIM_ISblank;
            if (c < 32 || c == 127) f |= SHIM_IScntrl;
            if (c >= 33 && c <= 126) {
                f |= SHIM_ISgraph;
                if (!(f & SHIM_ISalnum)) f |= SHIM_ISpunct;
            }
            if (c >= 32 && c <= 126) f |= SHIM_ISprint;
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

/*
 * Accessors for the data symbols the stubs re-export. The stubs cannot read
 * `environ` or `stdout` by name: they define those very names (versioned, at
 * default visibility), so the reference would bind to their own zeroed storage
 * and the constructor would copy NULL over NULL — measured with readelf, the
 * GLOB_DAT entries pointed at the stub's own .bss. This library defines
 * neither name, so from here the same references reach Bionic's real ones.
 */
char **__shim_environ(void) { return environ; }
FILE *__shim_stdin(void)  { return stdin; }
FILE *__shim_stdout(void) { return stdout; }
FILE *__shim_stderr(void) { return stderr; }

/*
 * The last few glibc keeps and Bionic does not.
 *
 * bcmp is the BSD spelling of memcmp with only its zero/non-zero result
 * meaningful, which is exactly what memcmp already promises.
 */
int bcmp(const void *a, const void *b, size_t n) { return memcmp(a, b, n); }

/*
 * The scanf family under the names glibc actually links against.
 *
 * glibc's stdio.h redirects sscanf, fscanf, scanf and their v- forms to
 * __isoc99_ spellings whenever C99 conversion rules apply, which is every build
 * that has not asked for the older ones. So an addon whose source says sscanf
 * imports a name Bionic has never had at any API level, and the forwarder for it
 * aborts on first call. Compiling all six calls against glibc 2.36 on aarch64
 * emits exactly these six undefined symbols, which is where the list comes from.
 *
 * The C99 behaviour the redirect selects -- %a as a conversion rather than the
 * GNU allocation modifier -- is already what Bionic implements, so each of these
 * is the plain function and nothing more.
 */
int __isoc99_sscanf(const char *s, const char *fmt, ...) {
    va_list ap; va_start(ap, fmt);
    int rc = vsscanf(s, fmt, ap);
    va_end(ap);
    return rc;
}
int __isoc99_fscanf(FILE *f, const char *fmt, ...) {
    va_list ap; va_start(ap, fmt);
    int rc = vfscanf(f, fmt, ap);
    va_end(ap);
    return rc;
}
int __isoc99_scanf(const char *fmt, ...) {
    va_list ap; va_start(ap, fmt);
    int rc = vfscanf(stdin, fmt, ap);
    va_end(ap);
    return rc;
}
int __isoc99_vsscanf(const char *s, const char *fmt, va_list ap) { return vsscanf(s, fmt, ap); }
int __isoc99_vfscanf(FILE *f, const char *fmt, va_list ap) { return vfscanf(f, fmt, ap); }
int __isoc99_vscanf(const char *fmt, va_list ap) { return vfscanf(stdin, fmt, ap); }

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

/* ------------------------------------------------------------------------
 * Translating wrappers.
 *
 * Everything above is a symbol Bionic simply lacks. What follows is different
 * and more dangerous: symbols Bionic HAS, whose arguments it lays out
 * differently from glibc. Forwarding one of these does not fail -- it writes
 * the right bytes to the wrong offsets and the program carries on. There is no
 * crash to find, and the damage surfaces somewhere else entirely.
 *
 * Each wrapper below converts at the boundary. The generator points the
 * versioned export at these instead of at Bionic, and refuses to forward any
 * other symbol on its known-incompatible list -- so a struct we have not
 * translated yet aborts by name rather than corrupting quietly.
 * ------------------------------------------------------------------------ */

#include <android/log.h>
#include <netdb.h>
#include <sys/socket.h>

/*
 * struct sigaction, and the two libcs could hardly disagree more on arm64.
 *
 *   Bionic (32 bytes)   int sa_flags; union{handler}; sigset_t sa_mask (8);
 *                       void (*sa_restorer)(void);
 *   glibc  (152 bytes)  union{handler}; sigset_t sa_mask (128); int sa_flags;
 *                       void (*sa_restorer)(void);
 *
 * Handed one glibc struct unconverted, Bionic reads the low half of the handler
 * pointer as sa_flags and takes the handler itself out of the first word of the
 * mask. It then installs that as a signal handler. Nothing reports an error.
 *
 * Only the low 64 bits of glibc's mask carry anything: there are 64 signals and
 * the kernel's own sigset is 64 bits wide. The remaining 120 bytes exist so the
 * structure can outlive that limit, and are copied as zero.
 */
struct glibc_sigaction {
    void *handler;
    unsigned long mask[16];
    int flags;
    void (*restorer)(void);
};

static void from_glibc_sigaction(const struct glibc_sigaction *g, struct sigaction *b) {
    b->sa_flags = g->flags;
    b->sa_handler = (sighandler_t)g->handler;
    memset(&b->sa_mask, 0, sizeof(b->sa_mask));
    b->sa_mask.sig[0] = g->mask[0];
    b->sa_restorer = g->restorer;
}

static void to_glibc_sigaction(const struct sigaction *b, struct glibc_sigaction *g) {
    memset(g, 0, sizeof(*g));
    g->handler = (void *)b->sa_handler;
    g->mask[0] = b->sa_mask.sig[0];
    g->flags = b->sa_flags;
    g->restorer = b->sa_restorer;
}

int __shim_sigaction(int signum, const struct glibc_sigaction *act,
                     struct glibc_sigaction *oldact) {
    struct sigaction b_act, b_old;
    int rc = sigaction(signum, act ? (from_glibc_sigaction(act, &b_act), &b_act) : 0,
                       oldact ? &b_old : 0);
    if (rc == 0 && oldact) to_glibc_sigaction(&b_old, oldact);
    return rc;
}

/*
 * Signal sets. glibc's is 128 bytes, Bionic's is 8, and only the first 8 mean
 * anything. Bionic's sigemptyset would leave the other 120 as whatever was on
 * the caller's stack -- harmless while every reader is one of these wrappers,
 * and not worth relying on. They are cleared.
 */
int __shim_sigemptyset(unsigned long *set) {
    memset(set, 0, 128);
    return 0;
}

int __shim_sigfillset(unsigned long *set) {
    memset(set, 0, 128);
    set[0] = ~0UL;
    return 0;
}

int __shim_sigaddset(unsigned long *set, int signum) {
    if (signum < 1 || signum > 64) { errno = EINVAL; return -1; }
    set[0] |= 1UL << (signum - 1);
    return 0;
}

int __shim_sigdelset(unsigned long *set, int signum) {
    if (signum < 1 || signum > 64) { errno = EINVAL; return -1; }
    set[0] &= ~(1UL << (signum - 1));
    return 0;
}

int __shim_sigismember(const unsigned long *set, int signum) {
    if (signum < 1 || signum > 64) { errno = EINVAL; return -1; }
    return (set[0] >> (signum - 1)) & 1;
}

int __shim_sigprocmask(int how, const unsigned long *set, unsigned long *oldset) {
    sigset_t b_set, b_old;
    if (set) { memset(&b_set, 0, sizeof(b_set)); b_set.sig[0] = set[0]; }
    int rc = sigprocmask(how, set ? &b_set : 0, oldset ? &b_old : 0);
    if (rc == 0 && oldset) {
        memset(oldset, 0, 128);
        oldset[0] = b_old.sig[0];
    }
    return rc;
}

int __shim_pthread_sigmask(int how, const unsigned long *set, unsigned long *oldset) {
    sigset_t b_set, b_old;
    if (set) { memset(&b_set, 0, sizeof(b_set)); b_set.sig[0] = set[0]; }
    int rc = pthread_sigmask(how, set ? &b_set : 0, oldset ? &b_old : 0);
    if (rc == 0 && oldset) {
        memset(oldset, 0, 128);
        oldset[0] = b_old.sig[0];
    }
    return rc;
}

/*
 * struct addrinfo. Same size and same fields, but Bionic orders them
 * ai_canonname then ai_addr, where glibc has ai_addr then ai_canonname
 * (netdb.h in both). Forwarded unconverted, a caller reads the canonical name
 * as a socket address and connects to whatever that memory happens to hold.
 *
 * The list is converted in place on the way out, which is safe because both
 * layouts are the same size and we own the allocation until freeaddrinfo.
 */
struct glibc_addrinfo {
    int ai_flags, ai_family, ai_socktype, ai_protocol;
    socklen_t ai_addrlen;
    struct sockaddr *ai_addr;
    char *ai_canonname;
    struct glibc_addrinfo *ai_next;
};

int __shim_getaddrinfo(const char *node, const char *service,
                       const struct glibc_addrinfo *hints,
                       struct glibc_addrinfo **res) {
    struct addrinfo b_hints;
    struct addrinfo *b_res = 0;

    if (hints) {
        memset(&b_hints, 0, sizeof(b_hints));
        b_hints.ai_flags = hints->ai_flags;
        b_hints.ai_family = hints->ai_family;
        b_hints.ai_socktype = hints->ai_socktype;
        b_hints.ai_protocol = hints->ai_protocol;
    }

    int rc = getaddrinfo(node, service, hints ? &b_hints : 0, &b_res);
    if (rc != 0) return rc;

    /* Same size, swapped middle: rewriting each node in place keeps the
     * allocation Bionic's, so freeaddrinfo still owns it. */
    for (struct addrinfo *n = b_res; n; n = n->ai_next) {
        struct glibc_addrinfo *g = (struct glibc_addrinfo *)n;
        char *canon = n->ai_canonname;
        struct sockaddr *addr = n->ai_addr;
        g->ai_addr = addr;
        g->ai_canonname = canon;
    }
    *res = (struct glibc_addrinfo *)b_res;
    return 0;
}

void __shim_freeaddrinfo(struct glibc_addrinfo *res) {
    /* Swap back before handing it to Bionic, which will read its own layout. */
    for (struct glibc_addrinfo *g = res; g; g = g->ai_next) {
        struct addrinfo *n = (struct addrinfo *)g;
        struct sockaddr *addr = g->ai_addr;
        char *canon = g->ai_canonname;
        n->ai_canonname = canon;
        n->ai_addr = addr;
    }
    freeaddrinfo((struct addrinfo *)res);
}

/*
 * Reached when a symbol on the known-incompatible list is called and no
 * translating wrapper has been written for it. Forwarding it would write the
 * right bytes to the wrong offsets and continue; this stops instead, and names
 * the wrapper that is owed.
 */
__attribute__((noreturn)) void __shim_untranslated(const char *name) {
    __android_log_print(ANDROID_LOG_FATAL, "glibc-shim",
                        "%s passes a struct glibc and Bionic lay out differently, "
                        "and has no translating wrapper yet", name);
    abort();
}

/*
 * A stack-protector canary for objects that import one. Bionic keeps its own
 * private to libc, so this is a separate value; that is harmless, because the
 * check compares the prologue's copy against this same variable. It only has to
 * be non-zero and not derivable from the file.
 */
unsigned long __shim_stack_guard(void) {
    static unsigned long value;
    if (!value) {
        FILE *f = fopen("/dev/urandom", "rb");
        if (f) {
            if (fread(&value, sizeof(value), 1, f) != 1) value = 0;
            fclose(f);
        }
        if (!value) value = 0xff0a000000000000UL;  /* glibc's own fallback shape */
    }
    return value;
}
