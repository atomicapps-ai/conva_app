# conva domain lexicon pack — software engineering
#
# Format + rules: crates/conva-core/src/lexicon.rs and
# conva_core/docs/technical/faner-domain-lexicon.md.
#   [core]      expected in any technical conversation of the domain
#   [extended]  specialised vocabulary
#   term | spoken variant | spoken variant   (variants cover word order / verb forms;
#                                            plural/-ing/-ed are handled by the matcher)
#   Term !      single word allowed to match on its own (never generic words)
# Every change must pass `cargo test -p conva-core lexicon` (the noise lint).

@pack software-engineering
@version 2026.09.1
@anchors kubernetes, docker, microservice, api, aws, lambda, database, sql, backend, frontend, devops, terraform, deployment, scalability, latency, algorithm, refactoring, ci/cd, git, react, python, java, kafka, redis, orm, vpc, rest, endpoint

[core]
# ── Architecture & design ────────────────────────────────────────────────────
system design | design a system | designing systems
software architecture | architect the software
microservice !
monolith !
monolithic architecture | monolith architecture
service oriented architecture | SOA
event driven architecture | event driven design | event driven
domain driven design | DDD
distributed system | distributed systems architecture
design pattern
singleton pattern | singleton
factory pattern
observer pattern
dependency injection | inject dependencies
inversion of control | IOC
separation of concerns
loose coupling | tight coupling | loosely coupled | tightly coupled
high cohesion
single responsibility principle
open closed principle
SOLID principles
clean architecture
hexagonal architecture
layered architecture
api design | design an api | designing apis
api gateway
service mesh
message queue | message broker | message bus
pub sub | publish subscribe | publisher subscriber
event sourcing
CQRS !
saga pattern
circuit breaker
bulkhead pattern
backpressure !
idempotency !
idempotent operation | idempotent request
eventual consistency
strong consistency
CAP theorem
ACID transactions | ACID properties
BASE properties
distributed transaction
two phase commit
consensus algorithm
leader election
service discovery
load balancer | load balancing | balance the load
reverse proxy
forward proxy
rate limiting | rate limiter | limit the rate
throttling !
caching strategy
cache invalidation
cache hit | cache miss | hit ratio
write through cache | write back cache
content delivery network | CDN
horizontal scaling | scale horizontally | horizontally scalable
vertical scaling | scale vertically | vertically scalable
auto scaling | autoscaling
scalability !
high availability
fault tolerance | fault tolerant
disaster recovery
failover !
redundancy !
single point of failure
graceful degradation
data consistency
data partitioning
sharding !
consistent hashing
replication lag
read replica
master slave replication | primary replica
multi tenancy | multi tenant
stateless service | stateless
stateful service | stateful
technical debt | tech debt
code quality
maintainability !
extensibility !
modularity !
abstraction layer
data modeling | modeling data | model the data | data model design
schema design | design the schema | designing schemas
database schema
entity relationship | ER diagram
normalization ! | normalize the data | denormalization | denormalize
data migration | migrate the data
schema migration | database migration | migrate the schema
backward compatibility | backward compatible
breaking change
versioning strategy | api versioning
feature flag | feature toggle
blue green deployment | blue green
canary deployment | canary release
rolling deployment | rolling update
zero downtime deployment | zero downtime
trade off | tradeoff
back of the envelope
capacity planning
performance tuning | tune performance
performance optimization | optimize performance
bottleneck !
latency !
throughput !
p99 latency | tail latency
concurrency !
parallelism !
multithreading ! | multi threaded
thread safety | thread safe
race condition
deadlock !
mutex !
semaphore !
lock contention
atomic operation
asynchronous programming | async programming | async await
event loop
callback hell
promise chain
non blocking | nonblocking
blocking call | blocking io
memory leak
garbage collection | garbage collector
stack overflow
heap memory
memory management
time complexity
space complexity
big O notation | big O
data structure
hash table | hash map | hashmap
linked list
binary tree | binary search tree
binary search
priority queue
graph traversal
breadth first search | BFS
depth first search | DFS
dynamic programming
recursion !
sorting algorithm
divide and conquer
greedy algorithm
LRU cache

