FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements-lock.txt ./
RUN python3 -m venv /app/.venv && /app/.venv/bin/pip install --no-cache-dir -r requirements-lock.txt
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/site ./site
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./package.json
COPY bench ./bench
COPY config ./config
COPY deploy/railway.py ./deploy/railway.py
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 HOST=0.0.0.0 PORT=8080 TRACE_VOLUME_PATH=/data TRACE_WORKER_ENABLED=0
EXPOSE 8080
ENTRYPOINT ["tini", "--"]
CMD ["python", "deploy/railway.py"]
