import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@paikpaik/node-forge/database/nestjs";
import type { DataSource } from "typeorm";
import { EndpointEntity } from "../entities/endpoint.entity";
import type { CreateEndpointDto } from "./dto/create-endpoint.dto";

@Injectable()
export class EndpointsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async create(tenantId: string, dto: CreateEndpointDto): Promise<EndpointEntity> {
    return this.dataSource.getRepository(EndpointEntity).save({
      id: randomUUID(),
      tenantId,
      url: dto.url,
      secret: dto.secret,
      eventTypes: dto.eventTypes,
      active: true,
    });
  }

  async list(tenantId: string): Promise<EndpointEntity[]> {
    return this.dataSource.getRepository(EndpointEntity).find({ where: { tenantId }, order: { createdAt: "DESC" } });
  }

  // events.service.ts가 fan-out 대상을 고를 때 쓴다. eventTypes가 simple-json(문자열 컬럼)이라
  // SQL 레벨 "배열에 포함되는지" 쿼리는 안 되므로, 테넌트의 활성 엔드포인트를 전부 가져와
  // 애플리케이션 레벨에서 걸러낸다 — 테넌트당 엔드포인트 수가 많지 않은 랩 규모라 문제없음.
  async findMatching(tenantId: string, eventType: string): Promise<EndpointEntity[]> {
    const endpoints = await this.dataSource
      .getRepository(EndpointEntity)
      .find({ where: { tenantId, active: true } });
    return endpoints.filter((endpoint) => endpoint.eventTypes.includes("*") || endpoint.eventTypes.includes(eventType));
  }
}
