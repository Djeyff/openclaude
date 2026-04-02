FROM oven/bun:1.3.11

RUN apt-get update && apt-get install -y \
    git \
    curl \
    bash \
    ca-certificates \
    openssh-client \
    tmux \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/openclaude

COPY package.json bun.lock* ./
RUN bun install

COPY . .
RUN bun run build
RUN npm link || true

RUN mkdir -p /workspace

ENV HOME=/root
ENV TERM=xterm-256color
ENV OPENCLAUDE_WORKSPACE=/workspace

CMD ["bash", "-lc", "echo 'OpenClaude container ready. Use shell access to run start-openclaude inside /workspace.'; tail -f /dev/null"]
