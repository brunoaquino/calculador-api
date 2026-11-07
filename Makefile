# Empacotamento, testes locais e deploy da calculador-api.
# Compatível com GNU Make 3.81 (o make do macOS).

ROOT := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))

REGISTRY ?= ghcr.io/brunoaquino
IMAGE_NAME ?= calculador-api
TAG ?= $(shell node -p "require('$(ROOT)/package.json').version" 2>/dev/null || echo latest)
IMAGE ?= $(REGISTRY)/$(IMAGE_NAME):$(TAG)
PLATFORMS ?= linux/amd64,linux/arm64
NAMESPACE ?= calculador
KIND_CLUSTER ?= calculador
PULL_SECRET ?=
CLIENT_NAMESPACE ?= default
ROLLOUT_TIMEOUT ?= 120s
BUILDER ?= calculador-builder
SOURCE ?= https://github.com/brunoaquino/calculador-api
CURL_IMAGE ?= curlimages/curl:8.23.0

export DOCKER_BUILDKIT := 1

.DEFAULT_GOAL := help

.PHONY: help install lint test test-cov run reports \
	docker-build docker-run docker-push release \
	deploy status logs smoke-test check-exposure port-forward undeploy redeploy rollback \
	kind-up kind-load kind-down local-e2e

help: ## Mostra os alvos e as variáveis
	@printf '%s\n' \
		'calculador-api' \
		'' \
		'Variáveis (make ALVO VAR=valor):' \
		'  REGISTRY=$(REGISTRY)' \
		'  IMAGE_NAME=$(IMAGE_NAME)' \
		'  TAG=$(TAG)' \
		'  IMAGE=$(IMAGE)' \
		'  PLATFORMS=$(PLATFORMS)' \
		'  NAMESPACE=$(NAMESPACE)' \
		'  KIND_CLUSTER=$(KIND_CLUSTER)' \
		'  PULL_SECRET=$(PULL_SECRET)' \
		'  CLIENT_NAMESPACE=$(CLIENT_NAMESPACE)' \
		'  ROLLOUT_TIMEOUT=$(ROLLOUT_TIMEOUT)' \
		'  CURL_IMAGE=$(CURL_IMAGE)' \
		'' \
		'Alvos:'
	@awk -f '$(ROOT)/scripts/make-help.awk' '$(ROOT)/Makefile'

install: ## Instala dependências com npm ci
	npm --prefix '$(ROOT)' ci

lint: ## Roda o ESLint
	npm --prefix '$(ROOT)' run lint

test: ## Roda os testes
	npm --prefix '$(ROOT)' test

test-cov: ## Roda testes com cobertura (meta 100%)
	npm --prefix '$(ROOT)' run test:cov

run: ## Sobe a API em modo desenvolvimento
	npm --prefix '$(ROOT)' run start:dev

reports: ## Extrai cobertura e JUnit via Docker, sem Node local
	rm -rf '$(ROOT)/reports-out'
	mkdir -p '$(ROOT)/reports-out'
	docker build --target reports --output type=local,dest='$(ROOT)/reports-out' '$(ROOT)'
	@printf '%s\n' \
		'Relatórios extraídos:' \
		'  HTML:      reports-out/coverage/lcov-report/index.html' \
		'  LCOV:      reports-out/coverage/lcov.info' \
		'  Cobertura: reports-out/coverage/cobertura-coverage.xml' \
		'  Resumo:    reports-out/coverage/coverage-summary.json' \
		'  JUnit:     reports-out/reports/junit.xml'

docker-build: ## Constrói a imagem local da arquitetura da máquina
	docker buildx build \
		--load \
		--target runtime \
		--tag '$(IMAGE)' \
		--build-arg VERSION='$(TAG)' \
		--build-arg SOURCE='$(SOURCE)' \
		'$(ROOT)'

docker-run: ## Sobe a imagem em http://127.0.0.1:8000
	docker run --rm --name calculador-api \
		-p 8000:8000 \
		-e PORT=8000 \
		-e NODE_ENV=production \
		-e LOG_LEVEL=info \
		-e SWAGGER_ENABLED=true \
		-e SERVICE_NAME=calculador-api \
		'$(IMAGE)'

