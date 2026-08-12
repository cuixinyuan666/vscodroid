# Build host for compiling Code - OSS into a vscode-reh-web server tree.
#
# Linux, not macOS: @vscode/ripgrep's postinstall branches on os.platform() and
# node-gyp picks its flavour from the host, so a macOS shell produces a tree that
# cannot run on the device.
#
# Left at the host's own architecture on purpose. Our target is
# vscode-reh-web-linux-arm64, so on an arm64 machine this builds natively and the
# remote/ native modules — which remote/.npmrc forces to build_from_source — need
# no qemu at all. Microsoft's own pipeline reaches for multiarch/qemu-user-static
# precisely because it builds arm64 on x64; we can skip that whole layer.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Matches .nvmrc at the VS Code tag being built. Not the Node that ends up on the
# device — that is the cross-compiled libnode.so, pinned separately by
# remote/.npmrc `target`.
ARG NODE_VERSION=20.18.0

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        curl \
        git \
        jq \
        libkrb5-dev \
        libsecret-1-dev \
        libx11-dev \
        libxkbfile-dev \
        pkg-config \
        python3 \
        python3-setuptools \
        xz-utils \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    case "$(dpkg --print-architecture)" in \
        arm64) node_arch=arm64 ;; \
        amd64) node_arch=x64 ;; \
        *) echo "unsupported build arch: $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
        | tar -xJ -C /usr/local --strip-components=1; \
    node --version; \
    npm --version

# gulp is invoked with --max-old-space-size=8192 by VS Code's own npm script, so
# the container needs headroom well above the default.
ENV NODE_OPTIONS=--max-old-space-size=8192

WORKDIR /work
CMD ["/bin/bash"]
