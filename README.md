# calculador-api

API HTTP de calculadora (soma, subtração, multiplicação e divisão) em NestJS 11 e Node.js 22.
No Kubernetes ela escuta na porta 8000 e só é alcançada por outras aplicações do cluster. Tem healthcheck, testes com cobertura e um caminho curto para publicar, alterar e remover.

<a id="quickstart-avaliador"></a>

## Quickstart para o avaliador

Baixe o repositório, entre na pasta e use um cluster com NetworkPolicy (ou o kind local, no fim). Troque `<seu-registry>` pelo registry em que você consegue publicar, por exemplo `ghcr.io/seu-usuario`.

```bash
cd calculador-api

# opcional: HTML, Cobertura e JUnit sem Node na máquina
make reports

make release REGISTRY=<seu-registry> TAG=1.1.0
make deploy IMAGE=<seu-registry>/calculador-api:1.1.0
make smoke-test

# edite src/ e publique uma tag nova
make redeploy REGISTRY=<seu-registry> TAG=1.1.1
make undeploy
```

Sem registry, o mesmo ciclo num kind na sua máquina:

```bash
make local-e2e
```

O pacote no GHCR nasce privado. Se o `deploy` não puxar a imagem, torne o pacote público ou crie o `PULL_SECRET` descrito em [Publicar a imagem](#imagem).

O passo a passo para repetir isso na sua máquina está em [Testar localmente](#local). O shell de cada `make`, e o motivo de cada um, está em [Alvos do Make](#make).

<a id="sumario"></a>

## Sumário

- [Requisitos do desafio](#requisitos)
- [Estrutura do projeto](#estrutura)
- [Pré-requisitos](#pre-requisitos)
- [Quickstart para o avaliador](#quickstart-avaliador)
- [Testar localmente](#local)
- [Alvos do Make](#make)
- [API](#api)
- [Swagger](#swagger)
- [Testes e cobertura](#testes)
- [Logs estruturados](#logs)
- [Publicar a imagem](#imagem)
- [Deploy no Kubernetes](#deploy)
- [Acessar e testar](#acesso)
- [Alterar e republicar](#alterar)
- [Remover](#remover)
- [Cluster local com kind](#kind)
- [Segurança](#seguranca)
- [Observabilidade](#observabilidade)
- [CI](#ci)
- [Troubleshooting](#troubleshooting)
- [Decisões técnicas](#decisoes)

<a id="requisitos"></a>

## Requisitos do desafio

| Requisito | Como foi atendido |
| --- | --- |
| Quatro operações | `GET /api/sum`, `/api/sub`, `/api/mul`, `/api/div` com `term_one` e `term_two`. Resposta `{"result": N}`, exata para inteiros e decimais ([detalhes](#api)). |
| Node.js e NestJS | Node 22, NestJS 11. Imagem final distroless, usuário 65532. |
| Porta 8000 | `PORT=8000`. O processo escuta em `0.0.0.0`. |
| Só dentro do cluster | Service `ClusterIP`, sem Ingress, NodePort ou LoadBalancer. NetworkPolicy default-deny e allow só de Pods do cluster. |
| Healthcheck | `GET /health/live` e `GET /health/ready`, usados pelas probes. |
| Testes e cobertura | `npm run test:cov` exige 100% e grava HTML, LCOV, Cobertura e JUnit. |
| Deploy e remoção documentados | `make deploy` / `kubectl apply -k k8s/` e `make undeploy` / `kubectl delete -k k8s/`. |
| Alterar e subir de novo | `make redeploy TAG=1.1.1`, com rollback. |

<a id="estrutura"></a>

## Estrutura do projeto

```text
calculador-api/
├── src/
│   ├── main.ts                      # entrypoint: node dist/main.js
│   ├── bootstrap.ts                 # escuta 0.0.0.0 e enableShutdownHooks
│   ├── app.module.ts
│   ├── app.setup.ts                 # prefixo /api, helmet, validação, Swagger
│   ├── calculator/                  # /api/sum|sub|mul|div
│   ├── health/                      # /health/live e /health/ready
│   ├── common/logging/              # JSON, traceId, access log
│   ├── common/filters/              # corpo de erro padronizado
│   └── config/                      # PORT, NODE_ENV, LOG_LEVEL, SWAGGER_ENABLED, SERVICE_NAME, HEALTH_HEAP_THRESHOLD_MB
├── test/                            # e2e (app.e2e-spec.ts, unhandled-exception.e2e-spec.ts)
├── k8s/                             # kubectl apply -k k8s/
│   └── local/kind-config.yaml       # só para kind; não entra no apply
├── scripts/
│   ├── prepare-overlay.sh           # cópia temporária com a imagem do deploy
│   ├── smoke-test.sh
│   ├── check-exposure.sh
│   └── make-help.awk
├── .github/workflows/ci.yml
├── Dockerfile
├── .dockerignore
├── Makefile
├── jest.config.ts
└── package.json
```

O namespace dos manifestos é `calculador`. A URL interna é:

```text
http://calculador-api.calculador.svc.cluster.local:8000
```

<a id="pre-requisitos"></a>

## Pré-requisitos

- Docker com Buildx (Docker Desktop no macOS já inclui binfmt/QEMU para imagem multi-arch).
- `kubectl` 1.25 ou mais novo, com Kustomize embutido. Não precisa do binário `kustomize`.
- `make` e `bash`.
- Um cluster cujo CNI aplique NetworkPolicy (Calico, Cilium, kindnet do kind 0.24+, a maioria dos clusters gerenciados com a política habilitada).
- Node.js 22 só para desenvolver sem Docker. Os alvos `make reports`, `make docker-build` e `make release` não precisam de Node na máquina.
- `kind`, se for usar o cluster local.
- Conta num registry para publicar a imagem. Os exemplos usam `ghcr.io/brunoaquino`. Troque `REGISTRY` pelo seu usuário.

`make` ou `make help` lista os alvos. Variáveis do Make (todas opcionais):

| Variável | Padrão | Uso |
| --- | --- | --- |
| `REGISTRY` | `ghcr.io/brunoaquino` | registry e namespace da imagem |
| `IMAGE_NAME` | `calculador-api` | nome da imagem |
| `TAG` | versão do `package.json` (`1.1.0`) | tag |
| `IMAGE` | `$(REGISTRY)/$(IMAGE_NAME):$(TAG)` | referência completa |
| `PLATFORMS` | `linux/amd64,linux/arm64` | plataformas do `make release` |
| `NAMESPACE` | `calculador` | namespace dos comandos `kubectl` |
| `KIND_CLUSTER` | `calculador` | nome do cluster kind |
| `PULL_SECRET` | vazio | `imagePullSecret` opcional |
| `CLIENT_NAMESPACE` | `default` | namespace do Pod cliente do smoke test |
| `ROLLOUT_TIMEOUT` | `120s` | espera do rollout |

`NAMESPACE` tem de continuar `calculador`, que é o valor em `k8s/kustomization.yaml`.

<a id="local"></a>

## Testar localmente

Entre na pasta do repositório. Há três caminhos, do mais rápido ao mais parecido com a avaliação. O shell exato de cada `make` está em [Alvos do Make](#make).

### 1. Testes e cobertura

Confere lint e a meta de 100% sem subir a API. Precisa de Node.js 22.

```bash
make install
make lint
make test-cov
open coverage/lcov-report/index.html
```

| Comando | O que executa | Por quê |
| --- | --- | --- |
| `make install` | `npm ci` | Instala as versões travadas no `package-lock.json`, as mesmas do CI e da imagem. |
| `make lint` | `npm run lint` → `eslint "{src,test}/**/*.ts" --max-warnings 0` | Falha se o ESLint achar erro ou warning. |
| `make test-cov` | `npm run test:cov` → `jest --coverage` | Roda unitários e e2e. Exige 100% de statements, branches, functions e lines. Grava `coverage/` e `reports/junit.xml`. |

No Linux troque `open` por `xdg-open`.

### 2. API na sua máquina

Sobe o processo na porta 8000 do seu computador para chamar com `curl` ou abrir o Swagger. Isso vale só para desenvolvimento. No cluster o Service continua `ClusterIP` e essa porta não existe fora dele.

Com Node.js 22, em um terminal:

```bash
make run
```

`make run` executa `npm run start:dev`, que é `nest start --watch`. O Nest recompila ao salvar um arquivo. Sem `NODE_ENV`, o padrão é `development` e o log sai colorido. Para o mesmo JSON do cluster:

```bash
NODE_ENV=production LOG_LEVEL=info npm run start:dev
```

Para testar a imagem em vez do Node local:

```bash
make docker-build
make docker-run
```

`make docker-build` executa `docker buildx build --load --target runtime` e carrega no Docker a imagem da arquitetura da sua máquina (`linux/arm64` no Apple Silicon), com a tag padrão `ghcr.io/brunoaquino/calculador-api:1.1.0`. `--load` existe para o `docker run` e para o kind usarem essa imagem. Essa tag local não serve para um cluster amd64.

`make docker-run` executa `docker run --rm --name calculador-api -p 8000:8000` com `NODE_ENV=production`. O `-p 8000:8000` publica a porta 8000 do host só para esse teste da imagem. Ctrl+C encerra o container e o `--rm` apaga ele.

Com a API no ar, em outro terminal:

```bash
curl -sS "http://127.0.0.1:8000/api/sub?term_one=4&term_two=1"
curl -sS "http://127.0.0.1:8000/api/sum?term_one=2&term_two=3"
curl -sS "http://127.0.0.1:8000/api/mul?term_one=3&term_two=4"
curl -sS "http://127.0.0.1:8000/api/div?term_one=5&term_two=2"
curl -sS -i "http://127.0.0.1:8000/api/div?term_one=1&term_two=0"
curl -sS "http://127.0.0.1:8000/health/live"
curl -sS "http://127.0.0.1:8000/health/ready"
```

A subtração devolve `{"result":3}`. A divisão por zero devolve HTTP 400. O Swagger fica em [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs). Ctrl+C no terminal da API encerra o processo.

### 3. Cluster kind

Este é o fluxo do avaliador: a API só responde de dentro do cluster. Um comando faz a sequência inteira.

```bash
make local-e2e
```

`make local-e2e` executa, nesta ordem, `make kind-up`, `make docker-build`, `make kind-load`, `make deploy` e `make smoke-test`. O motivo de cada um:

| Comando | O que executa | Por quê |
| --- | --- | --- |
| `make kind-up` | `kind create cluster --name calculador --config k8s/local/kind-config.yaml` | Cria o cluster local. Se ele já existe, o alvo só avisa e segue. |
| `make docker-build` | `docker buildx build --load --target runtime` | Gera a imagem da arquitetura da máquina, a mesma do nó kind. |
| `make kind-load` | `kind load docker-image ghcr.io/brunoaquino/calculador-api:1.1.0 --name calculador` | Coloca essa imagem dentro do nó. O kind não puxa tag local do Docker sozinho. |
| `make deploy` | `scripts/prepare-overlay.sh` e depois `kubectl apply -k` e `kubectl rollout status` | Sobe os manifestos com a imagem local, sem editar arquivo versionado, e espera os Pods ficarem prontos. |
| `make smoke-test` | `bash scripts/smoke-test.sh` | Sobe um Pod `curl` no namespace `default` e chama a API pelo DNS interno. |

O mesmo caminho, comando por comando:

```bash
make kind-up
make docker-build
make kind-load
make deploy
make smoke-test
make check-exposure
```

`make smoke-test` imprime `PASS` ou `FAIL` para health, as quatro operações, divisão por zero, entrada inválida e o header `x-trace-id`. `make check-exposure` executa `bash scripts/check-exposure.sh` e confirma Service `ClusterIP`, sem Ingress, `hostNetwork` ou `hostPort`.

O kind não publica a porta 8000. Para o Swagger, com o kubeconfig do cluster:

```bash
make port-forward
```

Isso executa `kubectl -n calculador port-forward svc/calculador-api 8000:8000`. Abra [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs). O tráfego passa pelo API server. Quem não administra o cluster não chega nessa porta.

Logs, até Ctrl+C:

```bash
make logs
```

Isso executa `kubectl -n calculador logs -l app.kubernetes.io/name=calculador-api --all-containers=true -f --prefix=true`.

Para remover a aplicação e apagar o cluster:

```bash
make undeploy
make kind-down
```

`make undeploy` executa `kubectl delete -k k8s/ --ignore-not-found` e apaga o namespace `calculador`. `make kind-down` executa `kind delete cluster --name calculador`.

<a id="make"></a>

## Alvos do Make

`make` e `make help` listam os alvos. O `help` executa um `printf` com as variáveis resolvidas e `awk -f scripts/make-help.awk Makefile`. Os caminhos abaixo usam a raiz do repositório, que o Makefile calcula sozinho. Os valores são os padrões: imagem `ghcr.io/brunoaquino/calculador-api:1.1.0`, namespace `calculador`, cluster kind `calculador`.

### Desenvolvimento

**`make install`** — deixa o `node_modules` igual ao lockfile, para o teste local bater com o CI.

```bash
npm --prefix <raiz> ci
```

**`make lint`** — barra erro e warning do ESLint antes do commit e no CI.

```bash
npm --prefix <raiz> run lint
# eslint "{src,test}/**/*.ts" --max-warnings 0
```

**`make test`** — roda a suíte Jest (unitários e e2e) sem exigir o relatório de cobertura.

```bash
npm --prefix <raiz> test
# jest
```

**`make test-cov`** — a mesma suíte com a meta de 100%. O comando falha se a cobertura cair. Grava o HTML, o LCOV, o Cobertura, o resumo JSON e o JUnit.

```bash
npm --prefix <raiz> run test:cov
# jest --coverage
```

**`make run`** — sobe a API em modo desenvolvimento, com reload, em `http://127.0.0.1:8000`.

```bash
npm --prefix <raiz> run start:dev
# nest start --watch
```

**`make reports`** — gera os mesmos relatórios dentro do Docker e copia para `reports-out/`. Serve para quem não tem Node instalado. Apaga `reports-out/` antes, para não misturar com uma execução antiga.

```bash
rm -rf reports-out
mkdir -p reports-out
docker build --target reports --output type=local,dest=./reports-out .
```

O alvo `reports` do Dockerfile para no estágio de testes (`FROM scratch` com `coverage/` e `reports/`). A imagem de runtime não é o resultado desse comando.

### Imagem

**`make docker-build`** — constrói a imagem da arquitetura da máquina e carrega no Docker local. É a imagem do `make docker-run` e do kind. Não publica no registry e não gera amd64.

```bash
docker buildx build \
  --load \
  --target runtime \
  --tag ghcr.io/brunoaquino/calculador-api:1.1.0 \
  --build-arg VERSION=1.1.0 \
  --build-arg SOURCE=https://github.com/brunoaquino/calculador-api \
  .
```

**`make docker-run`** — sobe essa imagem na porta 8000 do host para um teste rápido. `--rm` apaga o container ao encerrar. Ctrl+C para o processo. No cluster essa publicação de porta não existe.

```bash
docker run --rm --name calculador-api \
  -p 8000:8000 \
  -e PORT=8000 \
  -e NODE_ENV=production \
  -e LOG_LEVEL=info \
  -e SWAGGER_ENABLED=true \
  -e SERVICE_NAME=calculador-api \
  ghcr.io/brunoaquino/calculador-api:1.1.0
```

**`make docker-push`** e **`make release`** — `release` só chama `docker-push`. Publica `linux/amd64` e `linux/arm64` no registry. Um Mac Apple Silicon produz arm64 no `docker-build`. Um nó amd64 recusa essa imagem com `exec format error`. O push multi-arch evita isso. Na primeira vez o Make cria o builder `calculador-builder`.

```bash
docker buildx inspect calculador-builder >/dev/null 2>&1 \
  || docker buildx create --name calculador-builder --driver docker-container
docker buildx inspect --bootstrap calculador-builder >/dev/null
docker buildx build \
  --builder calculador-builder \
  --platform linux/amd64,linux/arm64 \
  --target runtime \
  --tag ghcr.io/brunoaquino/calculador-api:1.1.0 \
  --build-arg VERSION=1.1.0 \
  --build-arg SOURCE=https://github.com/brunoaquino/calculador-api \
  --push \
  .
```

Troque o destino com `make release REGISTRY=ghcr.io/SEU_USUARIO TAG=1.1.0`.

**`make image-digest`** — imprime o digest do índice multi-arch de `IMAGE` no registry, para pinar o deploy por digest em vez de tag. Uma tag pode ser sobrescrita; o digest não.

```bash
docker buildx imagetools inspect ghcr.io/brunoaquino/calculador-api:1.1.0 --format '{{json .Manifest}}' \
  | awk -F'"' '/"digest"/ { print $4; exit }'
```

### Kubernetes

**`make deploy`** — aplica os manifestos com a imagem `IMAGE` e espera o rollout. Não edita arquivo versionado: o Kustomize do `kubectl` recusa um overlay em `/tmp` que aponte para `k8s/` fora dessa pasta, então o script copia `k8s/`, reescreve `newName`/`newTag`/`digest` e grava a anotação `calculador.dev/deployed-at` para recriar os Pods. `IMAGE=repo:tag` remove o digest da cópia; `IMAGE=repo@sha256:...` grava o digest. O `trap` apaga a cópia ao terminar.

```bash
tmp=$(IMAGE=ghcr.io/brunoaquino/calculador-api:1.1.0 \
  PULL_SECRET= \
  K8S_DIR=<raiz>/k8s \
  bash <raiz>/scripts/prepare-overlay.sh)
kubectl apply -k "$tmp"
kubectl -n calculador rollout status deploy/calculador-api --timeout=120s
```

`PULL_SECRET=ghcr-pull` acrescenta `imagePullSecrets` nessa cópia quando o registry é privado.

**`make status`** — mostra se o Deployment, os Pods, o Service, as NetworkPolicies e o PDB subiram.

```bash
kubectl -n calculador get deploy,pods,svc,networkpolicy,pdb -o wide
```

**`make logs`** — acompanha o stdout de todos os containers da API, com o nome do Pod em cada linha, até Ctrl+C.

```bash
kubectl -n calculador logs -l app.kubernetes.io/name=calculador-api --all-containers=true -f --prefix=true
```

**`make smoke-test`** — prova a API pelo caminho real: um Pod cliente em outro namespace, porque o egress de `calculador` é negado e a API não tem endereço externo.

```bash
NAMESPACE=calculador CLIENT_NAMESPACE=default CURL_IMAGE=curlimages/curl:8.23.0 \
  bash scripts/smoke-test.sh
```

**`make check-exposure`** — falha se alguém trocar o Service para NodePort ou LoadBalancer, ou criar Ingress, `hostNetwork` ou `hostPort`.

```bash
NAMESPACE=calculador bash scripts/check-exposure.sh
```

**`make port-forward`** — leva o Service até `127.0.0.1:8000` para o Swagger de quem administra o cluster. Não cria Ingress nem muda o tipo do Service.

```bash
kubectl -n calculador port-forward svc/calculador-api 8000:8000
```

**`make undeploy`** — remove a aplicação inteira, inclusive o namespace. `--ignore-not-found` permite rodar de novo com o cluster já limpo.

```bash
kubectl delete -k k8s/ --ignore-not-found
```

**`make redeploy`** — ciclo de “alterei a API e subi de novo”: publica a imagem multi-arch e aplica no cluster. Use uma tag nova (`TAG=1.1.1`), porque `imagePullPolicy` é `IfNotPresent`.

```bash
make release
make deploy
```

**`make rollback`** — volta o Deployment para a revisão anterior e espera essa revisão ficar pronta.

```bash
kubectl -n calculador rollout undo deploy/calculador-api
kubectl -n calculador rollout status deploy/calculador-api --timeout=120s
```

### Kind

**`make kind-up`** — cria o cluster local com um control-plane. A config `k8s/local/kind-config.yaml` não entra no `kubectl apply -k k8s/`. Se o cluster já existe, o alvo só imprime o aviso e segue.

```bash
if kind get clusters | grep -qx calculador; then
  printf '%s\n' "Cluster kind 'calculador' já existe."
else
  kind create cluster --name calculador --config k8s/local/kind-config.yaml
fi
```

**`make kind-load`** — copia a imagem do Docker local para o nó. Sem isso o kubelet procura a tag no registry e cai em `ImagePullBackOff` ou sobe outra versão.

```bash
kind load docker-image ghcr.io/brunoaquino/calculador-api:1.1.0 --name calculador
```

**`make kind-down`** — apaga o cluster kind e os containers dele. Não mexe em outro cluster do `kubectl`. Se o cluster já não existe, só avisa.

```bash
if kind get clusters | grep -qx calculador; then
  kind delete cluster --name calculador
else
  printf '%s\n' "Cluster kind 'calculador' não existe."
fi
```

**`make local-e2e`** — um comando para o ciclo local completo: cluster, imagem da máquina, carga no nó, deploy e smoke test.

```bash
make kind-up
make docker-build
make kind-load
make deploy
make smoke-test
```

<a id="api"></a>

## API

| Método | Caminho | Sucesso |
| --- | --- | --- |
| GET | `/api/sum?term_one=&term_two=` | 200 `{"result": N}` |
| GET | `/api/sub?term_one=&term_two=` | 200 `{"result": N}` |
| GET | `/api/mul?term_one=&term_two=` | 200 `{"result": N}` |
| GET | `/api/div?term_one=&term_two=` | 200 `{"result": N}` |
| GET | `/health/live` | 200, `"status": "ok"` |
| GET | `/health/ready` | 200, `"status": "ok"` |
| GET | `/docs` | Swagger UI |
| GET | `/docs-json` | OpenAPI JSON |

Exemplos:

```bash
curl -sS "http://127.0.0.1:8000/api/sum?term_one=2&term_two=3"
# {"result":5}

curl -sS "http://127.0.0.1:8000/api/sub?term_one=4&term_two=1"
# {"result":3}

curl -sS "http://127.0.0.1:8000/api/mul?term_one=3&term_two=4"
# {"result":12}

curl -sS "http://127.0.0.1:8000/api/div?term_one=10&term_two=2"
# {"result":5}

curl -sS "http://127.0.0.1:8000/api/div?term_one=5&term_two=2"
# {"result":2.5}

curl -sS "http://127.0.0.1:8000/api/sum?term_one=1e2&term_two=1"
# {"result":101}

curl -sS "http://127.0.0.1:8000/api/sum?term_one=-2&term_two=0.5"
# {"result":-1.5}

curl -sS "http://127.0.0.1:8000/api/sum?term_one=0.1&term_two=0.2"
# {"result":0.3}

curl -sS "http://127.0.0.1:8000/api/div?term_one=1&term_two=3"
# {"result":0.333333333333333}

curl -sS "http://127.0.0.1:8000/health/live"
# {"status":"ok","info":{"process":{"status":"up"}},"error":{},"details":{"process":{"status":"up"}}}

curl -sS "http://127.0.0.1:8000/health/ready"
# {"status":"ok","info":{"memory_heap":{"status":"up"}},"error":{},"details":{"memory_heap":{"status":"up"}}}

curl -sS -i "http://127.0.0.1:8000/api/div?term_one=10&term_two=0"
```

### Resultado inteiro ou decimal

O enunciado mostra `result` como inteiro (`<int:result>`). Isso só fecha com operandos inteiros e conta sem fração. `5/2`, ou qualquer operando decimal, produz um número não inteiro. O teste não define esse caso, então a API aceita os dois e nunca responde HTTP 200 com um número errado:

- Inteiro entra e sai exato: `4 - 1` é `3`.
- Decimal é calculado em aritmética decimal (`decimal.js`), não em ponto flutuante: `0.1 + 0.2` é `0.3`, `1.1 * 1.1` é `1.21`, `0.3 / 0.1` é `3`.
- Resultado com fração que não termina é arredondado em 15 dígitos significativos, half-even: `1/3` é `0.333333333333333`, `2/3` é `0.666666666666667`. Quinze dígitos é o máximo que sempre volta igual depois de virar o número do JSON (um double IEEE-754).

### Validação

Operandos:

- Decimais, negativos e notação científica são aceitos (`-3`, `2.5`, `1e2`).
- Vazio, espaço, texto, hexadecimal (`0x10`), binário, octal, `NaN`, `Infinity` e estouro (`1e400`) respondem 400 com `<termo> must be a finite decimal number`.
- O valor absoluto vai até `9007199254740991` (`Number.MAX_SAFE_INTEGER`). Acima disso o double já não guarda todo inteiro, e `9007199254740993` viraria `...992` em silêncio. Responde 400 com `<termo> must be between -9007199254740991 and 9007199254740991`.
- Um operando diferente de zero que o double arredonda para zero, como `1e-400`, responde 400 com `<termo> underflows to zero`. Sem essa regra, `/api/div?term_one=1&term_two=1e-400` cairia em “divisão por zero” sem o divisor ser zero.
- Um operando com mais dígitos do que o double guarda, como `0.30000000000000001`, responde 400 com `<termo> has more significant digits than a 64-bit float can represent exactly`.

Nesses casos `message` é uma lista, por exemplo `["term_two underflows to zero"]`.

Resultado:

- Divisão por zero responde 400 com `Division by zero is not allowed`.
- Resultado acima de `9007199254740991` em valor absoluto, como `3000000000 * 4000000000` ou `9007199254740991 + 1`, responde 400 com `Operation result exceeds the safe range of -9007199254740991 to 9007199254740991`.
- Resultado diferente de zero pequeno demais para o double, como `1e-200 * 1e-200`, responde 400 com `Operation result is too small to be represented exactly`.

Corpo de erro:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Division by zero is not allowed",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "path": "/api/div",
  "timestamp": "2026-11-06T21:00:00.000Z"
}
```

Em erro de validação, `message` pode ser uma lista, por exemplo `["term_two must be a finite decimal number"]`. `path` não inclui a query string. Falha inesperada responde 500 com mensagem genérica. O stack fica só no log.

<a id="swagger"></a>

## Swagger

A UI fica em `/docs` e o OpenAPI em `/docs-json`. Os dois ficam fora do prefixo `/api`. `SWAGGER_ENABLED=true` no ConfigMap liga os dois. Com `false`, as rotas não são montadas.

Dentro do cluster, depois do deploy:

```bash
make port-forward
```

Em outro terminal:

```bash
open http://127.0.0.1:8000/docs
curl -sS http://127.0.0.1:8000/docs-json
```

No Linux use `xdg-open` no lugar de `open`. De outro Pod a URL é `http://calculador-api.calculador.svc.cluster.local:8000/docs`.

O `port-forward` não publica a API. O tráfego passa pelo API server, com o kubeconfig e a permissão RBAC `pods/portforward`. O Service continua `ClusterIP`. Quem não administra o cluster não chega nessa porta.

<a id="testes"></a>

## Testes e cobertura

Com Node 22:

```bash
make test
make test-cov
make lint
```

`npm run test:cov` (o alvo `make test-cov`) roda a suíte Jest, exige 100% de statements, branches, functions e lines, e grava:

| Arquivo | Conteúdo |
| --- | --- |
| `coverage/lcov-report/index.html` | relatório HTML |
| `coverage/lcov.info` | LCOV |
| `coverage/cobertura-coverage.xml` | Cobertura XML |
| `coverage/coverage-summary.json` | resumo JSON |
| `reports/junit.xml` | JUnit |

Abra o HTML com `open coverage/lcov-report/index.html`. Se a cobertura cair, o comando termina com erro.

Os e2e estão em `test/app.e2e-spec.ts` (rotas, validação, precisão, health, Swagger, traceId) e `test/unhandled-exception.e2e-spec.ts` (500 correlacionado no log):

```bash
npm run test:e2e
```

Sem Node instalado, o estágio Docker `reports` roda a mesma cobertura e exporta os arquivos:

```bash
make reports
open reports-out/coverage/lcov-report/index.html
```

Saídas:

- `reports-out/coverage/lcov-report/index.html`
- `reports-out/coverage/lcov.info`
- `reports-out/coverage/cobertura-coverage.xml`
- `reports-out/coverage/coverage-summary.json`
- `reports-out/reports/junit.xml`

`coverage/`, `reports/` e `reports-out/` estão no `.gitignore`.

No GitHub Actions o job de testes envia o artifact `calculador-reports` com `coverage/` e `reports/junit.xml`, e escreve um resumo na página da execução.

<a id="logs"></a>

## Logs estruturados

Em produção cada linha do stdout é um objeto JSON. Toda linha tem `level` (texto, não o número do Pino), `time` (ISO-8601), `pid`, `hostname`, `service`, `version`, `env`, `traceId` e `msg`. No Kubernetes, `hostname` é o nome do Pod. O access log acrescenta `req` (`method`, `url`, `remoteAddress`, `userAgent`), `res.statusCode` e `responseTime`. Log da aplicação também traz `context`. Log sem request, como o de boot, usa `traceId` `system`.

`/health/*` e `/docs` não geram access log.

Exemplo de access log:

```json
{"level":"info","time":"2026-11-07T03:58:40.120Z","pid":1,"hostname":"calculador-api-7d4f8c9b5-abcde","traceId":"avaliador-123","req":{"method":"GET","url":"/api/sum?term_one=2&term_two=3","remoteAddress":"10.244.0.12","userAgent":"curl/8.7.1"},"service":"calculador-api","version":"1.1.0","env":"production","res":{"statusCode":200},"responseTime":3,"msg":"request completed"}
```

Cada conta também gera, em `info`, uma linha da aplicação com o mesmo `traceId`. Assim um `jq` pelo `traceId` mostra a request e o resultado calculado:

```json
{"level":"info","time":"2026-11-07T03:58:40.118Z","pid":1,"hostname":"calculador-api-7d4f8c9b5-abcde","traceId":"avaliador-123","service":"calculador-api","version":"1.1.0","env":"production","context":"CalculatorService","operation":"sum","termOne":2,"termTwo":3,"result":5,"msg":"Calculation completed"}
```

Uma exceção não tratada gera uma linha `error` com o `traceId` da request, o mesmo do access log e do header `x-trace-id`. O stack vai em `err.stack` e não aparece no corpo do 500 (`Internal server error`). O filtro global (`GlobalExceptionFilter`, registrado como `APP_FILTER`) loga pelo logger que o pino-http liga à request:

```json
{"level":"error","time":"2026-11-07T17:09:29.928Z","pid":1,"hostname":"calculador-api-7d4f8c9b5-abcde","traceId":"4bf92f3577b34da6a3ce929d0e0e4736","service":"calculador-api","version":"1.1.0","env":"production","err":{"type":"Error","message":"disk failed","stack":"Error: disk failed\n    at ..."},"context":"GlobalExceptionFilter","msg":"Unhandled exception"}
```

Erros 4xx não geram essa linha. O access log já registra esses casos em `warn`.

O `traceId` segue esta ordem:

1. `traceparent` W3C válido. Vale o trace-id de 32 hex no meio do header, em minúsculas. Um trace-id só com zeros é ignorado.
2. `x-trace-id`, se tiver de 1 a 128 caracteres entre letras, dígitos, `_` e `-`.
3. `x-request-id`, com a mesma regra.
4. Um id gerado pela API.

A resposta sempre devolve o header `x-trace-id`.

```bash
curl -sS -D - -o /dev/null \
  -H "traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" \
  "http://127.0.0.1:8000/api/sum?term_one=2&term_two=3"
```

O header de resposta é `x-trace-id: 4bf92f3577b34da6a3ce929d0e0e4736`.

No cluster, `make logs` acompanha o stdout até Ctrl+C. Para filtrar um trace e sair:

```bash
kubectl -n calculador logs -l app.kubernetes.io/name=calculador-api --tail=200 \
  | jq 'select(.traceId=="smoke-trace-1")'
```

`make run` em desenvolvimento pode imprimir texto colorido em vez de JSON. A imagem e o cluster usam JSON, porque `NODE_ENV=production` e a imagem não traz o `pino-pretty`.

<a id="imagem"></a>

## Publicar a imagem

A imagem final é multi-stage. O estágio padrão é o runtime distroless. `make docker-build` gera só a arquitetura da sua máquina e carrega no Docker local. `make release` (atalho de `make docker-push`) gera `linux/amd64` e `linux/arm64` e envia ao registry.

Num Mac Apple Silicon, `docker build` comum produz `linux/arm64`. Um nó `linux/amd64` recusa essa imagem com `exec format error` (em geral `exec /nodejs/bin/node: exec format error`). Não faça `docker push` da imagem local. Use `make release`.

O builder `calculador-builder` (driver `docker-container`) é criado na primeira publicação. Docker Desktop já registra o binfmt. Se o build amd64 falhar num Linux sem QEMU:

```bash
docker run --privileged --rm tonistiigi/binfmt --install all
```

### GHCR

O token precisa de `write:packages` e `read:packages`. O nome da imagem no GHCR é minúsculo.

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u SEU_USUARIO --password-stdin
make release REGISTRY=ghcr.io/SEU_USUARIO TAG=1.1.0
```

O pacote é privado por padrão. Ou torne o pacote público em GitHub → Packages → Package settings → Change visibility, ou crie um secret no cluster. Crie o namespace antes do secret:

```bash
kubectl apply -f k8s/namespace.yaml
kubectl create secret docker-registry ghcr-pull \
  --namespace calculador \
  --docker-server=ghcr.io \
  --docker-username=SEU_USUARIO \
  --docker-password="$GITHUB_TOKEN" \
  --docker-email=SEU_EMAIL \
  --dry-run=client -o yaml | kubectl apply -f -

make deploy REGISTRY=ghcr.io/SEU_USUARIO TAG=1.1.0 PULL_SECRET=ghcr-pull
```

`PULL_SECRET` adiciona `imagePullSecrets` na hora do apply. O arquivo `k8s/deployment.yaml` não é editado.

### Docker Hub

```bash
docker login
make release REGISTRY=docker.io/SEU_USUARIO TAG=1.1.0
make deploy REGISTRY=docker.io/SEU_USUARIO TAG=1.1.0
```

Repositório público não precisa de secret.

### ECR

```bash
aws ecr create-repository --repository-name calculador-api --region us-east-1
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com

make release REGISTRY=123456789012.dkr.ecr.us-east-1.amazonaws.com TAG=1.1.0
make deploy REGISTRY=123456789012.dkr.ecr.us-east-1.amazonaws.com TAG=1.1.0 PULL_SECRET=ecr-pull
```

O token do `docker login` na ECR expira em 12 horas. Em EKS o caminho durável é a role do nó, não um secret de longa duração. O secret acima serve para um teste curto. Crie `ecr-pull` com `kubectl create secret docker-registry`, no mesmo formato do GHCR, usando `--docker-server` do registry da conta.

<a id="deploy"></a>

## Deploy no Kubernetes

`make deploy` não altera arquivos do repositório. Ele copia `k8s/` para um diretório temporário, troca `images.newName` e `images.newTag`, grava a anotação `calculador.dev/deployed-at` para recriar os Pods e roda `kubectl apply -k` nessa cópia. Em seguida espera o rollout.

```bash
make deploy TAG=1.1.0
kubectl -n calculador rollout status deploy/calculador-api --timeout=120s
kubectl -n calculador get pods,svc
```

O `rollout status` já faz parte de `make deploy`. O comando de cima serve para repetir a espera.

Sem Make, edite o bloco no fim de `k8s/kustomization.yaml`:

```yaml
images:
  - name: calculador-api
    newName: ghcr.io/SEU_USUARIO/calculador-api
    newTag: "1.1.0"
    digest: sha256:...
```

O repositório já vem pinado no digest da imagem `1.1.0` publicada pelo CI. Com `digest`, o kustomize ignora `newTag` e o nó baixa exatamente aquela imagem, mesmo que alguém sobrescreva a tag no registry. Ao trocar de registry, apague a linha `digest` ou troque pelo digest da sua imagem (`make image-digest IMAGE=...`).

`make deploy` aceita os dois formatos. `IMAGE=repo:tag` aplica só a tag e remove o digest da cópia. `IMAGE=repo@sha256:...` ou `IMAGE=repo:tag@sha256:...` aplica o digest:

```bash
make deploy IMAGE=ghcr.io/brunoaquino/calculador-api:1.1.0@$(make -s image-digest)
```

```bash
kubectl apply -k k8s/
kubectl -n calculador rollout status deploy/calculador-api --timeout=120s
```

Use `kubectl apply -k`. `kubectl apply -f k8s/` não aplica o namespace do Kustomize e mistura os recursos no namespace `default`.

Confira a exposição:

```bash
make check-exposure
make status
```

O que sobe: namespace `calculador` com Pod Security `restricted`, ServiceAccount sem token, ConfigMap, Deployment com 2 réplicas, Service `ClusterIP`, NetworkPolicy e PodDisruptionBudget `minAvailable: 1`. Não há Ingress.

<a id="acesso"></a>

## Acessar e testar

A API não tem endereço fora do cluster. O teste oficial entra com um Pod cliente no namespace `default` e chama o DNS interno. O namespace `calculador` nega egress de todos os Pods, então um `curl` lançado dentro dele não consegue abrir conexão. Use outro namespace.

```bash
make smoke-test
```

O script confere ClusterIP, ausência de Ingress, `hostNetwork` e `hostPort`. Depois sobe `curlimages/curl:8.23.0` com securityContext compatível com Pod Security `restricted` e valida:

- `GET /health/ready` → 200 e `"status": "ok"`
- soma `2+3=5`, subtração `4-1=3`, multiplicação `3*4=12`, divisão `10/2=5`
- divisão por zero → 400 com `statusCode`, `error`, `message`, `traceId`, `path` e `timestamp`
- `term_two=abc` → 400 no mesmo formato
- header `x-trace-id: smoke-trace-1` ecoado na resposta

Cada checagem imprime `PASS` ou `FAIL`. Qualquer falha termina com exit code diferente de zero e apaga o Pod cliente.

Chamada manual, também a partir do namespace `default`:

```bash
kubectl run tmp-curl --rm -it --restart=Never \
  --namespace=default \
  --image=curlimages/curl:8.23.0 \
  --command -- \
  curl -sS "http://calculador-api.calculador.svc.cluster.local:8000/api/sub?term_one=4&term_two=1"
```

`--command` troca o ENTRYPOINT da imagem, que já é `curl`. Sem isso o processo vira `curl curl ...`. Se o namespace `default` também estiver em Pod Security `restricted` e rejeitar esse Pod simples, use `make smoke-test`.

Swagger para quem administra o cluster: `make port-forward`, como na seção Swagger.

<a id="alterar"></a>

## Alterar e republicar

1. Edite o código em `src/`.
2. Rode `make test-cov`.
3. Publique uma tag nova e faça o deploy. Tag nova importa: `imagePullPolicy` é `IfNotPresent`, então o nó não baixa de novo uma tag que já tem.

```bash
make redeploy TAG=1.1.1
make smoke-test
```

`make redeploy` é `make release` seguido de `make deploy`, e já espera o rollout. Para só repetir a espera:

```bash
kubectl -n calculador rollout status deploy/calculador-api --timeout=120s
```

Voltar a revisão anterior:

```bash
make rollback
```

No kind, sem registry, a mesma tag serve porque `kind load` substitui a imagem no nó e `make deploy` recria os Pods:

```bash
make docker-build
make kind-load
make deploy
make smoke-test
```

Mudou só o ConfigMap? Os Pods não recarregam env sozinhos:

```bash
kubectl -n calculador rollout restart deploy/calculador-api
kubectl -n calculador rollout status deploy/calculador-api --timeout=120s
```

<a id="remover"></a>

## Remover

```bash
make undeploy
```

O mesmo efeito, inclusive o namespace:

```bash
kubectl delete -k k8s/ --ignore-not-found
```

Se usou kind e quer apagar o cluster local:

```bash
make kind-down
```

<a id="kind"></a>

## Cluster local com kind

O passo a passo, com o shell de cada `make` e o motivo, está em [Testar localmente](#local) e em [Alvos do Make](#make). A sequência é:

```bash
make kind-up
make docker-build
make kind-load
make deploy
make smoke-test
```

Ou um comando só:

```bash
make local-e2e
```

`make kind-up` é idempotente. A config está em `k8s/local/kind-config.yaml` (um control-plane, `kind.x-k8s.io/v1alpha4`). Ela não entra no `kubectl apply -k k8s/`. O kind 0.33 desta documentação usa o kindnetd, que aplica NetworkPolicy padrão. Não mapeie a porta 8000 no kind: o acesso local de administração é o `make port-forward`.

`make docker-build` gera a arquitetura do seu Docker. No Apple Silicon isso é `linux/arm64`, e o nó do kind também é arm64. Não carregue no kind o índice multi-arch do `make release`. Para o cluster remoto amd64, use `make release`.

As duas réplicas cabem num nó só. A anti-affinity é preferida, então não bloqueia o agendamento.

<a id="seguranca"></a>

## Segurança

A API fica dentro do cluster por várias camadas:

- Service `type: ClusterIP`. Não há Ingress, NodePort, LoadBalancer, `hostNetwork` nem `hostPort`.
- NetworkPolicy `default-deny-all` nega ingress e egress de todo Pod do namespace.
- NetworkPolicy `allow-in-cluster-http` libera só TCP 8000 na API, e só com `namespaceSelector: {}`. Isso seleciona Pods. Não há `ipBlock`, então tráfego de fora do cluster não entra, mesmo que alguém crie um Ingress depois.
- Egress da API continua negado. A resposta de quem já conectou passa pelo conntrack. A aplicação não precisa de DNS nem de saída.
- Pods dentro de `calculador` também não abrem conexão de saída. Cliente de teste fica em outro namespace (`default`).
- Namespace com Pod Security Admission `enforce`, `audit` e `warn` em `restricted`.
- Imagem distroless (Debian 13), usuário e grupo 65532, `runAsNonRoot`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, `seccompProfile: RuntimeDefault`, root filesystem somente leitura. `/tmp` é um `emptyDir` de 16Mi (`HOME=/tmp`).
- ServiceAccount dedicada com `automountServiceAccountToken: false` na conta e no Pod. O processo não chama a API do Kubernetes.
- Requests `100m` / `192Mi` e limits `1000m` / `256Mi`, medidos (ver [Observabilidade](#observabilidade)).
- Imagens base do `Dockerfile` pinadas por digest do índice multi-arch. Trivy barra vulnerabilidade HIGH ou CRITICAL com correção, no repositório e na imagem (ver [CI](#ci)).
- Helmet na aplicação. Com Swagger ligado, a CSP fica desligada para a UI carregar. Os outros headers do Helmet permanecem. `x-powered-by` é removido.

Probes do kubelet são tráfego do nó, não de um Pod. Calico, Cilium e o kindnet do kind 0.24+ (incluindo 0.33) deixam esse tráfego passar no default-deny. Não abra `ipBlock: 0.0.0.0/0` para “consertar” probe.

Prova de que o CNI aplica a política, com o cluster no ar. O Pod em `default` recebe `{"result":5}`. O Pod dentro de `calculador` estoura o tempo (`curl: (28) Connection timed out`): o default-deny descarta o egress e a conexão não completa. Os dois Pods usam securityContext compatível com Pod Security `restricted`, porque o namespace `calculador` recusa um Pod sem isso.

```bash
overrides='{"spec":{"automountServiceAccountToken":false,"securityContext":{"runAsNonRoot":true,"runAsUser":65534,"runAsGroup":65534,"seccompProfile":{"type":"RuntimeDefault"}},"containers":[{"name":"PLACE","image":"curlimages/curl:8.23.0","command":["sleep","180"],"securityContext":{"allowPrivilegeEscalation":false,"readOnlyRootFilesystem":true,"runAsNonRoot":true,"runAsUser":65534,"runAsGroup":65534,"capabilities":{"drop":["ALL"]},"seccompProfile":{"type":"RuntimeDefault"}},"volumeMounts":[{"name":"tmp","mountPath":"/tmp"}]}],"volumes":[{"name":"tmp","emptyDir":{"sizeLimit":"16Mi"}}]}}'

kubectl run np-allow --namespace default --image curlimages/curl:8.23.0 --restart=Never \
  --overrides "${overrides/PLACE/np-allow}" --command -- sleep 180
kubectl run np-deny --namespace calculador --image curlimages/curl:8.23.0 --restart=Never \
  --overrides "${overrides/PLACE/np-deny}" --command -- sleep 180
kubectl wait --namespace default --for=condition=Ready pod/np-allow --timeout=120s
kubectl wait --namespace calculador --for=condition=Ready pod/np-deny --timeout=120s

kubectl exec -n default np-allow -- curl -sS --max-time 10 \
  "http://calculador-api.calculador.svc.cluster.local:8000/api/sum?term_one=2&term_two=3"
# {"result":5}

kubectl exec -n calculador np-deny -- curl -sS --max-time 8 \
  "http://calculador-api.calculador.svc.cluster.local:8000/api/sum?term_one=2&term_two=3"
# curl: (28) Connection timed out

kubectl delete pod -n default np-allow --wait=false
kubectl delete pod -n calculador np-deny --wait=false
```

Para aceitar só um namespace cliente, troque o `from` de `k8s/networkpolicy.yaml`:

```yaml
ingress:
  - from:
      - namespaceSelector:
          matchLabels:
            kubernetes.io/metadata.name: pagamentos
    ports:
      - protocol: TCP
        port: 8000
```

`kubernetes.io/metadata.name` existe em todo namespace desde o Kubernetes 1.22. O namespace `default` deixaria de alcançar a API. O smoke test precisaria de `CLIENT_NAMESPACE=pagamentos`.

<a id="observabilidade"></a>

## Observabilidade

| Probe | Caminho | Função |
| --- | --- | --- |
| startup | `/health/live` | até 60s (`periodSeconds: 2`, `failureThreshold: 30`) para o processo subir; liveness e readiness esperam ela |
| readiness | `/health/ready` | sai do Service se o heap usado passar de `HEALTH_HEAP_THRESHOLD_MB` (144) |
| liveness | `/health/live` | checagem barata do processo |

Startup e liveness olham só se o processo responde. Um heap alto tira o Pod do Service pela readiness, sem o kubelet matar o container.

### Memória e CPU

Os valores saíram de medição: container com `--memory=256m` e 50 conexões por 30s (`autocannon`) em `/api/sum`, `/api/div` e `/health/ready` ao mesmo tempo, sem erro e sem OOM.

| Estado | RSS | CPU |
| --- | --- | --- |
| Ocioso | ~117 MiB | ~0m |
| Sob carga | ~141 MiB | ~1350m (pico ~1470m) |

| Recurso | Request | Limit | Por quê |
| --- | --- | --- | --- |
| Memória | `192Mi` | `256Mi` | O request cobre o RSS sob carga com ~20% de folga. Memória não é comprimível, então o scheduler reserva o pico. |
| CPU | `100m` | `1000m` | CPU é comprimível. O request reserva a linha de base sem travar o agendamento em nó pequeno. Com 500m de limit a mesma carga caía de ~6000 para ~2200 req/s, então o limit é 1 CPU. |

A memória segue uma cadeia, para a falha vir na ordem certa:

```text
limit do container 256Mi  >  NODE_OPTIONS=--max-old-space-size=160  >  HEALTH_HEAP_THRESHOLD_MB=144
```

O V8 limita o heap em 160 MiB e faz GC antes de encostar no limit do cgroup, deixando espaço para código, buffers e memória nativa. A readiness falha em 144 MiB (90% de 160), antes do teto do V8 e bem antes do OOM do kernel. `NODE_OPTIONS` e `HEALTH_HEAP_THRESHOLD_MB` estão no `ENV` da imagem e no ConfigMap. `HEALTH_HEAP_THRESHOLD_MB` aceita um inteiro de 1 a 8192. No Jest, `test/jest-setup.ts` sobe o teto para 4096 porque o processo de teste passa de 144 MiB; isso não entra na imagem.

### Disponibilidade

As réplicas preferem nós diferentes (`podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution`, weight 100, `kubernetes.io/hostname`). É preferência, não regra: num cluster de um nó, como o kind, as duas agendam. O Deployment usa RollingUpdate `maxSurge: 1` e `maxUnavailable: 0`. O PDB pede `minAvailable: 1` em disrupção voluntária.

O processo trata `SIGTERM` (`enableShutdownHooks`) e tem 30s para encerrar (`terminationGracePeriodSeconds`). Não há `preStop` com shell: a imagem distroless não tem shell, e o sleep de lifecycle exige Kubernetes 1.30.

Logs: seção [Logs estruturados](#logs). Não há endpoint de métricas.

<a id="ci"></a>

## CI

`.github/workflows/ci.yml` roda em push e pull request:

| Job | O que faz |
| --- | --- |
| Testes | Node 22, `npm ci`, `npm run lint`, `npm run test:cov`. Envia o artifact `calculador-reports` e escreve o resumo da cobertura. |
| Manifestos | `bash -n` nos scripts, `kubectl kustomize k8s/` e kubeconform em modo strict. |
| Segurança | `trivy fs` com `vuln,secret,misconfig` em `HIGH,CRITICAL`, `--ignore-unfixed`, exit code 1. Cobre `package-lock.json`, segredos, `Dockerfile` e manifestos. Envia SARIF para a aba Security do GitHub; falha de upload não derruba o job. |
| Imagem | Só em push na `main` ou em tag `v*`, depois dos três jobs. Constrói `linux/amd64`, escaneia a imagem com Trivy (mesma regra) e só então publica `linux/amd64` e `linux/arm64` em `ghcr.io/<owner>/<repo>`, reusando o cache. Escreve o digest publicado no resumo do job. |

Tags da imagem: o SHA do commit, `latest` na branch padrão, e semver nas tags `v*`. O login usa `GITHUB_TOKEN` com `packages: write`. O workflow não faz deploy no cluster.

Branches e versões:

| Ref | Papel |
| --- | --- |
| `main` | Versão estável e branch padrão. Push publica a imagem `latest` e `sha-<commit>`. |
| `develop` | Integração. Recebe os PRs, inclusive os do Dependabot, e roda Testes, Manifestos e Segurança. Não publica imagem. |
| `v*` (tag) | Release. Publica a imagem semver (`1.1.0`, `1.1`, `1`), que os manifestos pinam por digest. |

Uma versão nova segue esta ordem: suba o `version` do `package.json` na `develop`, leve para a `main` por PR, crie a tag `vX.Y.Z` no merge e, quando o CI publicar, grave o digest novo em `k8s/kustomization.yaml` (`make image-digest`).

Cadeia de suprimentos:

- O scanner é o container oficial `aquasec/trivy:0.76.2`, pinado por digest. O CI e a máquina local rodam o mesmo binário. O `trivy-action` baixaria um Trivy à parte.
- Actions de terceiros pinadas por SHA de commit, com a versão em comentário.
- Imagens base (`node:22-trixie-slim` e `gcr.io/distroless/nodejs22-debian13:nonroot`) pinadas por digest.
- `.github/dependabot.yml` abre PR semanal na `develop` para Docker, GitHub Actions e npm, para os digests e SHAs não envelhecerem. Atualização major (NestJS 12, Node 25) fica de fora: é decisão de projeto, feita à mão.
- `multer` fica em `2.5.0` via `overrides` no `package.json`. A versão que o `@nestjs/platform-express` traz (2.4.0) tem um CVE HIGH.
- `.trivyignore` aceita dois CVEs do `zlib1g` da distroless, com data de expiração. O Debian já corrigiu, mas a distroless ainda não reconstruiu. O binário do Node não linka o `libz` do sistema (usa o zlib embutido, `process.versions.zlib`), então a API não carrega esse pacote. Depois da data, o scan volta a falhar até a base ser atualizada.

Os mesmos scans, na máquina:

```bash
make docker-build
docker run --rm -v "$PWD:/src:ro" \
  aquasec/trivy:0.76.2 fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL \
  --ignore-unfixed --ignorefile /src/.trivyignore --skip-dirs /src/node_modules /src
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$PWD:/src:ro" \
  aquasec/trivy:0.76.2 image --scanners vuln --severity HIGH,CRITICAL \
  --ignore-unfixed --ignorefile /src/.trivyignore ghcr.io/brunoaquino/calculador-api:1.1.0
```

<a id="troubleshooting"></a>

## Troubleshooting

**ImagePullBackOff.** A tag não existe, o nome está errado, ou o GHCR está privado e falta `PULL_SECRET`. Confira `kubectl -n calculador describe pod` e a seção de registry.

**`exec format error`.** A imagem foi construída só para arm64 (Mac) e o nó é amd64. Apague essa tag do registry e publique de novo com `make release TAG=...`, que usa `--platform linux/amd64,linux/arm64`.

**Pod não fica Ready e a probe estoura o tempo.** Veja `kubectl -n calculador describe pod` e `make logs`. Se o CNI não isenta o kubelet, a NetworkPolicy bloqueia a probe. Calico, Cilium e kindnet recente não fazem isso. Não adicione `ipBlock` aberto. Também vale checar crash na subida e `OOMKilled` (suba o limit de memória em `k8s/deployment.yaml` se precisar).

**NetworkPolicy parece não existir.** O CNI não aplica a política (Flannel antigo, kubenet, VPC CNI da EKS sem NetworkPolicy habilitada). O manifesto está certo, mas o cluster não o faz valer. kind 0.33 aplica.

**Smoke test não conecta a partir de `calculador`.** O egress desse namespace é negado. Rode `make smoke-test`, que usa o namespace `default`.

**Rollout não troca o código.** A tag no nó é a mesma e `imagePullPolicy` é `IfNotPresent`. Use uma tag nova. No kind, `make kind-load` e `make deploy`.

**`make reports` falha no `COPY` de `coverage` ou `reports`.** `npm run test:cov` não gerou esses diretórios. Veja o log do Jest dentro do build.

**`kubectl apply -f k8s/` criou recursos no `default`.** Apague o que foi parar no lugar errado e aplique com `-k`.

<a id="decisoes"></a>

## Decisões técnicas

- Aritmética decimal (`decimal.js`) e recusa com 400 do que o double do JSON não guarda. A API aceita inteiro e decimal sem devolver `0.30000000000000004` nem perder dígitos em silêncio.

- Distroless nonroot em Debian 13 e build em `node:22-trixie-slim` (glibc), para o `node_modules` bater com a imagem de runtime. Alpine (musl) quebraria addon nativo. A distroless Debian 12 trazia um OpenSSL com CVE crítico.
- Request de CPU baixo e de memória alto: CPU é comprimível, memória não.
- Kustomize do próprio `kubectl`, sem Helm e sem o binário `kustomize`.
- `make deploy` copia o manifesto e troca a imagem fora do Git, para o apply repetível não sujar o worktree.
- ClusterIP mais NetworkPolicy, em vez de só “não criar Ingress”.
- Buildx multi-arch porque o desenvolvimento é arm64 e o cluster de avaliação tende a ser amd64.
- Estágio `reports` em `scratch` para tirar HTML, LCOV, Cobertura e JUnit sem Node local.
- Sem `preStop` sleep, para funcionar antes do Kubernetes 1.30 e sem shell na imagem.
- Cliente do smoke test em outro namespace, porque o egress de `calculador` fica fechado de propósito.
