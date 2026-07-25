import { join } from "node:path";
import { Transport } from "@nestjs/microservices";

// name 필드는 여기서 갖지 않는다 — ClientsModule.register([{ name: TOKEN, ...grpcClientOptions(...) }])
// 형태로 호출부에서 스프레드하며 채워 넣는다(name까지 여기서 고정하면 스프레드 시 중복 필드가 됨).

// Docker에서 서비스가 여러 인스턴스로 뜰 때(inventory-service 2개), grpc-js의 기본 LB
// 정책(pick_first)은 최초 연결한 인스턴스에 고정돼버려서 나머지 인스턴스로는 요청이 전혀
// 안 간다. "dns:///" 스킴 + round_robin을 명시해야 Docker 임베디드 DNS가 돌려주는 여러
// A 레코드를 실제로 순회한다 — 다중 인스턴스 검증의 전제 조건.
export function grpcClientOptions(packageName: string, protoFileName: string, target: string) {
  return {
    transport: Transport.GRPC as const,
    options: {
      package: packageName,
      // src/shared → repo 루트의 proto/(개발 모드, ts-node-dev)와 dist/shared → 배포
      // 이미지의 proto/(런타임, dist와 형제 디렉토리로 복사됨 — public과 동일 패턴)가
      // 둘 다 같은 상대 깊이("../../proto")를 갖도록 Dockerfile에서 맞춰뒀다.
      protoPath: join(__dirname, "..", "..", "proto", protoFileName),
      url: `dns:///${target}`,
      channelOptions: {
        "grpc.service_config": JSON.stringify({
          loadBalancingConfig: [{ round_robin: {} }],
        }),
      },
    },
  };
}

export function grpcServerOptions(packageName: string, protoFileName: string, url: string) {
  return {
    transport: Transport.GRPC as const,
    options: {
      package: packageName,
      // src/shared → repo 루트의 proto/(개발 모드, ts-node-dev)와 dist/shared → 배포
      // 이미지의 proto/(런타임, dist와 형제 디렉토리로 복사됨 — public과 동일 패턴)가
      // 둘 다 같은 상대 깊이("../../proto")를 갖도록 Dockerfile에서 맞춰뒀다.
      protoPath: join(__dirname, "..", "..", "proto", protoFileName),
      url,
    },
  };
}
