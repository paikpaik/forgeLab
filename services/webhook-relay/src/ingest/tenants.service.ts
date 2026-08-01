import { randomBytes, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@paikpaik/node-forge/database/nestjs";
import type { DataSource } from "typeorm";
import { TenantEntity } from "../entities/tenant.entity";
import type { CreateTenantDto } from "./dto/create-tenant.dto";

@Injectable()
export class TenantsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async create(dto: CreateTenantDto): Promise<{ id: string; apiKey: string }> {
    const apiKey = `whr_${randomBytes(24).toString("hex")}`;
    const tenant = await this.dataSource.getRepository(TenantEntity).save({
      id: randomUUID(),
      name: dto.name,
      apiKey,
    });
    return { id: tenant.id, apiKey: tenant.apiKey };
  }

  async findByApiKey(apiKey: string): Promise<TenantEntity | null> {
    return this.dataSource.getRepository(TenantEntity).findOneBy({ apiKey });
  }
}
