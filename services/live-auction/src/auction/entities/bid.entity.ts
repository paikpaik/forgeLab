import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

export type BidStatus = "ACCEPTED" | "REJECTED";

// 거절된 입찰(최소 증분 미달, 이미 종료된 경매 등)까지 전부 영구 기록한다 — 실제 경매의
// 감사 기록과 같은 원칙(order-outbox가 실패한 outbox row까지 남기는 것과 동일한 정신).
// 동시 요청 중 락 순서상 나중에 검증된 낮은 입찰도 REJECTED로 여기 남아야 "누가 언제 얼마를
// 불렀는지"가 감사 가능하다.
@Entity("bids")
export class BidEntity {
  @PrimaryColumn("varchar")
  id!: string;

  @Column("varchar")
  auctionId!: string;

  @Column("varchar")
  bidderId!: string;

  @Column("int")
  amount!: number;

  @Column("varchar")
  status!: BidStatus;

  @Column("varchar", { nullable: true })
  rejectionReason!: string | null;

  @CreateDateColumn()
  placedAt!: Date;
}