# ── APIs & protocols ─────────────────────────────────────────────────────────
API !
REST !
RESTful api | restful service | restful
REST API
GraphQL !
gRPC !
WebSocket !
webhook !
endpoint !
API endpoint
HTTP !
HTTP request | http response | http method
status code | http status code | response code
request payload | response payload
JSON !
YAML !
XML !
protocol buffers | protobuf
OpenAPI ! | swagger
SDK !
CLI !
CRUD !
CRUD operations
pagination !
query parameter | query string
request header | response header
content negotiation
CORS !
cross origin
DNS !
TCP !
UDP !
TCP IP
TLS !
SSL !
IP address
OSI model
network latency
bandwidth !
websocket connection
long polling
server sent events
polling !

# ── Databases & data ─────────────────────────────────────────────────────────
SQL !
NoSQL !
relational database | relational data
non relational database
database index | index the table | indexing strategy
composite index
primary key
foreign key
unique constraint
join query | inner join | outer join | left join
query optimization | optimize the query | query optimizer
query plan | execution plan | explain plan
slow query
N plus one | N+1 query | N+1 problem
stored procedure
database transaction
transaction isolation
isolation level
optimistic locking | pessimistic locking
connection pool
ORM !
object relational mapping | object relational mapper
active record
data access layer
repository pattern
migration script
PostgreSQL !
Postgres !
MySQL !
SQLite !
MongoDB !
DynamoDB !
Cassandra !
Redis !
Memcached !
Elasticsearch !
Kafka !
RabbitMQ !
data warehouse
data lake
data pipeline | build a pipeline
ETL !
ELT !
stream processing
batch processing
change data capture | CDC
time series database
graph database
key value store | key value database
document database | document store
columnar database | column store
OLTP !
OLAP !
data engineering
data integrity
data quality
data governance
data lineage
big data

# ── Cloud & AWS ──────────────────────────────────────────────────────────────
cloud computing
cloud native
cloud infrastructure
cloud provider
AWS !
Amazon Web Services
Azure !
GCP !
Google Cloud
Lambda !
AWS Lambda
serverless !
serverless architecture | serverless function
EC2 !
S3 !
S3 bucket
RDS !
Aurora !
VPC !
VPC peering
subnet !
security group
NAT gateway
internet gateway
route table
availability zone
region !
IAM !
IAM role | IAM policy
least privilege
CloudFormation !
CloudWatch !
CloudFront !
Route 53
ELB !
ALB !
SQS !
SNS !
Kinesis !
EventBridge !
Step Functions
ECS !
EKS !
Fargate !
Elastic Beanstalk
Elastic Load Balancer
auto scaling group
managed service
infrastructure as code | IAC
Terraform !
Ansible !
Pulumi !
Helm !
Terragrunt !

# ── Containers & DevOps ──────────────────────────────────────────────────────
Kubernetes !
K8S !
Docker !
Dockerfile !
docker container | docker image | docker compose
container orchestration
containerization !
container registry
kubernetes cluster | kubernetes pod | kubernetes deployment | kubernetes service
kubectl !
namespace !
ingress controller
daemon set | stateful set
config map | configmap
persistent volume
horizontal pod autoscaler
DevOps !
SRE !
site reliability engineering | site reliability
CI/CD
CI CD pipeline | ci cd
continuous integration
continuous delivery
continuous deployment
build pipeline | deployment pipeline | release pipeline
Jenkins !
GitHub Actions
GitLab CI
CircleCI !
ArgoCD !
GitOps !
version control
GIT !
git branch | branching strategy
git merge | merge conflict | resolve conflicts
git rebase | rebase !
pull request
code review | review the code
trunk based development
monorepo !
package manager
dependency management | manage dependencies
build system
artifact repository
environment variables
secrets management | manage secrets
configuration management
staging environment
production environment | prod environment
rollback !
rollout !
hotfix !
release management | release process
incident response
post mortem | postmortem | blameless postmortem
on call | on-call rotation
runbook !
root cause analysis | root cause
mean time to recovery | MTTR
uptime !
SLA !
SLO !
SLI !
error budget
observability !
monitoring and alerting
alerting !
distributed tracing | tracing !
log aggregation
structured logging
metrics !
Prometheus !
Grafana !
Datadog !
Splunk !
Kibana !
OpenTelemetry !
health check | healthcheck
liveness probe | readiness probe
telemetry !

