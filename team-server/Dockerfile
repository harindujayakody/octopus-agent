# syntax=docker/dockerfile:1
# The team server as an image. Built from the repository root, which also
# holds the rights and wire crates it shares with the launcher:
#   docker build -f team-server/Dockerfile -t octopus-agent-team-server .

FROM rust:1-bookworm AS build
WORKDIR /src
COPY crates/team-model crates/team-model
COPY crates/team-wire crates/team-wire
COPY team-server/Cargo.toml team-server/Cargo.lock team-server/
COPY team-server/src team-server/src
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/src/team-server/target,sharing=locked \
    cargo build --release --locked --manifest-path team-server/Cargo.toml \
 && install -D team-server/target/release/octopus-agent-team-server /out/octopus-agent-team-server \
 && install -d /out/data

# glibc and nothing else: no shell, no package manager.
FROM gcr.io/distroless/cc-debian12:nonroot
LABEL org.opencontainers.image.source="https://github.com/harindujayakody/octopus-agent" \
      org.opencontainers.image.description="Octopus Agent team server" \
      org.opencontainers.image.licenses="MIT"
COPY --from=build /out/octopus-agent-team-server /usr/local/bin/octopus-agent-team-server
# Owned by the user the server runs as; a new named volume starts as a copy of it.
COPY --from=build --chown=65532:65532 /out/data /data
ENV SHARDBROWSER_TEAM_BIND=0.0.0.0:8787 \
    SHARDBROWSER_TEAM_DATA_DIR=/data
VOLUME /data
EXPOSE 8787
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/octopus-agent-team-server"]
