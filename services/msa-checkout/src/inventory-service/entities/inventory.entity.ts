import { Column, Entity, PrimaryColumn } from "typeorm";

// available = total - reserved. reserved는 "예약 중이거나(Try) 이미 확정된 것" 둘 다 아니라
// TCC의 Try~Confirm 사이에만 걸려 있는 홀드 수량이다 — Confirm되면 total도 함께 줄어들고
// reserved는 풀린다(재고가 실물로 빠져나갔다는 뜻), Cancel되면 reserved만 풀린다.
@Entity("inventory")
export class InventoryEntity {
  @PrimaryColumn("varchar")
  productId!: string;

  @Column("int")
  total!: number;

  @Column({ type: "int", default: 0 })
  reserved!: number;
}
