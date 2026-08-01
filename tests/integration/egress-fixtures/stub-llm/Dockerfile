# Minimal Ollama-protocol stub used only by docker-compose.egress-test.yml. Zero npm
# dependencies (see server.mjs) — no separate deps/build stage needed.
FROM node:22-alpine
WORKDIR /app
COPY server.mjs ./server.mjs
EXPOSE 11434
CMD ["node", "server.mjs"]
