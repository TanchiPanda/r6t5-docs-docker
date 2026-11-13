FROM node:20-alpine

LABEL org.opencontainers.image.title="r6t5-docs" \
      org.opencontainers.image.description="r6t5-docs 文档站（社区版/专业版同镜像，带管理后台）" \
      org.opencontainers.image.source="https://github.com/TanchiPanda/r6t5-docs-community"

ENV PORT=8080 \
    DATA_DIR=/data

WORKDIR /app
COPY server ./server
COPY admin ./admin
COPY public ./public

RUN mkdir -p /data && chown -R node:node /data /app
USER node

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1

CMD ["node", "server/server.js"]
