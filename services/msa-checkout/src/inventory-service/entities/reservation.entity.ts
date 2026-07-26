import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

export type ReservationStatus = "RESERVED" | "CONFIRMED" | "CANCELLED";

// sagaId가 유니크 키 역할을 한다 — 같은 sagaId로 TryReserve가 재시도돼도(orchestrator가
// 네트워크 오류 후 다음 폴링 tick에 다시 호출) 이 행의 존재 여부로 판별해서 재고를 두 번
// 홀드하지 않는다.
@Entity("reservations")
export class ReservationEntity {
  @PrimaryColumn("varchar")
  id!: string;

  @Column({ type: "varchar", unique: true })
  sagaId!: string;

  @Column("varchar")
  productId!: string;

  @Column("int")
  quantity!: number;

  @Column({ type: "varchar", default: "RESERVED" })
  status!: ReservationStatus;

  @CreateDateColumn()
  createdAt!: Date;
}
