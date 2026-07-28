# syntax=docker/dockerfile:1
# Veritoken development image
# Provides: Rust stable + wasm32 target, Stellar CLI, Node.js 20, project source.
#
# Build:  docker build -t veritoken-dev .
# Run:    docker compose up
#
# The image is intentionally NOT used for production. It is a local development
# and CI convenience image only.

# ── Stage 1: Rust / WASM toolchain ─────────────────────────────────────────
FROM rust:1.78-slim-bookworm AS rust-toolchain

# System dependencies required by the Stellar CLI and cargo build
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    pkg-config \
    libssl-dev \
    git \
    && rm -rf /var/lib/apt/lists/*

# Add the WASM compilation target
RUN rustup target add wasm32-unknown-unknown \
 && rustup component add rustfmt clippy

# Install Stellar CLI (pinned version for reproducibility)
# See https://github.com/stellar/stellar-cli/releases for latest version
ARG STELLAR_CLI_VERSION=21.3.1
RUN curl -sSfL \
    "https://github.com/stellar/stellar-cli/releases/download/v${STELLAR_CLI_VERSION}/stellar-cli-${STELLAR_CLI_VERSION}-x86_64-unknown-linux-gnu.tar.gz" \
    | tar -xz -C /usr/local/bin stellar

# ── Stage 2: Node toolchain ─────────────────────────────────────────────────
FROM node:20-slim AS node-toolchain

# ── Stage 3: Development image ──────────────────────────────────────────────
FROM debian:bookworm-slim AS dev

# Runtime system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    pkg-config \
    libssl-dev \
    git \
    bash \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Copy Rust, Cargo, and the WASM target from the rust-toolchain stage
COPY --from=rust-toolchain /usr/local/rustup  /usr/local/rustup
COPY --from=rust-toolchain /usr/local/cargo   /usr/local/cargo
COPY --from=rust-toolchain /usr/local/bin/stellar /usr/local/bin/stellar

ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:/usr/local/bin:$PATH

# Copy Node.js from the node-toolchain stage
COPY --from=node-toolchain /usr/local/bin/node  /usr/local/bin/node
COPY --from=node-toolchain /usr/local/bin/npm   /usr/local/bin/npm
COPY --from=node-toolchain /usr/local/bin/npx   /usr/local/bin/npx
COPY --from=node-toolchain /usr/local/lib/node_modules /usr/local/lib/node_modules

# Verify the toolchain is healthy before continuing
RUN cargo --version \
 && rustup show \
 && stellar --version \
 && node --version \
 && npm --version

WORKDIR /workspace

# Pre-fetch Cargo dependencies so the layer is cached independently of source
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY contracts/ contracts/
COPY tests/ tests/

RUN cargo fetch --locked

# Copy the rest of the source
COPY . .

# Pre-install frontend dependencies
RUN cd frontend && npm ci --prefer-offline

EXPOSE 5173

CMD ["bash"]
