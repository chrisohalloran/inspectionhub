FROM mcr.microsoft.com/playwright:v1.61.1-noble@sha256:cf0daee9b994042e011bc29f20cdff1a9f682a039b43fcd738f7d8a9d3bcd9d6

ENV NODE_ENV=production
WORKDIR /app

RUN npm install --global pnpm@10.29.3
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json tsconfig.package.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY packages/task-queue/package.json packages/task-queue/package.json
RUN pnpm install --frozen-lockfile --prod=false

COPY apps/worker apps/worker
COPY packages/config packages/config
COPY packages/storage packages/storage
COPY packages/task-queue packages/task-queue
RUN pnpm --filter @inspection/config build && pnpm --filter @inspection/storage build && pnpm --filter @inspection/task-queue build && pnpm --filter @inspection/worker build

USER pwuser
CMD ["pnpm", "--filter", "@inspection/worker", "start"]
