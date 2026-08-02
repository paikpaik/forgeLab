import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

@Entity("events")
export class EventEntity {
  @PrimaryColumn("varchar")
  id!: string;

  @Column("varchar")
  tenantId!: string;

  @Column("varchar")
  type!: string;

  @Column({ type: "simple-json" })
  payload!: unknown;

  @CreateDateColumn()
  createdAt!: Date;
}