# ── Testing & quality ────────────────────────────────────────────────────────
unit test | write unit tests
integration test
end to end test | e2e test | E2E
regression test
smoke test
load test | performance test
stress test
test coverage | code coverage
test driven development | TDD
behavior driven development | BDD
test automation | automated testing
test suite
test case
test plan
mock object | mocking !
stub !
test double
fixture !
flaky test
assertion !
QA !
quality assurance
static analysis
linting ! | linter !
code smell
refactoring ! | refactor the code
benchmarking ! | benchmark the code
profiling ! | profiler !
debugging ! | debug the issue | debugger !
breakpoint !
stack trace
log file | logs !
exception handling | handle exceptions | error handling | handle errors
retry logic | retry policy | retries !
exponential backoff
timeout !
fallback !
defensive programming
edge case
corner case
acceptance criteria
definition of done

# ── Security ─────────────────────────────────────────────────────────────────
authentication !
authorization !
authn !
OAuth !
OAuth2 !
OpenID Connect | OIDC
SAML !
SSO !
single sign on
JWT !
JSON web token
access token | refresh token | bearer token
API key
session management | session cookie
cookie !
password hashing | hash the password | hashing !
salt and hash
bcrypt !
encryption !
encryption at rest | encryption in transit
symmetric encryption | asymmetric encryption
public key | private key
public key cryptography
digital signature
certificate !
TLS certificate
SQL injection
XSS !
cross site scripting
CSRF !
cross site request forgery
DDoS !
denial of service
man in the middle
zero trust
role based access control | RBAC
access control | ACL
principle of least privilege
input validation | validate input | sanitize input
threat modeling
penetration testing | pen testing
vulnerability !
security audit
OWASP !
compliance !
SOC 2
GDPR !
HIPAA !
PCI DSS
PII !
audit log
secret rotation
key management | KMS !

# ── Languages, runtimes, frameworks ──────────────────────────────────────────
Python !
Java !
JavaScript !
TypeScript !
Golang !
Rust !
Kotlin !
Swift !
Scala !
Ruby !
Rails !
PHP !
Node.js
Django !
Flask !
FastAPI !
Spring Boot
Spring !
Hibernate !
Express.js
NestJS !
React !
React Native
Angular !
Vue.js
Next.js
Redux !
Svelte !
jQuery !
Webpack !
NPM !
Maven !
Gradle !
JVM !
JRE !
JDK !
WebAssembly ! | WASM
object oriented programming | OOP
functional programming
procedural programming
imperative programming
declarative programming
type system
static typing | dynamic typing | strongly typed | statically typed | dynamically typed
type safety
generics !
polymorphism !
inheritance !
encapsulation !
abstract class
interface segregation
immutable data | immutability !
higher order function
closure !
lambda function | lambda expression
list comprehension
decorator !
iterator !
generator function | generators !
coroutine !
virtual machine
garbage collected
compiled language | interpreted language
runtime !
standard library
third party library
open source
code base | codebase !

# ── Frontend ─────────────────────────────────────────────────────────────────
frontend !
front end
backend !
back end
full stack | fullstack !
single page application | SPA
server side rendering | SSR
client side rendering | CSR
static site generation
progressive web app | PWA
responsive design
web accessibility | accessibility !
DOM manipulation | the DOM
virtual DOM
state management | manage state
component library
CSS !
HTML !
Tailwind !
web performance
lazy loading
code splitting
bundle size
browser compatibility | cross browser
service worker
local storage
web vitals

# ── Data science & ML ────────────────────────────────────────────────────────
machine learning
deep learning
neural network
natural language processing | NLP
computer vision
large language model | LLM
transformer model
training data
model training | train the model
model deployment | deploy the model | model serving
feature engineering
feature store
overfitting !
underfitting !
cross validation
hyperparameter tuning | tune hyperparameters
gradient descent
supervised learning | unsupervised learning
reinforcement learning
precision and recall
confusion matrix
A/B testing | AB test
statistical significance
data science
data analysis | analyze the data
data visualization
exploratory data analysis | EDA
pandas !
NumPy !
scikit-learn | sklearn
TensorFlow !
PyTorch !
Jupyter !
Spark !
Hadoop !
Airflow !
DBT !
Snowflake !
Databricks !
BigQuery !
Redshift !
MLOps !
vector database | vector store
embeddings !
retrieval augmented generation | RAG
prompt engineering

