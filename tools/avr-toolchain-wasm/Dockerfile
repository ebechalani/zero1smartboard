# Reproducible build environment for the AVR toolchain WebAssembly rebuild.
#   docker build -t avr-toolchain-wasm .
#   docker run --rm -v "$PWD/out:/build/work/out" avr-toolchain-wasm
# Everything build.sh needs on the build side (native gcc for GCC's gen* tools,
# flex/bison for binutils/gcc parsers, texinfo, python3 for emsdk). The
# emsdk release is pinned here AND in build.sh (EMSDK_VERSION); keep them equal.
# Pin the base image by digest for a fully reproducible environment: run
# `docker pull debian:bookworm-slim && docker inspect --format '{{index .RepoDigests 0}}' debian:bookworm-slim`
# and put that `debian@sha256:...` here. (Left as a tag so that this file works out of the box.)
FROM debian:bookworm-slim AS build
ARG EMSDK_VERSION=6.0.10
ENV DEBIAN_FRONTEND=noninteractive EMSDK_VERSION=${EMSDK_VERSION} LC_ALL=C.UTF-8
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential git curl ca-certificates xz-utils bzip2 python3 \
      flex bison texinfo m4 autoconf automake libtool patch file \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY build.sh ./
COPY patches ./patches
COPY emscripten-pre.js ./
ENV WORK=/build/work JOBS=4
# stage by stage so that a broken later stage keeps the earlier layers cached
RUN ./build.sh fetch
RUN ./build.sh emsdk
RUN ./build.sh deps
RUN ./build.sh binutils
RUN ./build.sh gcc
RUN ./build.sh package
CMD ["sh", "-c", "cp -v /build/work/out/* /build/work/out-mount/ 2>/dev/null || (ls -la /build/work/out && cat /build/work/out/SHA256SUMS)"]
