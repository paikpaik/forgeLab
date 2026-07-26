# node-forge 제안 — `grpc` 모듈: 다중 인스턴스 라운드로빈이 기본으로 켜진 gRPC 클라이언트 옵션 헬퍼

## 계기

`services/msa-checkout`(forge-lab 4번째 실험)에서 API 게이트웨이 + gRPC 서비스 간 통신 +
orchestration saga를 처음으로 검증하면서, `inventory-service`를 2개 인스턴스로 띄워 다중
인스턴스 정합성(재고 1개에 동시 요청 2건 → 정확히 1건만 성공)까지 확인했다. 이 과정에서
gRPC 클라이언트를 기본 설정으로 구성하면 **두 번째 인스턴스로는 요청이 전혀 안 가는 문제**를
실제로 겪었다.

```ts
// 처음 작성한 버전 — 겉보기엔 멀쩡하지만 다중 인스턴스에서 조용히 한쪽만 씀
ClientsModule.register([
  {
    name: INVENTORY_GRPC_PACKAGE,
    transport: Transport.GRPC,
    options: {
      package: "inventory",
      protoPath: join(__dirname, "..", "..", "proto", "inventory.proto"),
      url: "inventory-service:50053", // Docker가 여러 컨테이너를 이 이름 하나로 라운드로빈 DNS 응답
    },
  },
]);
```

`@grpc/grpc-js`의 기본 로드밸런싱 정책은 `pick_first`라서, Docker 임베디드 DNS가
`inventory-service`에 대해 여러 A 레코드(컨테이너별 IP)를 돌려줘도 클라이언트는 **처음 연결에
성공한 인스턴스 하나에 고정**돼버린다. 게다가 일반 `hostname:port` 타깃 형식으로는 grpc-js가
DNS resolver를 명시적으로 타지 않는 경우도 있어, 아예 여러 주소를 인지조차 못 할 수 있다.
겉보기엔 정상 동작하는 것처럼 보이지만(요청이 실패하지 않음), 실제로는 스케일아웃한 두 번째
인스턴스가 트래픽을 한 번도 못 받는 조용한 버그다.

## 현재 한계

node-forge에는 Redis/Kafka/HTTP 클라이언트 헬퍼는 있지만 gRPC 관련 헬퍼가 전혀 없다. 각
소비 서비스가 매번 `dns:///` 스킴과 `grpc.service_config`(round_robin LB policy)를 직접
기억해서 넣어야 하는데, 이건 몰라도 에러가 안 나고 그냥 조용히 한쪽 인스턴스만 쓰게 되는
종류의 실수라 재사용 가능한 헬퍼로 강제하는 게 맞다고 판단했다.

## 제안

`grpc` 모듈을 신설하고, round-robin이 기본으로 켜진 클라이언트/서버 옵션 빌더를 제공한다.

```ts
// @paikpaik/node-forge/grpc (core, 프레임워크 무관)
export interface GrpcTargetOptions {
  packageName: string;
  protoPath: string;
  target: string;
  /** 기본 round_robin. pick_first가 필요한 특수 케이스(단일 인스턴스 확정 등)를 위해 열어둠 */
  loadBalancing?: "round_robin" | "pick_first";
}

export function buildGrpcClientChannelOptions(
  options: Pick<GrpcTargetOptions, "loadBalancing">,
): Record<string, unknown>;

export function buildGrpcClientUrl(target: string): string; // "dns:///" 스킴 적용
```

```ts
// @paikpaik/node-forge/grpc/nestjs
export function createGrpcClientOptions(options: GrpcTargetOptions): ClientProviderOptions;
export function createGrpcServerOptions(
  options: Omit<GrpcTargetOptions, "target"> & { url: string },
): MicroserviceOptions;
```

msa-checkout에서 실제로 검증한 사용법 그대로다 — `services/msa-checkout/src/shared/grpc-client.util.ts`
가 지금 이 실험 안에 로컬로 구현해둔 것과 동일한 모양이며, `dns:///${target}` +
`{ "grpc.service_config": JSON.stringify({ loadBalancingConfig: [{ round_robin: {} }] }) }`를
기본값으로 항상 넣는다.

## 검증 포인트

- 기본 옵션(추가 설정 없이)으로 클라이언트를 만들면, 같은 서비스명이 여러 IP로 resolve되는
  환경(Docker 임베디드 DNS 등)에서 요청이 실제로 여러 인스턴스에 분산되는지
- `loadBalancing: "pick_first"`로 명시하면 기존 grpc-js 기본 동작(단일 연결 고정)으로
  되돌아가는지(하위 호환/opt-out 경로)
- msa-checkout처럼 `docker stats`의 NET I/O 델타로 두 인스턴스 모두 트래픽을 받는지 실측
  검증(이번 실험에서 실제로 쓴 방법 — 인스턴스1 +13.4kB, 인스턴스2 +13.4kB로 거의 동일하게
  분산되는 것을 확인함)

## 기각한 대안

- **소비 서비스가 매번 `dns:///` + `service_config`를 직접 작성**(지금 msa-checkout이 로컬로
  하고 있는 방식): 몰라도 에러 없이 조용히 틀리게 동작하는 종류의 설정이라, 다음에 gRPC를
  쓰는 실험이 생기면 똑같은 문제를 처음부터 다시 겪을 가능성이 높다. 이번 한 번은 로컬 구현으로
  충분히 검증했으니(다중 인스턴스 실측까지 마침), 두 번째 필요 사례가 확인된 지금 forge로
  올리는 게 맞다고 판단
- **`@nestjs/microservices`에 없는 로드밸런서 자체를 node-forge가 구현**: grpc-js가 이미
  `round_robin` LB policy를 내장하고 있어서, node-forge는 그 옵션을 "기본값으로 켜주는" 역할만
  하면 충분하다 — 로드밸런싱 로직 자체를 새로 만들 필요는 없음