# ── Agile & engineering practice ─────────────────────────────────────────────
agile methodology | agile !
scrum !
kanban !
sprint planning
sprint retrospective | retrospective !
standup !
user story
story points
backlog !
product backlog
roadmap !
minimum viable product | MVP
proof of concept | POC
technical specification | tech spec
design document | design doc
architecture decision record | ADR
requirements gathering
stakeholder management
cross functional team | cross functional
pair programming
mob programming
code ownership
on boarding
mentoring !
tech lead
engineering manager
staff engineer
principal engineer
full software development lifecycle | SDLC
software development lifecycle
waterfall !
DevSecOps !
shift left
platform engineering
developer experience | DX
internal tooling
API documentation
technical documentation
code comments
naming conventions
coding standards
best practices
YAGNI !
DRY principle | don't repeat yourself
KISS principle
premature optimization
over engineering
scope creep
trade off analysis
build versus buy | build vs buy
vendor lock in
total cost of ownership | TCO

[extended]
# ── Deeper architecture / distributed systems ────────────────────────────────
vector clock
gossip protocol
Raft !
Paxos !
Byzantine fault tolerance
quorum !
split brain
write ahead log | WAL
log structured merge tree | LSM tree
B tree | B+ tree
bloom filter
skip list
trie !
merkle tree
consistent hash ring
token bucket
leaky bucket
sliding window
thundering herd
cache stampede
hot partition | hot key
fan out | fan in
scatter gather
sidecar pattern
strangler fig pattern
anti corruption layer
outbox pattern
transactional outbox
two generals problem
exactly once delivery | at least once delivery | at most once delivery
dead letter queue | DLQ
poison message
message ordering
partition key
consumer group
offset commit
schema registry
event schema
compaction !
tombstone !
read your writes
causal consistency
linearizability !
serializability !
snapshot isolation
multi version concurrency control | MVCC
phantom read | dirty read | non repeatable read
write skew
lock free | wait free
compare and swap
memory barrier
false sharing
cache line
context switch
thread pool
work stealing
green threads
actor model
CSP model
reactive programming
reactive streams
observable !
zero copy
memory mapped file
copy on write
epoll !
kernel bypass
system call
file descriptor
inode !
page cache
NUMA !
SIMD !

# ── Cloud / infra depth ──────────────────────────────────────────────────────
VPC endpoint
transit gateway
PrivateLink !
Direct Connect
network ACL
bastion host
Elastic IP
placement group
spot instances
reserved instances | savings plan
Lambda cold start | cold start
Lambda layer
provisioned concurrency
Lambda concurrency
API Gateway authorizer | Lambda authorizer
usage plan
DynamoDB streams
global secondary index | GSI
local secondary index | LSI
partition key design
single table design
DynamoDB capacity | provisioned capacity | on demand capacity
S3 lifecycle policy
S3 versioning
presigned URL | pre-signed URL
multipart upload
Glacier !
EBS volume | EBS snapshot
EFS !
Elastic Container Registry | ECR !
AWS CDK | CDK !
SAM template
Systems Manager
Parameter Store
Secrets Manager
CloudTrail !
GuardDuty !
AWS Config
WAF !
Shield !
Cognito !
AppSync !
Athena !
Glue !
EMR !
Lake Formation
QuickSight !
SageMaker !
Bedrock !
Terraform module
Terraform state | remote state
Terraform plan | terraform apply
drift detection
immutable infrastructure
pets versus cattle
golden image
bootstrapping !
cloud cost optimization | cost optimization | FinOps
multi cloud | multi region | multi AZ
active active | active passive
RTO !
RPO !
chaos engineering | chaos monkey
game day
capacity reservation
warm pool

# ── Kubernetes / containers depth ────────────────────────────────────────────
control plane
data plane
kubelet !
etcd !
kube proxy
kube scheduler
custom resource definition | CRD
operator pattern | kubernetes operator
admission controller
network policy
pod disruption budget
resource limits | resource requests
node affinity | pod affinity
taints and tolerations
init container
sidecar container
rolling restart
service account
role binding
Istio !
Envoy !
Linkerd !
Kustomize !
Skaffold !
Minikube !
container runtime
containerd !
cgroups !
overlay network
CNI !
image layer
multi stage build
distroless !
OCI image

