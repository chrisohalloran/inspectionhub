# Cursor Cloud Agent base image for InspectionHub.
# Do not COPY the repository — Cursor clones the workspace at agent start.

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    git \
    gnupg \
    sudo \
    postgresql-17 \
    postgresql-client-17 \
    && rm -rf /var/lib/apt/lists/*

# Node.js 24 (matches CI) and pnpm 10.29.3 (matches packageManager field).
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@10.29.3 --activate

# Cloud Agent runs as the ubuntu user and needs passwordless sudo.
RUN id -u ubuntu &>/dev/null || useradd -m -s /bin/bash ubuntu \
    && usermod -aG sudo ubuntu \
    && echo "ubuntu ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/ubuntu \
    && chmod 440 /etc/sudoers.d/ubuntu

WORKDIR /workspace
