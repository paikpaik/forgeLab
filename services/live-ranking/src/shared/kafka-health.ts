import type { Kafka } from "kafkajs";
import type { HealthChecker } from "@paikpaik/node-forge/health";

// node-forge의 HealthChecker는 "() => Promise<void>, 실패 시 throw"라는 규약만 있는 인터페이스라
// redis/database 전용 구현체 외에 카프카용도 그 규약을 그대로 따르기만 하면 된다 — node-forge에
// 제안할 게 아니라 여기서 바로 구현.
export function createKafkaHealthChecker(kafka: Kafka): HealthChecker {
  return async () => {
    const admin = kafka.admin();
    await admin.connect();
    try {
      await admin.listTopics();
    } finally {
      await admin.disconnect();
    }
  };
}
