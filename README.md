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

make release REGISTRY=<seu-registry> TAG=1.0.0
make deploy IMAGE=<seu-registry>/calculador-api:1.0.0
make smoke-test

# edite src/ e publique uma tag nova
make redeploy REGISTRY=<seu-registry> TAG=1.0.1
make undeploy
```

Sem registry, o mesmo ciclo num kind na sua máquina:

```bash
make local-e2e
```

O pacote no GHCR nasce privado. Se o `deploy` não puxar a imagem, torne o pacote público ou crie o `PULL_SECRET` descrito em [Publicar a imagem](#imagem).

<a id="sumario"></a>

## Sumário

- [Requisitos do desafio](#requisitos)
- [Estrutura do projeto](#estrutura)
- [Pré-requisitos](#pre-requisitos)
- [Quickstart para o avaliador](#quickstart-avaliador)
- [Executar localmente](#local)
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
| Quatro operações | `GET /api/sum`, `/api/sub`, `/api/mul`, `/api/div` com `term_one` e `term_two`. Resposta `{"result": N}`. |
| Node.js e NestJS | Node 22, NestJS 11. Imagem final distroless, usuário 65532. |
| Porta 8000 | `PORT=8000`. O processo escuta em `0.0.0.0`. |
| Só dentro do cluster | Service `ClusterIP`, sem Ingress, NodePort ou LoadBalancer. NetworkPolicy default-deny e allow só de Pods do cluster. |
| Healthcheck | `GET /health/live` e `GET /health/ready`, usados pelas probes. |
| Testes e cobertura | `npm run test:cov` exige 100% e grava HTML, LCOV, Cobertura e JUnit. |
| Deploy e remoção documentados | `make deploy` / `kubectl apply -k k8s/` e `make undeploy` / `kubectl delete -k k8s/`. |
| Alterar e subir de novo | `make redeploy TAG=1.0.1`, com rollback. |

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
├── test/                            # e2e (test/app.e2e-spec.ts)
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
| `TAG` | versão do `package.json` (`1.0.0`) | tag |
| `IMAGE` | `$(REGISTRY)/$(IMAGE_NAME):$(TAG)` | referência completa |
| `PLATFORMS` | `linux/amd64,linux/arm64` | plataformas do `make release` |
| `NAMESPACE` | `calculador` | namespace dos comandos `kubectl` |
| `KIND_CLUSTER` | `calculador` | nome do cluster kind |
| `PULL_SECRET` | vazio | `imagePullSecret` opcional |
| `CLIENT_NAMESPACE` | `default` | namespace do Pod cliente do smoke test |
| `ROLLOUT_TIMEOUT` | `120s` | espera do rollout |

`NAMESPACE` tem de continuar `calculador`, que é o valor em `k8s/kustomization.yaml`.

<a id="local"></a>

## Executar localmente

Com Node 22:

```bash
make install
make run
```

`make run` sobe o modo desenvolvimento em `http://127.0.0.1:8000`. Sem `NODE_ENV`, o padrão é `development` e o log sai colorido (pino-pretty). Para o mesmo JSON do cluster:

```bash
NODE_ENV=production LOG_LEVEL=info npm run start:dev
```

Com Docker, na arquitetura da sua máquina:

```bash
make docker-build
make docker-run
```

`make docker-run` publica `127.0.0.1:8000` só para esse teste da imagem. No cluster o Service continua `ClusterIP` e essa porta não existe fora dele. Encerre com Ctrl+C.

```bash
curl -sS "http://127.0.0.1:8000/api/sum?term_one=2&term_two=3"
curl -sS "http://127.0.0.1:8000/health/ready"
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

curl -sS "http://127.0.0.1:8000/health/live"
# {"status":"ok","info":{"process":{"status":"up"}},"error":{},"details":{"process":{"status":"up"}}}

curl -sS "http://127.0.0.1:8000/health/ready"
# {"status":"ok","info":{"memory_heap":{"status":"up"}},"error":{},"details":{"memory_heap":{"status":"up"}}}

curl -sS -i "http://127.0.0.1:8000/api/div?term_one=10&term_two=0"
```