# ── CI/CD & tooling depth ────────────────────────────────────────────────────
build cache
remote cache
artifact promotion
release train
semantic versioning | semver !
changelog !
conventional commits
git bisect
git hooks | pre commit hook
cherry pick
feature branch
release branch
merge queue
code owners
dependabot !
renovate !
SBOM !
supply chain security
software supply chain
SAST !
DAST !
container scanning
secret scanning
policy as code
Open Policy Agent | OPA !
Sentinel policy
progressive delivery
dark launch
shadow traffic | traffic mirroring
synthetic monitoring
real user monitoring | RUM !
golden signals
RED method | USE method
burn rate
alert fatigue
toil !
error rate
saturation !
service level objective
service level agreement
service level indicator

# ── Testing depth ────────────────────────────────────────────────────────────
property based testing
mutation testing
contract testing | consumer driven contract | Pact !
snapshot testing
golden file
fuzzing !
fuzz testing
test pyramid
testing trophy
test isolation
test harness
test data management
test environment
flakiness !
chaos testing
soak testing
spike testing
canary analysis
Selenium !
Cypress !
Playwright !
JUnit !
pytest !
Mockito !
Jest !
Mocha !
Postman !
JMeter !
Gatling !
Locust !

# ── Data / ML depth ──────────────────────────────────────────────────────────
slowly changing dimension | SCD
star schema | snowflake schema
fact table | dimension table
data mart
medallion architecture
lakehouse !
delta lake
Iceberg !
Parquet !
Avro !
ORC file
columnar storage
partition pruning
predicate pushdown
data skew
shuffle !
broadcast join
map reduce | MapReduce
lambda architecture | kappa architecture
exactly once semantics
watermark !
windowing !
stream table duality
Flink !
Beam !
Kafka Streams
ksqlDB !
Debezium !
Fivetran !
Airbyte !
Dagster !
Prefect !
Great Expectations
data contract
data catalog
master data management | MDM
feature drift | data drift | concept drift
model drift
model registry
model monitoring
experiment tracking
MLflow !
Kubeflow !
ONNX !
quantization !
fine tuning | finetune
LoRA !
RLHF !
prompt injection
context window
token limit
temperature !
hallucination !
guardrails !
agentic workflow | AI agent
function calling | tool use
semantic search
hybrid search
BM25 !
cosine similarity
approximate nearest neighbor | ANN !
HNSW !
reranking ! | reranker !
chunking !
Pinecone !
Weaviate !
Chroma !
pgvector !
LangChain !
LlamaIndex !

# ── Frontend / mobile depth ──────────────────────────────────────────────────
hydration !
tree shaking
hot module replacement | HMR
Vite !
Babel !
ESLint !
Prettier !
Storybook !
micro frontend
module federation
web components
shadow DOM
CSS in JS
CSS modules
Sass !
flexbox !
CSS grid
media query
critical rendering path
layout shift
first contentful paint
time to interactive
largest contentful paint
Lighthouse !
service worker cache
IndexedDB !
WebRTC !
WebGL !
canvas !
React hooks | useEffect | useState
React context
server components
Redux Toolkit
MobX !
Zustand !
GraphQL subscription
Apollo !
Relay !
Flutter !
Xamarin !
Android !
IOS !
Xcode !
app store
push notification
deep link
offline first

# ── Security depth ───────────────────────────────────────────────────────────
defense in depth
attack surface
threat actor
red team | blue team | purple team
bug bounty
CVE !
CVSS !
zero day
privilege escalation
lateral movement
remote code execution | RCE
server side request forgery | SSRF
insecure deserialization
path traversal
clickjacking !
content security policy | CSP !
HSTS !
same origin policy
subresource integrity
certificate pinning
mutual TLS | mTLS
perfect forward secrecy
key rotation
envelope encryption
hardware security module | HSM !
secure enclave
homomorphic encryption
differential privacy
tokenization !
data masking
data residency
data retention
right to be forgotten
SIEM !
IDS !
IPS !
EDR !
WAF rules
rate limit bypass
brute force attack | credential stuffing
phishing !
social engineering
multi factor authentication | MFA !
two factor authentication | 2FA !
passwordless !
WebAuthn !
FIDO2 !
SCIM !
LDAP !
Active Directory
Kerberos !
Okta !
Auth0 !
Keycloak !
Vault !