docker-push: ## Publica a imagem multi-arch no registry
	docker buildx inspect '$(BUILDER)' >/dev/null 2>&1 || docker buildx create --name '$(BUILDER)' --driver docker-container
	docker buildx inspect --bootstrap '$(BUILDER)' >/dev/null
	docker buildx build \
		--builder '$(BUILDER)' \
		--platform '$(PLATFORMS)' \
		--target runtime \
		--tag '$(IMAGE)' \
		--build-arg VERSION='$(TAG)' \
		--build-arg SOURCE='$(SOURCE)' \
		--push \
		'$(ROOT)'

release: docker-push ## Atalho de docker-push

deploy: ## Aplica a imagem IMAGE no cluster sem alterar o repositório
	set -eu; \
	tmp=""; \
	cleanup() { if [ -n "$$tmp" ]; then rm -rf "$$tmp"; fi; }; \
	trap cleanup EXIT; \
	tmp=$$(IMAGE='$(IMAGE)' PULL_SECRET='$(PULL_SECRET)' K8S_DIR='$(ROOT)/k8s' bash '$(ROOT)/scripts/prepare-overlay.sh'); \
	kubectl apply -k "$$tmp"; \
	kubectl -n '$(NAMESPACE)' rollout status deploy/calculador-api --timeout='$(ROLLOUT_TIMEOUT)'

status: ## Mostra Deployment, Pods, Service, NetworkPolicy e PDB
	kubectl -n '$(NAMESPACE)' get deploy,pods,svc,networkpolicy,pdb -o wide

logs: ## Acompanha os logs de todos os Pods da API
	kubectl -n '$(NAMESPACE)' logs -l app.kubernetes.io/name=calculador-api --all-containers=true -f --prefix=true

smoke-test: ## Testa a API com um Pod cliente dentro do cluster
	NAMESPACE='$(NAMESPACE)' CLIENT_NAMESPACE='$(CLIENT_NAMESPACE)' CURL_IMAGE='$(CURL_IMAGE)' \
		bash '$(ROOT)/scripts/smoke-test.sh'

check-exposure: ## Confere que o Service é ClusterIP e que não há Ingress
	NAMESPACE='$(NAMESPACE)' bash '$(ROOT)/scripts/check-exposure.sh'

port-forward: ## Encaminha a API para 127.0.0.1:8000 (admin/Swagger)
	kubectl -n '$(NAMESPACE)' port-forward svc/calculador-api 8000:8000

undeploy: ## Remove a aplicação, inclusive o namespace
	kubectl delete -k '$(ROOT)/k8s' --ignore-not-found

redeploy: ## Publica a imagem e faz o deploy (ciclo de alteração)
	$(MAKE) release
	$(MAKE) deploy

rollback: ## Desfaz o último rollout
	kubectl -n '$(NAMESPACE)' rollout undo deploy/calculador-api
	kubectl -n '$(NAMESPACE)' rollout status deploy/calculador-api --timeout='$(ROLLOUT_TIMEOUT)'

kind-up: ## Cria o cluster kind local, se ainda não existir
	if kind get clusters | grep -qx '$(KIND_CLUSTER)'; then \
		printf '%s\n' "Cluster kind '$(KIND_CLUSTER)' já existe."; \
	else \
		kind create cluster --name '$(KIND_CLUSTER)' --config '$(ROOT)/k8s/local/kind-config.yaml'; \
	fi

kind-load: ## Carrega a imagem local no cluster kind
	kind load docker-image '$(IMAGE)' --name '$(KIND_CLUSTER)'

kind-down: ## Apaga o cluster kind
	if kind get clusters | grep -qx '$(KIND_CLUSTER)'; then \
		kind delete cluster --name '$(KIND_CLUSTER)'; \
	else \
		printf '%s\n' "Cluster kind '$(KIND_CLUSTER)' não existe."; \
	fi

local-e2e: ## kind + build + load + deploy + smoke test
	$(MAKE) kind-up
	$(MAKE) docker-build
	$(MAKE) kind-load
	$(MAKE) deploy
	$(MAKE) smoke-test
