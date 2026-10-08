FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS build
COPY package.json package-lock.json ./
# Optional PUBLIC trust certificate for a local HTTPS inspection proxy.
# Never use this build argument for private keys or credentials.
ARG BUILD_CA_PEM
RUN if [ -n "$BUILD_CA_PEM" ]; then \
      printf '%s\n' "$BUILD_CA_PEM" > /tmp/build-ca.crt; \
      export NODE_EXTRA_CA_CERTS=/tmp/build-ca.crt; \
    fi; \
    npm ci --no-audit --no-fund && rm -f /tmp/build-ca.crt
COPY . .
# Public client configuration only; provider secrets remain runtime variables.
ARG NEXT_PUBLIC_SITE_NAME="Referral Market"
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=""
ENV NEXT_PUBLIC_SITE_NAME=$NEXT_PUBLIC_SITE_NAME
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["npm", "run", "start"]
