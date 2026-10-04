FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
ENV FORMSYNC_FFMPEG_PATH=/usr/bin/ffmpeg FORMSYNC_FFPROBE_PATH=/usr/bin/ffprobe NEXT_TELEMETRY_DISABLED=1
RUN npm run build
RUN npm prune --omit=dev --ignore-scripts
FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 FORMSYNC_DATA_DIR=/app/data FORMSYNC_FFMPEG_PATH=/usr/bin/ffmpeg FORMSYNC_FFPROBE_PATH=/usr/bin/ffprobe
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","node_modules/next/dist/bin/next","start","--hostname","0.0.0.0"]
