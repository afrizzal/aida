# Minimal logging DNS resolver used only by docker-compose.egress-test.yml. Zero npm
# dependencies (see logger.mjs) — no separate deps/build stage needed.
FROM node:22-alpine
WORKDIR /app
COPY logger.mjs ./logger.mjs
CMD ["node", "logger.mjs"]
