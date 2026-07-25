import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

export type OrderStatus = "PENDING" | "CONFIRMED" | "CANCELLED";

@Entity("orders")
export class OrderEntity {
  @PrimaryColumn("varchar")
  id!: string;

  // sagaId가 유니크 키 — inventory-service의 ReservationEntity와 동일한 멱등성 근거.
  @Column({ type: "varchar", unique: true })
  sagaId!: string;

  @Column("varchar")
  userId!: string;

  @Column("varchar")
  productId!: string;

  @Column("int")
  quantity!: number;

  @Column({ type: "varchar", default: "PENDING" })
  status!: OrderStatus;

  @CreateDateColumn()
  createdAt!: Date;
}
