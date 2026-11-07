# syntax=docker/dockerfile:1

# deps — dependências completas. O cache do npm fica fora da camada.
# O digest é o índice multi-arch (tag@sha256), para o buildx resolver amd64 e arm64.
FROM node:22-trixie-slim@sha256:be1e2a3dc2c4fd68cdfadad2a696a280e0d2749098bee509230174d72fb768c6 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# build — gera dist/main.js. Não carrega NODE_ENV=production (precisa das devDependencies).
FROM deps AS build
COPY . .
RUN npm run build

# test — unitários, e2e e cobertura. Nenhum estágio da imagem final depende deste.
FROM build AS test
RUN npm run test:cov

# reports — só os relatórios, para extrair sem Node na máquina:
#   docker build --target reports --output type=local,dest=./reports-out .
FROM scratch AS reports
COPY --from=test /app/coverage /coverage
COPY --from=test /app/reports /reports

# prod-deps — mesmo Debian 13 (glibc) da distroless do runtime.
FROM node:22-trixie-slim@sha256:be1e2a3dc2c4fd68cdfadad2a696a280e0d2749098bee509230174d72fb768c6 AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# runtime — estágio final. `docker build .` produz esta imagem.
FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:8ad9cc935b7843c4024b7e1487b5ef472c354ea847b97c667023e2618552607e AS runtime

ARG VERSION=0.0.0
ARG SOURCE=https://github.com/brunoaquino/calculador-api

LABEL org.opencontainers.image.title="calculador-api" \
      org.opencontainers.image.description="API de calculadora (soma, subtração, multiplicação e divisão) para uso apenas dentro do cluster Kubernetes." \
      org.opencontainers.image.source="${SOURCE}" \
      org.opencontainers.image.version="${VERSION}"

WORKDIR /app
COPY --from=build --chown=65532:65532 /app/dist ./dist
COPY --from=prod-deps --chown=65532:65532 /app/node_modules ./node_modules
COPY --from=prod-deps --chown=65532:65532 /app/package.json ./package.json

# Cadeia de memória: limit do container 256Mi > max-old-space-size 160
# > HEALTH_HEAP_THRESHOLD_MB 144. O readiness falha antes do teto do V8
# e bem antes do OOM do cgroup. O ConfigMap repete os mesmos valores.
ENV NODE_ENV=production \
    PORT=8000 \
    HOME=/tmp \
    NODE_OPTIONS=--max-old-space-size=160 \
    HEALTH_HEAP_THRESHOLD_MB=144

EXPOSE 8000
USER 65532:65532
STOPSIGNAL SIGTERM
CMD ["dist/main.js"]
