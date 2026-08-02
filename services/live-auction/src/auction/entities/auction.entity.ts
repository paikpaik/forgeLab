import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

export type AuctionStatus = "LIVE" | "ENDED";

// currentHighestBid/currentHighestBidderId는 Postgres가 원본(source of truth)이다.
// Redis의 auction:{id}:current 해시는 이 값을 그대로 미러링한 "빠른 조회용 캐시"일 뿐이라,
// 둘 중 하나만 봐야 한다면 항상 이쪽을 믿는다.
@Entity("auctions")
export class AuctionEntity {
  @PrimaryColumn("varchar")
  id!: string;

  @Column("varchar")
  title!: string;

  @Column("varchar")
  description!: string;

  @Column("int")
  startingPrice!: number;

  @Column("int")
  minIncrement!: number;

  @Column({ type: "varchar", default: "LIVE" })
  status!: AuctionStatus;

  @Column("int")
  currentHighestBid!: number;

  @Column({ type: "varchar", nullable: true })
  currentHighestBidderId!: string | null;

  @Column("varchar")
  endsAt!: string;

  @Column({ type: "varchar", nullable: true })
  winnerId!: string | null;

  @Column({ type: "int", nullable: true })
  finalPrice!: number | null;

  @CreateDateColumn()
  createdAt!: Date;
}