Validação:

- Decimais, negativos e notação científica são aceitos (`-3`, `2.5`, `1e2`).
- Divisão com resultado não inteiro devolve número JSON (`5/2` é `2.5`).
- Divisão por zero responde 400 com a mensagem `Division by zero is not allowed`.
- Vazio, espaço, texto, hexadecimal (`0x10`), binário, octal, `NaN`, `Infinity` e estouro (`1e400`) respondem 400.
- Resultado não finito responde 400 com a mensagem `Operation result is not a finite number`.

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

O e2e está em `test/app.e2e-spec.ts`:

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
{"level":"info","time":"2026-11-07T03:58:40.120Z","pid":1,"hostname":"calculador-api-7d4f8c9b5-abcde","traceId":"avaliador-123","req":{"method":"GET","url":"/api/sum?term_one=2&term_two=3","remoteAddress":"10.244.0.12","userAgent":"curl/8.7.1"},"service":"calculador-api","version":"1.0.0","env":"production","res":{"statusCode":200},"responseTime":3,"msg":"request completed"}
```

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
make release REGISTRY=ghcr.io/SEU_USUARIO TAG=1.0.0
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

make deploy REGISTRY=ghcr.io/SEU_USUARIO TAG=1.0.0 PULL_SECRET=ghcr-pull
```

`PULL_SECRET` adiciona `imagePullSecrets` na hora do apply. O arquivo `k8s/deployment.yaml` não é editado.

### Docker Hub

```bash
docker login
make release REGISTRY=docker.io/SEU_USUARIO TAG=1.0.0
make deploy REGISTRY=docker.io/SEU_USUARIO TAG=1.0.0
```

Repositório público não precisa de secret.

### ECR

```bash
aws ecr create-repository --repository-name calculador-api --region us-east-1
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com

make release REGISTRY=123456789012.dkr.ecr.us-east-1.amazonaws.com TAG=1.0.0
make deploy REGISTRY=123456789012.dkr.ecr.us-east-1.amazonaws.com TAG=1.0.0 PULL_SECRET=ecr-pull
```

O token do `docker login` na ECR expira em 12 horas. Em EKS o caminho durável é a role do nó, não um secret de longa duração. O secret acima serve para um teste curto. Crie `ecr-pull` com `kubectl create secret docker-registry`, no mesmo formato do GHCR, usando `--docker-server` do registry da conta.

<a id="deploy"></a>

## Deploy no Kubernetes

`make deploy` não altera arquivos do repositório. Ele copia `k8s/` para um diretório temporário, troca `images.newName` e `images.newTag`, grava a anotação `calculador.dev/deployed-at` para recriar os Pods e roda `kubectl apply -k` nessa cópia. Em seguida espera o rollout.

```bash
make deploy TAG=1.0.0
kubectl -n calculador rollout status deploy/calculador-api --timeout=120s
kubectl -n calculador get pods,svc
```

O `rollout status` já faz parte de `make deploy`. O comando de cima serve para repetir a espera.

Sem Make, edite o bloco no fim de `k8s/kustomization.yaml`:

```yaml
images:
  - name: calculador-api
    newName: ghcr.io/SEU_USUARIO/calculador-api
    newTag: "1.0.0"
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
make redeploy TAG=1.0.1
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

As duas réplicas cabem num nó só. O spread por hostname é `ScheduleAnyway`, então não bloqueia o agendamento.

<a id="seguranca"></a>

## Segurança

A API fica dentro do cluster por várias camadas:

- Service `type: ClusterIP`. Não há Ingress, NodePort, LoadBalancer, `hostNetwork` nem `hostPort`.
- NetworkPolicy `default-deny-all` nega ingress e egress de todo Pod do namespace.
- NetworkPolicy `allow-in-cluster-http` libera só TCP 8000 na API, e só com `namespaceSelector: {}`. Isso seleciona Pods. Não há `ipBlock`, então tráfego de fora do cluster não entra, mesmo que alguém crie um Ingress depois.
- Egress da API continua negado. A resposta de quem já conectou passa pelo conntrack. A aplicação não precisa de DNS nem de saída.
- Pods dentro de `calculador` também não abrem conexão de saída. Cliente de teste fica em outro namespace (`default`).
- Namespace com Pod Security Admission `enforce`, `audit` e `warn` em `restricted`.
- Imagem distroless, usuário e grupo 65532, `runAsNonRoot`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, `seccompProfile: RuntimeDefault`, root filesystem somente leitura. `/tmp` é um `emptyDir` de 16Mi (`HOME=/tmp`).
- ServiceAccount dedicada com `automountServiceAccountToken: false` na conta e no Pod. O processo não chama a API do Kubernetes.
- Requests `50m` / `64Mi` e limits `500m` / `256Mi`.
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
| startup | `/health/ready` | até 60s para o processo subir; liveness e readiness esperam ela |
| readiness | `/health/ready` | sai do Service se o heap usado passar de `HEALTH_HEAP_THRESHOLD_MB` (padrão 200) |
| liveness | `/health/live` | checagem barata do processo |

O teto de heap é 200 MiB, abaixo do limit de memória do container (256Mi). A imagem define `HEALTH_HEAP_THRESHOLD_MB=200` e o ConfigMap repete o mesmo valor. Um inteiro de 1 a 8192 também é aceito. No Jest, `test/jest-setup.ts` sobe o teto para 4096 porque o processo de teste passa de 200 MiB; isso não entra na imagem. As duas réplicas usam RollingUpdate `maxSurge: 1` e `maxUnavailable: 0`. O PDB pede `minAvailable: 1` em disrupção voluntária.

O processo trata `SIGTERM` (`enableShutdownHooks`) e tem 30s para encerrar (`terminationGracePeriodSeconds`). Não há `preStop` com shell: a imagem distroless não tem shell, e o sleep de lifecycle exige Kubernetes 1.30.

Logs: seção [Logs estruturados](#logs). Não há endpoint de métricas.

<a id="ci"></a>

## CI

`.github/workflows/ci.yml` roda em push e pull request:

1. Node 22, cache de npm, `npm ci`, `npm run lint`, `npm run test:cov`.
2. Artifact `calculador-reports` e um resumo no job.
3. `kubectl kustomize k8s/` e kubeconform em modo strict.
4. `bash -n` nos scripts.

Em push na `main` ou em tag `v*`, depois dos jobs acima, a imagem vai para `ghcr.io/<owner>/<repo>` em `linux/amd64` e `linux/arm64`. Tags: o SHA do commit, `latest` na branch padrão, e semver nas tags `v*`. O login usa `GITHUB_TOKEN` com `packages: write`. O workflow não faz deploy no cluster.

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

- Distroless nonroot e build em `node:22-bookworm-slim` (glibc), para o `node_modules` bater com a imagem debian. Alpine (musl) quebraria addon nativo no runtime.
- Kustomize do próprio `kubectl`, sem Helm e sem o binário `kustomize`.
- `make deploy` copia o manifesto e troca a imagem fora do Git, para o apply repetível não sujar o worktree.
- ClusterIP mais NetworkPolicy, em vez de só “não criar Ingress”.
- Buildx multi-arch porque o desenvolvimento é arm64 e o cluster de avaliação tende a ser amd64.
- Estágio `reports` em `scratch` para tirar HTML, LCOV, Cobertura e JUnit sem Node local.
- Sem `preStop` sleep, para funcionar antes do Kubernetes 1.30 e sem shell na imagem.
- Cliente do smoke test em outro namespace, porque o egress de `calculador` fica fechado de propósito.
